import type { CommandRecoveryDescriptor, RecoveryStorage } from '../forms/command-recovery'
import type { BoqCommand } from './production-contract'
import { commandRecoveryKey, createCommandRecoveryStorage } from '../forms/command-recovery'
import { quantityProblem } from '../quantity/central-contract'

export function boqRecoveryDescriptor(command: BoqCommand): CommandRecoveryDescriptor {
  const action = command.action
  const targetId = action.kind === 'import-file' ? `import:${command.projectId}:${command.contractId}` : action.kind === 'restore-import' ? action.importId : action.kind === 'reject-change' ? action.changeId : action.kind === 'owner-change' ? action.command.id ?? `change:${command.projectId}:${command.contractId}:new` : action.lineId
  return { workspaceId: command.workspaceId, actorId: command.actorId, commandId: command.commandId, family: 'boq', targetId, action: action.kind, scopeId: `${command.projectId}:${command.contractId}` }
}
export function readBoqRecoveryForRoute(fullPath: string, identity: { workspaceId: string, actorId: string }, storage: RecoveryStorage & Pick<Storage, 'length' | 'key'>) {
  if (!fullPath.startsWith('/') || fullPath.startsWith('//') || fullPath.includes('\\') || [...fullPath].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
    return []
  const url = new URL(fullPath, 'https://boq.invalid')
  if (url.origin !== 'https://boq.invalid' || /%2f|%5c/i.test(url.pathname) || !['/contract/boq', '/contract/boq/import', '/contract/boq/building-evidence'].includes(url.pathname) || url.searchParams.getAll('origin').length > 1 || (url.searchParams.has('origin') && url.searchParams.get('origin') !== 'real'))
    return []
  const projectValues = ['project', 'projectId', 'pid'].flatMap(key => url.searchParams.getAll(key))
  const contractValues = ['contract', 'contractId'].flatMap(key => url.searchParams.getAll(key))
  const validId = (value: string) => /^[a-z0-9][\w-]{2,79}$/i.test(value)
  if (projectValues.length > 1 || contractValues.length > 1 || [...projectValues, ...contractValues].some(value => !validId(value)))
    return []
  const project = projectValues[0]
  const contract = contractValues[0]
  const prefix = `crm:form-command:v1:${['boq', identity.workspaceId, identity.actorId].map(encodeURIComponent).join(':')}:`
  const codec = createCommandRecoveryStorage(() => storage)
  const output: CommandRecoveryDescriptor[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (!key?.startsWith(prefix))
      continue
    const descriptor = codec.read(key)
    if (!descriptor || descriptor.family !== 'boq' || descriptor.workspaceId !== identity.workspaceId || descriptor.actorId !== identity.actorId || commandRecoveryKey(descriptor) !== key || !['import-file', 'patch-line', 'delete-line', 'owner-change', 'restore-import', 'reject-change', 'correct-building'].includes(descriptor.action))
      throw quantityProblem('unavailable', '原清单恢复定位已损坏，保留已有浏览器资料')
    const parts = descriptor.scopeId?.split(':')
    if (!parts || parts.length !== 2 || !parts.every(validId))
      throw quantityProblem('unavailable', '原清单真实项目或施工主合同定位无效')
    if ((project && parts[0] !== project) || (contract && parts[1] !== contract))
      continue
    output.push(descriptor)
  }
  return output
}

/** Complete-source recovery belongs only to this exact tool page and its original SHA/batch locators. */
export function readBoqSourceImportRecoveryForRoute(fullPath: string, identity: { workspaceId: string, actorId: string }, storage: RecoveryStorage & Pick<Storage, 'length' | 'key'>) {
  if (!fullPath.startsWith('/') || fullPath.startsWith('//') || fullPath.includes('\\') || [...fullPath].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
    return []
  const url = new URL(fullPath, 'https://boq.invalid')
  if (url.origin !== 'https://boq.invalid' || /%2f|%5c/i.test(url.pathname) || url.pathname !== '/contract/boq/import' || url.searchParams.getAll('origin').length > 1 || (url.searchParams.has('origin') && url.searchParams.get('origin') !== 'real'))
    return []
  const project = ['project', 'projectId', 'pid'].flatMap(key => url.searchParams.getAll(key))
  const contract = ['contract', 'contractId'].flatMap(key => url.searchParams.getAll(key))
  const source = ['source', 'sourceSha256'].flatMap(key => url.searchParams.getAll(key))
  const imported = ['import', 'importId'].flatMap(key => url.searchParams.getAll(key))
  const id = (value: string) => /^[a-z0-9][\w-]{2,79}$/i.test(value)
  if ([project, contract, source, imported].some(values => values.length > 1) || [...project, ...contract, ...imported].some(value => !id(value)) || source.some(value => !/^[a-f0-9]{64}$/.test(value)))
    return []
  const codec = createCommandRecoveryStorage(() => storage)
  const prefix = `crm:form-command:v1:${['boq-import', identity.workspaceId, identity.actorId].map(encodeURIComponent).join(':')}:`
  const output: CommandRecoveryDescriptor[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (!key?.startsWith(prefix))
      continue
    const row = codec.read(key)
    if (!row || row.family !== 'boq-import' || row.workspaceId !== identity.workspaceId || row.actorId !== identity.actorId || !/^[a-f0-9]{64}$/.test(String(row.scopeId)) || !['adopt', 'restore'].includes(row.action) || (row.action === 'adopt' ? row.targetId !== row.scopeId : !row.targetId || !id(row.targetId)))
      throw quantityProblem('unavailable', '原完整清单恢复定位损坏，保留已有浏览器资料')
    if ((source[0] && row.scopeId !== source[0]) || (imported[0] && (row.action !== 'restore' || row.targetId !== imported[0])))
      continue
    output.push(row)
  }
  return output
}
