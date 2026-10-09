import type { CommandRecoveryDescriptor, CommandResolution } from '../forms/command-recovery'
import type { ScheduleCatalog, ScheduleCommand, ScheduleCommandResult, ScheduleRead, ScheduleReadContext, ScheduleReadQuery, ScheduleScopeRead } from './central-contract'
import { readProjectHttp } from '../project/http-repository'
import { decodeScheduleBindingRead } from './central-binding-decoder'
import { scheduleProblem } from './central-contract'
import { calendarDays } from './planning'

export type ScheduleFetcher = (url: string, options?: { method?: 'POST', query?: Record<string, unknown>, body?: ScheduleCommand | CommandRecoveryDescriptor, signal?: AbortSignal }) => Promise<unknown>
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function invalid(): never {
  throw scheduleProblem('unavailable', '排程服务返回无效或错配事实，请保留草稿重新读取')
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string')
}
function context(value: unknown, origin: 'real' | 'demo'): asserts value is ScheduleReadContext {
  if (!object(value) || value.origin !== origin || !strings(value.capabilities) || !['workspaceId', 'actorId', 'sourceVersion'].every(key => typeof value[key] === 'string' && Boolean(value[key])))
    invalid()
}
function read(value: unknown, query: ScheduleReadQuery): ScheduleRead {
  context(value, query.origin)
  const candidate = value as ScheduleRead
  if (!object(candidate.snapshot) || candidate.snapshot.id !== query.projectId || !Array.isArray(candidate.snapshot.groups)
    || !object(candidate.history) || !Array.isArray(candidate.history.logs) || !Array.isArray(candidate.history.removedTasks) || !Array.isArray(candidate.history.migrationEvidence)
    || !Array.isArray(candidate.snapshot.dependencies) || !Array.isArray(candidate.snapshot.disabledDependencies)
    || !Array.isArray(candidate.contracts) || !Array.isArray(candidate.buildings) || !Array.isArray(candidate.buildingCoverage)) {
    invalid()
  }
  const groups = new Set<string>()
  const tasks = new Set<string>()
  for (const group of candidate.snapshot.groups) {
    if (!object(group) || typeof group.id !== 'string' || groups.has(group.id) || group.projectId !== query.projectId
      || !Array.isArray(group.tasks) || !strings(group.buildingIds) || !strings(group.buildingNames) || !['contract', 'provisional'].includes(String(group.scopeBasis))) {
      invalid()
    }
    groups.add(group.id)
    for (const task of group.tasks) {
      if (!object(task) || typeof task.id !== 'string' || tasks.has(task.id) || task.projectId !== query.projectId || task.groupId !== group.id
        || !strings(task.itemIds) || !Array.isArray(task.floorPlans) || !Number.isFinite(task.actualProgress) || !Number.isFinite(task.plannedProgress)) {
        invalid()
      }
      try {
        if (calendarDays(String(task.plannedStart), String(task.plannedFinish)) < 0)
          invalid()
      }
      catch { invalid() }
      for (const floor of task.floorPlans) {
        // 冻结楼层保留创建时的分项，当前映射软删除不能使历史计划变成坏响应。
        if (!object(floor) || floor.taskId !== task.id || typeof floor.itemId !== 'string' || !floor.itemId)
          invalid()
      }
      tasks.add(task.id)
    }
  }
  for (const relation of [...candidate.snapshot.dependencies, ...candidate.snapshot.disabledDependencies]) {
    if (!object(relation) || typeof relation.predId !== 'string' || typeof relation.succId !== 'string' || !tasks.has(relation.predId) || !tasks.has(relation.succId))
      invalid()
  }
  if (candidate.contracts.some(row => row.projectId !== query.projectId) || candidate.buildings.some(row => row.projectId !== query.projectId))
    invalid()
  return structuredClone(candidate)
}
export function createScheduleRepository(fetcher: ScheduleFetcher) {
  return {
    binding(query: ScheduleReadQuery, groupId: string, contractId = '') {
      const scope = { ...query }
      return readProjectHttp(() => fetcher('/api/read/schedule/binding', { query: { ...scope, groupId, contractId } }), (value) => {
        context(value, scope.origin)
        return decodeScheduleBindingRead(value, scope.projectId, groupId, contractId)
      })
    },
    catalog(origin: 'real' | 'demo', includeDemo = false): Promise<ScheduleCatalog> {
      return readProjectHttp(() => fetcher('/api/read/schedule/catalog', { query: { origin, includeDemo } }), (value) => {
        context(value, origin)
        const result = value as ScheduleCatalog
        if (!Array.isArray(result.projects) || result.projects.some(row => !row.id || row.origin !== origin || !Number.isSafeInteger(row.groupCount)))
          invalid()
        return structuredClone(result)
      })
    },
    read(query: ScheduleReadQuery, contractId = ''): Promise<ScheduleRead> {
      const scope = { ...query }
      return readProjectHttp(() => fetcher('/api/read/schedule/workspace', { query: { ...scope, contractId } }), value => read(value, scope))
    },
    scope(query: ScheduleReadQuery, buildingIds: readonly string[]): Promise<ScheduleScopeRead> {
      const scope = { ...query }
      return readProjectHttp(() => fetcher('/api/read/schedule/scope', { query: { ...scope, buildingIds: [...buildingIds] } }), (value) => {
        context(value, scope.origin)
        const result = value as ScheduleScopeRead
        if (!object(result.preview) || !Array.isArray(result.preview.buildings) || !Array.isArray(result.preview.quantities)
          || result.preview.buildings.some(row => !buildingIds.includes(row.buildingId) || !Array.isArray(row.quantities) || !strings(row.blockers))) {
          invalid()
        }
        return structuredClone(result)
      })
    },
    execute(command: ScheduleCommand): Promise<ScheduleCommandResult> {
      const frozen = structuredClone(command)
      return readProjectHttp(() => fetcher('/api/commands/schedule', { method: 'POST', body: frozen }), (value) => {
        if (!object(value) || value.commandId !== frozen.commandId || value.projectId !== frozen.projectId || typeof value.sourceVersion !== 'string' || !value.sourceVersion || !('value' in value))
          invalid()
        return structuredClone(value) as unknown as ScheduleCommandResult
      })
    },
    resolve(descriptor: CommandRecoveryDescriptor): Promise<CommandResolution<ScheduleCommandResult>> {
      const frozen = structuredClone(descriptor)
      return readProjectHttp(() => fetcher('/api/commands/schedule/resolve', { method: 'POST', body: frozen }), (value) => {
        if (!object(value) || (value.outcome !== 'applied' && value.outcome !== 'not-applied'))
          invalid()
        if (value.outcome === 'not-applied') {
          if (value.commandId !== frozen.commandId)
            invalid()
        }
        else if (!object(value.result) || value.result.commandId !== frozen.commandId || value.result.projectId !== frozen.targetId || typeof value.result.sourceVersion !== 'string' || !('value' in value.result)) {
          invalid()
        }
        return structuredClone(value) as unknown as CommandResolution<ScheduleCommandResult>
      })
    },
  }
}
