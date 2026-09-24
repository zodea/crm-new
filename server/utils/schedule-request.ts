import type { ScheduleCommand, ScheduleReadQuery } from '../../app/lib/schedule/central-contract'
import { scheduleProblem } from '../../app/lib/schedule/central-contract'
import { calendarDays } from '../../app/lib/schedule/planning'

export function scheduleObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function invalid(): never {
  throw scheduleProblem('validation-failed', '排程身份、日期或命令字段无效')
}
export function parseScheduleRead(value: unknown): ScheduleReadQuery {
  if (!scheduleObject(value) || typeof value.projectId !== 'string' || !value.projectId.trim() || !['real', 'demo'].includes(String(value.origin))
    || ![undefined, true, false, 'true', 'false'].includes(value.includeDemo as never)) {
    invalid()
  }
  if (value.today !== undefined && (typeof value.today !== 'string' || calendarDays(value.today, value.today) !== 0))
    invalid()
  return { projectId: value.projectId, origin: value.origin as 'real' | 'demo', includeDemo: value.includeDemo === true || value.includeDemo === 'true', ...(typeof value.today === 'string' ? { today: value.today } : {}) }
}
const actions: Record<string, string[]> = {
  'create-group': ['draft'],
  'update-task': ['taskId', 'patch'],
  'update-floors': ['taskId', 'patches'],
  'update-dependency': ['successorId', 'predecessorId', 'lagDays'],
  'save-task-plan': ['taskId', 'draft'],
  'reschedule-task': ['taskId', 'patch', 'dependencyIdsToDisable'],
  'remove-dependency': ['dependencyId'],
  'restore-dependency': ['dependencyId'],
  'set-baseline': [],
  'add-task': ['groupId', 'draft'],
  'remove-task': ['taskId'],
  'undo': ['logIds'],
  'bind-contract': ['groupId', 'contractId'],
}
function record(value: unknown, keys: readonly string[]) {
  if (!scheduleObject(value) || Object.keys(value).some(key => !keys.includes(key)))
    invalid()
  return value
}
function text(value: unknown, empty = false) {
  if (typeof value !== 'string' || (!empty && !value.trim()))
    invalid()
}
function ids(value: unknown) {
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string' || !entry.trim()) || new Set(value).size !== value.length)
    invalid()
}
function date(value: unknown) {
  text(value)
  try {
    calendarDays(value as string, value as string)
  }
  catch { invalid() }
}
function patch(value: unknown) {
  const input = record(value, ['plannedStart', 'plannedFinish', 'manualProgress'])
  if (input.plannedStart !== undefined)
    date(input.plannedStart)
  if (input.plannedFinish !== undefined)
    date(input.plannedFinish)
  if (input.manualProgress !== undefined && (typeof input.manualProgress !== 'number' || !Number.isFinite(input.manualProgress) || input.manualProgress < 0 || input.manualProgress > 1))
    invalid()
}
function floors(value: unknown) {
  if (!Array.isArray(value))
    invalid()
  ids(value.map(row => scheduleObject(row) ? row.id : null))
  for (const valueRow of value) {
    const row = record(valueRow, ['id', 'plannedStart', 'plannedFinish'])
    text(row.id)
    date(row.plannedStart)
    date(row.plannedFinish)
  }
}
function validateAction(action: Record<string, unknown>) {
  for (const key of ['taskId', 'groupId', 'contractId', 'dependencyId', 'successorId', 'predecessorId']) {
    if (key in action)
      text(action[key])
  }
  if ('dependencyIdsToDisable' in action)
    ids(action.dependencyIdsToDisable)
  if ('logIds' in action)
    ids(action.logIds)
  if ('patch' in action)
    patch(action.patch)
  if ('patches' in action)
    floors(action.patches)
  if ('lagDays' in action && (typeof action.lagDays !== 'number' || !Number.isInteger(action.lagDays)))
    invalid()
  if (action.kind === 'create-group') {
    const draft = record(action.draft, ['projectId', 'scopeBasis', 'contractId', 'processLibraryId', 'librarySourceVersion', 'name', 'buildingIds', 'startDate', 'overlapMode', 'tasks'])
    text(draft.projectId)
    text(draft.name)
    text(draft.processLibraryId)
    ids(draft.buildingIds)
    date(draft.startDate)
    if (!['contract', 'provisional'].includes(String(draft.scopeBasis)) || !['half', 'seq', 'same'].includes(String(draft.overlapMode)) || !Array.isArray(draft.tasks) || !draft.tasks.length)
      invalid()
    if (draft.librarySourceVersion !== undefined)
      text(draft.librarySourceVersion)
    if (draft.contractId !== undefined && draft.contractId !== null)
      text(draft.contractId, true)
    ids(draft.tasks.map(row => scheduleObject(row) ? row.templateKey : null))
    for (const value of draft.tasks) {
      const task = record(value, ['templateKey', 'predecessorKey', 'predecessorDisabled', 'durationDays', 'enabled', 'anchorStart'])
      text(task.templateKey)
      if (typeof task.enabled !== 'boolean' || typeof task.durationDays !== 'number' || !Number.isInteger(task.durationDays) || task.durationDays < 1 || task.durationDays > 365)
        invalid()
      if (task.anchorStart !== null)
        date(task.anchorStart)
      if (task.predecessorKey !== undefined && task.predecessorKey !== null)
        text(task.predecessorKey)
      if (task.predecessorDisabled !== undefined && typeof task.predecessorDisabled !== 'boolean')
        invalid()
    }
  }
  if (action.kind === 'add-task') {
    const draft = record(action.draft, ['templateKey', 'plannedStart'])
    text(draft.templateKey)
    date(draft.plannedStart)
  }
  if (action.kind === 'save-task-plan') {
    const draft = record(action.draft, ['task', 'floorPlans', 'dependency', 'disableDependencyIds'])
    patch(draft.task)
    floors(draft.floorPlans)
    if (draft.disableDependencyIds !== undefined)
      ids(draft.disableDependencyIds)
    if (draft.dependency !== null) {
      const dependency = record(draft.dependency, ['predecessorId', 'lagDays'])
      text(dependency.predecessorId)
      if (typeof dependency.lagDays !== 'number' || !Number.isInteger(dependency.lagDays))
        invalid()
    }
  }
}
export function parseScheduleCommand(value: unknown): ScheduleCommand {
  if (!scheduleObject(value) || Object.keys(value).some(key => !['commandId', 'workspaceId', 'actorId', 'origin', 'requiredCapability', 'projectId', 'sourceVersion', 'action'].includes(key))
    || !['commandId', 'workspaceId', 'actorId', 'projectId', 'sourceVersion'].every(key => typeof value[key] === 'string' && String(value[key]).trim())
    || value.origin !== 'real' || value.requiredCapability !== 'schedule:write' || !scheduleObject(value.action)) {
    invalid()
  }
  const action = value.action
  if (typeof action.kind !== 'string' || !actions[action.kind] || Object.keys(action).some(key => key !== 'kind' && !actions[String(action.kind)]!.includes(key))
    || actions[action.kind]!.some(key => !(key in action))) {
    invalid()
  }
  const inspect = (entry: unknown): boolean => entry === null || ['string', 'boolean'].includes(typeof entry) || (typeof entry === 'number' && Number.isFinite(entry))
    || (Array.isArray(entry) && entry.every(inspect)) || (scheduleObject(entry) && Object.values(entry).every(inspect))
  if (!inspect(action))
    invalid()
  validateAction(action)
  return structuredClone(value) as unknown as ScheduleCommand
}
