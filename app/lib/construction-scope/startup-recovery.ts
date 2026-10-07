import type { CommandRecoveryDescriptor } from '../forms/command-recovery'
import type { ConstructionScopeActor } from './contract'
import { commandRecoveryKey, createCommandRecoveryStorage } from '../forms/command-recovery'
import { decodeConstructionScopeSource } from './contract'

/** Only original minimal descriptors; no relationship body or economic facts are persisted in the browser. */
export function readConstructionScopeStartupDescriptors(fullPath: string, actor: ConstructionScopeActor, storage: Storage = sessionStorage): CommandRecoveryDescriptor[] {
  if (!fullPath.startsWith('/') || fullPath.startsWith('//') || fullPath.includes('\\'))
    return []
  let url: URL
  try {
    url = new URL(fullPath, 'https://ruihang.invalid')
  }
  catch { return [] }
  if (url.searchParams.getAll('origin').length > 1 || (url.searchParams.has('origin') && url.searchParams.get('origin') !== 'real'))
    return []
  const material = /^\/contract\/material\/form\/([^/]+)$/.exec(url.pathname)
  const expense = /^\/finance\/reimbursement\/([^/]+)$/.exec(url.pathname)
  const subcontract = /^\/contract\/subcontract\/form\/([^/]+)$/.exec(url.pathname)
  const auxiliary = /^\/contract\/other-expense\/form\/([^/]+)$/.exec(url.pathname)
  const parent = material ?? expense ?? subcontract ?? auxiliary
  const domain = material ? 'material-contract' : expense ? 'original-expense' : subcontract ? 'subcontract-contract' : 'auxiliary-contract'
  if (!parent)
    return []
  let parentId: string
  try {
    parentId = decodeURIComponent(parent[1]!)
    decodeConstructionScopeSource({ domain, id: parentId })
  }
  catch { return [] }
  const recovery = createCommandRecoveryStorage(() => storage)
  const descriptors: CommandRecoveryDescriptor[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    const prefix = `crm:form-command:v1:${['construction-scope', actor.workspaceId, actor.actorId].map(encodeURIComponent).join(':')}:`
    if (!key?.startsWith(prefix))
      continue
    const descriptor = recovery.read(key)
    if (descriptor && descriptor.workspaceId === actor.workspaceId && descriptor.actorId === actor.actorId && descriptor.family === 'construction-scope' && descriptor.scopeId === parentId && descriptor.targetId?.startsWith(`${domain}:`) && commandRecoveryKey(descriptor) === key && ['bind', 'unbind'].includes(descriptor.action)) {
      if (!expense && descriptor.targetId !== `${domain}:${parentId}`)
        continue
      try {
        decodeConstructionScopeSource({ domain, id: descriptor.targetId.slice(descriptor.targetId.indexOf(':') + 1) })
      }
      catch { continue }
      descriptors.push(descriptor)
    }
  }
  return descriptors
}
