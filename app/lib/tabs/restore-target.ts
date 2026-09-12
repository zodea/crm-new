import type { RestorableTabPath, TabRestoreValidator } from './restoration-contract'
import type { DomainRepositories } from '~/plugins/repositories'
import type { DataOriginDTO } from '~/types/read-model'
import { QUANTITY_FILTER_KEYS } from '~/lib/quantity/navigation'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'
import { TAB_TARGET_VERSION } from './restoration-contract'
import { readRestoredDetail } from './restore-detail'
import { checkRestoreAbort, restoreProblem } from './restore-problem'

// 明确登记可恢复的阅读入口；导航树有链接不代表页面没有写态。
const LISTS: Record<string, [string, string?]> = {
  '/': ['首页'],
  '/project': ['项目列表', 'project:list:read'],
  '/schedule': ['施工进度', 'project:list:read'],
  '/schedule/process-library': ['工序库', 'process-library:read'],
  '/project/target-cost': ['目标成本'],
  '/contract/construction': ['施工合同', 'construction-contract:read'],
  '/contract/subcontract': ['分包合同', 'subcontract-contract:read'],
  '/contract/material': ['材料采购合同', 'material-contract:read'],
  '/contract/boq': ['工程量清单'],
  '/contract/other-expense': ['其他支出合同', 'auxiliary-contract:read'],
  '/contract/company-expense': ['公司支出合同', 'auxiliary-contract:read'],
  '/contract/other-settlement': ['其他支出结算', 'other-settlement:read'],
  '/owner/change': ['甲方变洽签', 'owner-document:read'],
  '/owner/report': ['甲方报量', 'owner-document:read'],
  '/owner/acceptance': ['竣工验收与保修', 'owner-document:read'],
  '/owner/final-settlement': ['最终结算', 'owner-document:read'],
  '/owner/penalty': ['甲方罚扣', 'owner-document:read'],
  '/subcontract/change': ['分包变洽签', 'subcontract-document:read'],
  '/subcontract/settlement': ['分包结算', 'subcontract-document:read'],
  '/project/penalty': ['项目罚扣', 'subcontract-document:read'],
  '/subcontract/quantity': ['工程量管理'],
  '/subcontract/payroll': ['工资核算'],
  '/subcontract/attendance': ['考勤管理'],
  '/subcontract/daywork': ['签工管理'],
  '/material/requisition': ['下料单'],
  '/material/arrival': ['材料到货'],
  '/material/use': ['材料领用'],
  '/material/settlement': ['材料采购结算'],
  '/material/stock-check': ['库存盘点'],
  '/material/delivery/archive': ['送货单归档库', 'delivery:read'],
  '/material/price': ['单价对比'],
  '/owner-material/control': ['甲供材总控量'],
  '/owner-material/requisition': ['甲供材下料单'],
  '/owner-material/arrival': ['甲供材到货'],
  '/owner-material/use': ['甲供材领用'],
  '/owner-material/direct': ['甲供材直入直出'],
  '/finance/ledger': ['发票台账'],
  '/finance/invoice/factor': ['开票因子与税额计算'],
  '/finance/payment': ['付款申请'],
  '/finance/payment-management': ['付款管理'],
  '/finance/receipt': ['收款登记', 'receipt:read'],
  '/finance/billing': ['开票申请'],
  '/finance/current': ['往来收付'],
  '/finance/records': ['支付记录'],
  '/finance/reimbursement': ['费用报销'],
  '/base/customer': ['客户', 'customer:list:read'],
  '/base/supplier': ['分供方', 'supplier:list:read'],
  '/base/crew': ['班组', 'crew:list:read'],
  '/base/worker': ['工人', 'worker:list:read'],
}

export interface RestoredDetailPath {
  family: string
  id: string
  secondId?: string
  kind?: string
}

const DETAIL_PATTERNS: Array<[RegExp, (matches: RegExpExecArray) => RestoredDetailPath]> = [
  [/^\/schedule\/process-library\/([^/]+)$/, m => ({ family: 'process-library', id: m[1]! })],
  [/^\/project\/([^/]+)\/supplier\/([^/]+)$/, m => ({ family: 'project-supplier', id: m[1]!, secondId: m[2]! })],
  [/^\/project\/([^/]+)$/, m => ({ family: 'project', id: m[1]! })],
  [/^\/base\/(customer|supplier|crew|worker)\/([^/]+)$/, m => ({ family: m[1]!, id: m[2]! })],
  [/^\/contract\/(other-expense|company-expense|other-settlement)\/([^/]+)$/, m => ({ family: m[1] === 'other-settlement' ? 'other-settlement' : 'auxiliary', kind: m[1]!.replaceAll('-', '_'), id: m[2]! })],
  [/^\/contract\/([^/]+)$/, m => ({ family: 'contract', id: m[1]! })],
  [/^\/owner\/(change|report|acceptance|final-settlement|penalty)\/([^/]+)$/, m => ({ family: 'owner-document', kind: m[1]!, id: m[2]! })],
  [/^\/subcontract\/(change|settlement)\/([^/]+)$/, m => ({ family: 'subcontract-document', kind: m[1]!, id: m[2]! })],
  [/^\/project\/penalty\/([^/]+)$/, m => ({ family: 'subcontract-document', kind: 'penalty', id: m[1]! })],
  [/^\/finance\/receipt\/([^/]+)$/, m => ({ family: 'receipt', id: m[1]! })],
  [/^\/material\/delivery\/archive\/([^/]+)$/, m => ({ family: 'delivery', id: m[1]! })],
  [/^\/finance\/payment\/([^/]+)\/detail$/, m => ({ family: 'unconnected', id: m[1]! })],
  [/^\/subcontract\/payroll\/([^/]+)$/, m => ({ family: 'crew-worker-fact', kind: 'wage', id: m[1]! })],
  [/^\/subcontract\/quantity\/([^/]+)\/([^/]+)$/, m => ({ family: 'crew-worker-fact', kind: 'assignment', id: m[2]!, secondId: m[1]! })],
  [/^\/(?:project\/target-cost|schedule|base\/supplier\/credential)\/([^/]+)$/, m => ({ family: 'unconnected', id: m[1]! })],
]

const LIST_QUERY = new Set(['origin', 'search', 'page', 'pageSize', 'sort', 'status', 'category', 'type', 'projectId', 'supplierId', 'customerId', 'contractId', 'project', 'supplier', 'customer', 'contract', 'phase', 'manager', 'plannedEnd', 'trade', 'crewId', 'crew', 'projectStatus', 'month', 'tab', 'variant', 'nav', 'returnTo', 'returnContext', 'credentialStatus', 'columnFilters', 'subKind', 'documentType', 'from', 'group', 'task', 'stage', 'item', 'building', 'buildings', 'groupName', 'taskName', 'itemName', 'planStart', 'planFinish', 'focus'])
const DETAIL_QUERY = new Set(['origin', 'contractKind', 'tab', 'variant', 'customerId', 'contractId', 'ownerKind', 'ownerId', 'focus', 'focusView', 'returnTo', 'returnContext', 'relationContext', 'nav'])
const WRITE_SEGMENTS = new Set(['new', 'form', 'edit', 'import', 'template', 'dev'])

function hasControlCharacters(value: string): boolean {
  return [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
}

function parsePath(fullPath: string, depth = 0): { inspected: RestorableTabPath, url: URL, detail: RestoredDetailPath | null } | null {
  if (depth > 4 || fullPath.length > 131072 || !fullPath.startsWith('/') || fullPath.startsWith('//') || fullPath.includes('\\') || hasControlCharacters(fullPath))
    return null
  try {
    const rawPath = fullPath.split(/[?#]/)[0]!
    const segments = rawPath.split('/').map(decodeURIComponent)
    if (segments.some(segment => segment === '.' || segment === '..' || WRITE_SEGMENTS.has(segment) || segment.includes('\\') || hasControlCharacters(segment)))
      return null
    const url = new URL(fullPath, 'https://ruihang.invalid')
    if (url.origin !== 'https://ruihang.invalid')
      return null
    let detail: RestoredDetailPath | null = null
    if (!Object.hasOwn(LISTS, url.pathname)) {
      for (const [pattern, classify] of DETAIL_PATTERNS) {
        const matches = pattern.exec(url.pathname)
        if (matches) {
          detail = classify(matches)
          detail.id = decodeURIComponent(detail.id)
          if (detail.secondId)
            detail.secondId = decodeURIComponent(detail.secondId)
          break
        }
      }
      if (!detail || !isStableRouteIdentity(detail.id) || (detail.secondId != null && !isStableRouteIdentity(detail.secondId)))
        return null
    }
    const originValue = url.searchParams.get('origin')
    if (url.searchParams.getAll('origin').length > 1 || (originValue != null && originValue !== 'real' && originValue !== 'demo'))
      return null
    const origin = originValue as DataOriginDTO | null ?? (detail ? 'real' : null)
    const baseAllowed = detail ? DETAIL_QUERY : LIST_QUERY
    const quantity = url.pathname === '/subcontract/quantity' || (detail?.family === 'crew-worker-fact' && detail.kind === 'assignment')
    const allowed = quantity ? new Set([...baseAllowed, ...QUANTITY_FILTER_KEYS]) : baseAllowed
    for (const key of [...url.searchParams.keys()]) {
      if (!allowed.has(key) || url.searchParams.getAll(key).some(hasControlCharacters))
        url.searchParams.delete(key)
    }
    for (const key of ['contractKind', 'variant', 'customerId', 'contractId', 'ownerKind', 'ownerId', 'tab', 'focus', 'focusView', 'returnTo', 'returnContext', 'relationContext']) {
      if (url.searchParams.getAll(key).length > 1)
        return null
    }
    const returnTo = url.searchParams.get('returnTo')
    if (returnTo) {
      const nested = parsePath(returnTo, depth + 1)
      if (nested && (origin == null || nested.inspected.origin == null || nested.inspected.origin === origin))
        url.searchParams.set('returnTo', nested.inspected.fullPath)
      else
        url.searchParams.delete('returnTo')
    }
    if (url.hash && !/^#[\w%.:~-]+$/.test(url.hash))
      url.hash = ''
    return { inspected: { fullPath: `${url.pathname}${url.search}${url.hash}`, origin }, url, detail }
  }
  catch {
    return null
  }
}

export function inspectRestorableTabPath(fullPath: string): RestorableTabPath | null {
  return parsePath(fullPath)?.inspected ?? null
}

export function createTabRestoreValidator(options: { repositories: DomainRepositories, includeDemo: () => boolean, capabilities: () => readonly string[] }): TabRestoreValidator {
  return async (descriptor, signal) => {
    checkRestoreAbort(signal)
    if (descriptor.targetVersion !== TAB_TARGET_VERSION)
      return restoreProblem('stale')
    const parsed = parsePath(descriptor.fullPath)
    if (!parsed || parsed.inspected.origin !== descriptor.origin)
      return restoreProblem('mismatch')
    if (parsed.inspected.origin === 'demo' && (!options.includeDemo() || !options.capabilities().includes('demo:read')))
      return restoreProblem('forbidden')
    if (parsed.url.pathname === '/schedule' && parsed.inspected.origin != null) {
      const id = parsed.url.searchParams.get('project')
      if (!isStableRouteIdentity(id) || parsed.url.searchParams.getAll('project').length !== 1)
        return restoreProblem('mismatch')
      parsed.detail = { family: 'schedule-project', id }
    }
    if (!parsed.detail) {
      const [title, capability] = LISTS[parsed.url.pathname]!
      if (capability && !options.capabilities().includes(capability))
        return restoreProblem('forbidden')
      return { state: 'resolved', fullPath: parsed.inspected.fullPath, title, sourceVersion: null }
    }
    try {
      const result = await readRestoredDetail({ ...options, detail: parsed.detail, path: parsed.inspected, url: parsed.url, signal })
      checkRestoreAbort(signal)
      return result
    }
    catch (cause) {
      checkRestoreAbort(signal)
      const code = (cause as { problem?: { code?: string } })?.problem?.code
      return restoreProblem(code === 'not-found' ? 'not-found' : code === 'forbidden' ? 'forbidden' : code === 'stale-source' ? 'stale' : code === 'relationship-mismatch' || code === 'invalid-query' || code === 'invalid-response' ? 'mismatch' : 'error')
    }
  }
}
