import { scheduleRecoveryTarget } from '../schedule/command-recovery'

export interface CommandRecoveryDescriptor {
  commandId: string
  workspaceId: string
  actorId: string
  family: string
  targetId: string | null
  action: string
  scopeId?: string
}

export type CommandResolution<R> = { outcome: 'applied', result: R } | { outcome: 'not-applied', commandId: string }
export type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Scope and identity only: drafts, originals and receipt bodies stay in page memory. */
export function commandRecoveryKey(scope: Pick<CommandRecoveryDescriptor, 'workspaceId' | 'actorId' | 'family' | 'targetId' | 'scopeId'>) {
  const key = `crm:form-command:v1:${[scope.family, scope.workspaceId, scope.actorId, scope.targetId ?? 'new'].map(encodeURIComponent).join(':')}`
  // Independent drafts explicitly separate their scope; ordinary entity IDs already name their owner.
  if (scope.family === 'target-cost' && scope.targetId === null && scope.scopeId)
    return `${key}:draft:${encodeURIComponent(scope.scopeId)}`
  if (scope.family === 'auxiliary-contract' && scope.targetId === null && scope.scopeId)
    return `${key}:kind:${encodeURIComponent(scope.scopeId)}`
  return key
}

export function createCommandRecoveryStorage(storage: () => RecoveryStorage = () => (globalThis as unknown as { sessionStorage: RecoveryStorage }).sessionStorage) {
  const unavailable = () => new Error('无法可靠核对原提交编号，请保留输入并恢复浏览器存储。')
  function read(key: string): CommandRecoveryDescriptor | null {
    try {
      const text = storage().getItem(key)
      if (text === null)
        return null
      const value = JSON.parse(text)
      if (!value || Object.keys(value).sort().join(',') !== (Object.hasOwn(value, 'scopeId') ? 'action,actorId,commandId,family,scopeId,targetId,workspaceId' : 'action,actorId,commandId,family,targetId,workspaceId')
        || !['workspaceId', 'actorId', 'family', 'action'].every(field => typeof value[field] === 'string' && value[field].trim())
        || typeof value.commandId !== 'string' || !/^[a-z0-9][\w-]{2,79}$/i.test(value.commandId)
        || !(value.targetId === null || (typeof value.targetId === 'string' && value.targetId.trim()))
        || (Object.hasOwn(value, 'scopeId') && (typeof value.scopeId !== 'string' || !value.scopeId.trim() || /[\s/\\?#]/.test(value.scopeId) || [...value.scopeId].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)))
        || commandRecoveryKey(value) !== key) {
        throw unavailable()
      }
      return value
    }
    catch { throw unavailable() }
  }
  function remember(key: string, descriptor: CommandRecoveryDescriptor) {
    if (read(key))
      throw new Error('请先核对原提交结果，再提交新的内容。')
    try {
      const encoded = JSON.stringify(descriptor)
      storage().setItem(key, encoded)
      if (storage().getItem(key) !== encoded || JSON.stringify(read(key)) !== encoded)
        throw unavailable()
    }
    catch { throw unavailable() }
  }
  function verify(key: string, commandId: string) {
    if (read(key)?.commandId !== commandId)
      throw unavailable()
  }
  function clear(key: string, commandId: string) {
    verify(key, commandId)
    try {
      storage().removeItem(key)
      if (read(key) !== null)
        throw unavailable()
    }
    catch { throw unavailable() }
  }
  return { read, remember, verify, clear }
}

export function commandVersionAtLeast(current: string, original: string) {
  return /^[1-9]\d*$/.test(current) && /^[1-9]\d*$/.test(original) && BigInt(current) >= BigInt(original)
}

/** Producers and startup recovery use the same existing persistence boundary for each family. */
export function commandRecoveryStorageForFamily(family: string) {
  return createCommandRecoveryStorage(() => family === 'crew-worker-import' ? globalThis.localStorage : globalThis.sessionStorage)
}

function recoveryUrl(fullPath: string): URL | null {
  if (!fullPath.startsWith('/') || fullPath.startsWith('//') || fullPath.includes('\\'))
    return null
  try {
    const url = new URL(fullPath, 'https://ruihang.invalid')
    if (url.searchParams.getAll('origin').length > 1 || (url.searchParams.has('origin') && url.searchParams.get('origin') !== 'real'))
      return null
    return url
  }
  catch { return null }
}

/** A refresh can keep the exact original command route without restoring a write tab or its body. */
export function commandRecoveryFormTarget(fullPath: string): Pick<CommandRecoveryDescriptor, 'family' | 'targetId' | 'scopeId'> | null {
  const url = recoveryUrl(fullPath)
  if (!url)
    return null
  const schedule = scheduleRecoveryTarget(fullPath)
  if (schedule)
    return schedule
  try {
    if (url.pathname === '/material/quotations/import')
      return { family: 'material-quotation-import', targetId: null }
    if (url.pathname === '/contract/other-settlement/import')
      return { family: 'other-settlement-import', targetId: null }
    const budget = /^\/project\/target-cost\/(?:form(?:\/([^/]+))?|([^/]+))$/.exec(url.pathname)
    if (budget) {
      const encoded = budget[1] ?? budget[2]
      const targetId = encoded ? decodeURIComponent(encoded) : null
      const validId = (value: string) => Boolean(value.trim()) && !/[\s/\\?#]/.test(value) && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
      if ((targetId !== null && !validId(targetId)) || url.searchParams.getAll('draftKey').length > 1)
        return null
      const scopeId = targetId === null ? url.searchParams.get('draftKey') : null
      if (scopeId !== null && !validId(scopeId))
        return null
      return { family: 'target-cost', targetId, ...(scopeId ? { scopeId } : {}) }
    }
    const receipt = /^\/finance\/receipt\/(?:new|form\/([^/]+))$/.exec(url.pathname)
    const contract = /^\/contract\/(construction|subcontract|material|other-expense|company-expense|other-settlement)\/form(?:\/([^/]+))?$/.exec(url.pathname)
    const master = /^\/base\/(crew|worker)\/form(?:\/([^/]+))?$/.exec(url.pathname)
    const signatory = /^\/settings\/our-signatories\/form(?:\/([^/]+))?$/.exec(url.pathname)
    const quotation = /^\/material\/quotations\/form(?:\/([^/]+))?$/.exec(url.pathname)
    const finance = /^\/finance\/(current|reimbursement|payment|records|billing)\/(?:new|([^/]+))$/.exec(url.pathname)
    if (!receipt && !contract && !master && !signatory && !quotation && !finance)
      return null
    const encoded = receipt ? receipt[1] : contract ? contract[2] : master ? master[2] : signatory ? signatory[1] : quotation ? quotation[1] : finance![2]
    const targetId = encoded ? decodeURIComponent(encoded) : null
    if (targetId !== null && (!targetId.trim() || /[\s/\\?#]/.test(targetId) || [...targetId].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)))
      return null
    const financeFamilies: Record<string, string> = {
      current: 'finance-current',
      reimbursement: 'finance-reimbursement',
      payment: 'finance-payment-application',
      records: 'finance-payment-record',
      billing: 'finance-invoice-application',
    }
    if (contract && ['other-expense', 'company-expense'].includes(contract[1]!))
      return { family: 'auxiliary-contract', targetId, scopeId: contract[1]!.replace('-', '_') }
    if (contract?.[1] === 'other-settlement')
      return { family: 'other-settlement', targetId }
    return { family: receipt ? 'receipt' : contract ? `${contract[1]}-contract` : master ? master[1]! : signatory ? 'our-signatory' : quotation ? 'material-quotation' : financeFamilies[finance![1]!]!, targetId }
  }
  catch { return null }
}

/** A single maintenance page hosts independent domain commands; each retains only its own original key. */
export function commandRecoveryRouteTargets(fullPath: string): Array<Pick<CommandRecoveryDescriptor, 'family' | 'targetId' | 'scopeId'>> {
  const form = commandRecoveryFormTarget(fullPath)
  if (form)
    return [form]
  const url = recoveryUrl(fullPath)
  if (url?.pathname === '/settings/data-migration')
    return [{ family: 'crew-worker-import', targetId: null }, { family: 'finance-import', targetId: null }, { family: 'target-cost-import', targetId: null }, { family: 'payroll-import', targetId: null }, { family: 'schedule-import', targetId: null }, { family: 'construction-contract-import', targetId: null }, { family: 'subcontract-contract-import', targetId: null }]
  if (url && /^\/contract\/(?:other-expense|company-expense)$/.test(url.pathname))
    return [{ family: 'auxiliary-contract-import', targetId: null }]
  return []
}
