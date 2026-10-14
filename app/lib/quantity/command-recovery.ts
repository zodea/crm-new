import type { CommandRecoveryDescriptor, CommandResolution, RecoveryStorage } from '../forms/command-recovery'
import type { QuantityCommand, QuantityCommandResult, QuantityContext, QuantityReadQuery } from './central-contract'
import { commandRecoveryKey, createCommandRecoveryStorage } from '../forms/command-recovery'
import { quantityProblem } from './central-contract'

export const QUANTITY_RECOVERY_ACTIONS = ['create-building', 'create-floor', 'create-unit', 'save-template', 'delete-template', 'undo-template', 'save-stage', 'set-reporting-stage', 'save-assignments', 'save-completion', 'save-completion-batch', 'set-archived', 'import-row', 'create-hollow-inspection', 'revise-hollow-inspection', 'rectify-hollow-inspection'] as const

/** Minimal markers distinguish each project, work surface, and original target. */
export function quantityRecoveryDescriptor(command: QuantityCommand): CommandRecoveryDescriptor {
  const action = command.action
  const project = command.projectId
  let target = `matrix:${project}:matrix`
  if (action.kind === 'create-building')
    target = `region:${project}:new-building`
  else if (action.kind === 'create-floor')
    target = `region:${project}:building:${action.buildingId}`
  else if (action.kind === 'create-unit')
    target = `region:${project}:floor:${action.floorId}`
  else if (action.kind === 'save-template')
    target = `templates:${project}:template:${action.draft.id ?? 'new'}`
  else if (action.kind === 'delete-template')
    target = `templates:${project}:template:${action.templateId}`
  else if (action.kind === 'undo-template')
    target = `templates:${project}:undo`
  else if (action.kind === 'save-stage')
    target = `stages:${project}:stage:${action.draft.id ?? 'new'}`
  else if (action.kind === 'set-reporting-stage')
    target = `stages:${project}:item:${action.itemId}`
  else if (action.kind === 'save-assignments')
    target = `assignments:${project}:trade:${action.draft.trade}`
  else if (action.kind === 'save-completion')
    target = `completion:${project}:unit:${action.draft.unitId}`
  else if (action.kind === 'save-completion-batch')
    target = `batch:${project}:trade:${action.draft.trade}`
  else if (action.kind === 'import-row')
    target = `${action.target === 'template' ? 'templates' : action.target === 'assignment' ? 'assignments' : 'completion'}:${project}:import:${action.unitId ?? 'new'}`
  else if (action.kind === 'create-hollow-inspection')
    target = `hollow:${project}:unit:${action.target.unitId}`
  else if (action.kind === 'revise-hollow-inspection' || action.kind === 'rectify-hollow-inspection')
    target = `hollow:${project}:record:${action.recordId}`
  return { workspaceId: command.workspaceId, actorId: command.actorId, commandId: command.commandId, family: 'quantity', action: action.kind, targetId: target, scopeId: project }
}

export function quantityRouteRecoveryScopes(fullPath: string) {
  if (typeof fullPath !== 'string' || !fullPath.startsWith('/') || fullPath.startsWith('//') || fullPath.includes('\\') || [...fullPath].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
    return []
  const url = new URL(fullPath, 'http://quantity.local')
  const origins = url.searchParams.getAll('origin')
  if (url.origin !== 'http://quantity.local' || origins.length > 1 || (origins.length && origins[0] !== 'real') || /%5c/i.test(url.pathname))
    return []
  if (url.pathname === '/subcontract/quantity/import')
    return [{ family: 'quantity-import', targetPrefix: null, exactTarget: null, scopeId: null }]
  const detail = url.pathname.match(/^\/subcontract\/quantity\/([^/]+)\/([^/]+)(?:\/hollow\/(new|form\/([^/]+)|([^/]+)))?$/)
  const projects = ['project', 'projectId', 'pid'].flatMap(key => url.searchParams.getAll(key))
  if (projects.length > 1)
    return []
  let pathProject = ''
  try {
    pathProject = detail ? decodeURIComponent(detail[1]!) : ''
  }
  catch { return [] }
  const project = projects[0] || pathProject
  if (pathProject && pathProject !== project)
    return []
  if (!project)
    return []
  if (/[\s/\\?#]/.test(project))
    return []
  if (detail) {
    try {
      const unit = decodeURIComponent(detail[2]!)
      const record = detail[4] || detail[5]
      if (/[\s/\\?#]/.test(unit) || (record && /[\s/\\?#]/.test(decodeURIComponent(record))))
        return []
      const targets = record
        ? [`hollow:${project}:record:${decodeURIComponent(record)}`]
        : detail[3] === 'new'
          ? [`hollow:${project}:unit:${unit}`]
          : [`completion:${project}:unit:${unit}`, `completion:${project}:import:${unit}`, `hollow:${project}:unit:${unit}`]
      return targets.map(target => ({ family: 'quantity', targetPrefix: target, exactTarget: target, scopeId: project }))
    }
    catch { return [] }
  }
  const surfaces = url.pathname === '/subcontract/quantity/region'
    ? ['region']
    : url.pathname === '/subcontract/quantity/template'
      ? ['templates']
      : url.pathname === '/subcontract/quantity/stages'
        ? ['stages']
        : url.pathname.startsWith('/subcontract/hollow/')
          ? ['hollow']
          : detail ? ['completion', 'hollow'] : url.pathname === '/subcontract/quantity' ? ['matrix', 'assignments', 'batch'] : []
  return surfaces.map(surface => ({ family: 'quantity', targetPrefix: `${surface}:${project}:`, exactTarget: null, scopeId: project }))
}

/** Pure startup inspection: no marker writes, database reads, or source opening. */
export function readQuantityRecoveryForRoute(fullPath: string, identity: { workspaceId: string, actorId: string }, storage: RecoveryStorage & Pick<Storage, 'length' | 'key'>) {
  const scopes = quantityRouteRecoveryScopes(fullPath)
  const codec = createCommandRecoveryStorage(() => storage)
  const output: CommandRecoveryDescriptor[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (!key)
      continue
    for (const scope of scopes) {
      const head = `crm:form-command:v1:${[scope.family, identity.workspaceId, identity.actorId].map(encodeURIComponent).join(':')}:`
      if (!key.startsWith(head))
        continue
      const target = decodeURIComponent(key.slice(head.length))
      if (scope.targetPrefix !== null && !target.startsWith(scope.targetPrefix))
        continue
      if (scope.exactTarget !== null && target !== scope.exactTarget)
        continue
      const descriptor = codec.read(key)
      if (!descriptor || descriptor.workspaceId !== identity.workspaceId || descriptor.actorId !== identity.actorId || descriptor.family !== scope.family
        || (scope.scopeId !== null && descriptor.scopeId !== scope.scopeId) || commandRecoveryKey(descriptor) !== key
        || (descriptor.family === 'quantity' && !QUANTITY_RECOVERY_ACTIONS.includes(descriptor.action as typeof QUANTITY_RECOVERY_ACTIONS[number]))) {
        throw quantityProblem('unavailable', '原工程量恢复定位无法核对；请保留已有存储')
      }
      if (descriptor.family === 'quantity-import' && (!/^[a-f0-9]{64}$/.test(descriptor.scopeId ?? '') || !((descriptor.action === 'adopt' && descriptor.targetId === null) || (descriptor.action === 'restore' && descriptor.targetId !== null))))
        throw quantityProblem('unavailable', '原迁入定位动作或来源无效')
      output.push(descriptor)
    }
  }
  return output
}

export function createQuantityWorkspaceRecovery(surface: string, enabled: () => boolean, resolve: (descriptor: CommandRecoveryDescriptor) => Promise<CommandResolution<QuantityCommandResult>>, storage: () => Storage = () => globalThis.sessionStorage) {
  const codec = createCommandRecoveryStorage(storage)
  return {
    enabled,
    find(query: QuantityReadQuery, context: QuantityContext) {
      const project = encodeURIComponent(query.projectId)
      const unit = 'unitId' in query ? String(query.unitId) : ''
      const path = surface === 'completion'
        ? `/subcontract/quantity/${project}/${encodeURIComponent(unit)}`
        : `/subcontract/quantity${surface === 'templates' ? '/template' : surface === 'region' ? '/region' : surface === 'stages' ? '/stages' : ''}?project=${project}&origin=real`
      return readQuantityRecoveryForRoute(path, context, storage()).filter(descriptor => descriptor.targetId?.startsWith(`${surface}:${query.projectId}:`))
    },
    remember(command: QuantityCommand) {
      const descriptor = quantityRecoveryDescriptor(command)
      codec.remember(commandRecoveryKey(descriptor), descriptor)
      return descriptor
    },
    clear: (descriptor: CommandRecoveryDescriptor) => codec.clear(commandRecoveryKey(descriptor), descriptor.commandId),
    resolve,
  }
}
