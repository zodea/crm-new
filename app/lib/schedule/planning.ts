export type ScheduleDependencyType = 'FS' | 'SS' | 'FF' | 'SF'
export type ScheduleOverlapMode = 'half' | 'seq' | 'same'

export interface ScheduleTemplatePlanInput {
  key: string
  durationDays: number
  enabled: boolean
  anchorStart: string | null
}

export interface ScheduleTemplatePlanRow {
  key: string
  durationDays: number
  plannedStart: string
  plannedFinish: string
}

export interface ScheduleDependencyTask {
  id: string
  name: string
  plannedStart: string
  plannedFinish: string
}

export interface ScheduleDependencyInput {
  id: string
  predId: string
  succId: string
  dependencyType: ScheduleDependencyType
  lagDays: number
}

export interface ScheduleDependencyConflict {
  dependencyId: string
  predecessorId: string
  predecessorName: string
  successorId: string
  successorName: string
  requiredDate: string
  actualDate: string
}

export interface ScheduleDependencyPreview {
  earliestStart: string
  conflictDays: number
  hasConflict: boolean
}

export type ScheduleTaskDragMode = 'move' | 'resize-finish'
export const SCHEDULE_DEPENDENCY_CONFLICT_OPERATOR = 'schedule:conflict-reschedule'
export const SCHEDULE_DEPENDENCY_MANUAL_REMOVE_OPERATOR = 'schedule:manual-remove'
export const SCHEDULE_DEPENDENCY_RESTORE_OPERATOR = 'schedule:dependency-restore'

function parseCalendarDate(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match)
    throw new Error(`无效日期：${value}`)
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (new Date(timestamp).toISOString().slice(0, 10) !== value)
    throw new Error(`无效日期：${value}`)
  return timestamp
}

function formatCalendarDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

export function addCalendarDays(value: string, days: number): string {
  return formatCalendarDate(parseCalendarDate(value) + days * 86_400_000)
}

export function calendarDays(from: string, to: string): number {
  return Math.round((parseCalendarDate(to) - parseCalendarDate(from)) / 86_400_000)
}

export function normalizeDependencyLag(lagDays: number): number {
  if (!Number.isFinite(lagDays) || !Number.isInteger(lagDays))
    throw new Error('Lag 天数必须是整数')
  if (lagDays < -365 || lagDays > 365)
    throw new Error('Lag 天数必须在 -365 到 365 之间')
  return lagDays
}

export function dependencyConflictPreview(input: {
  predecessorFinish: string
  successorStart: string
  lagDays: number
}): ScheduleDependencyPreview {
  const earliestStart = addCalendarDays(
    input.predecessorFinish,
    normalizeDependencyLag(input.lagDays),
  )
  const conflictDays = Math.max(0, calendarDays(input.successorStart, earliestStart))
  return {
    earliestStart,
    conflictDays,
    hasConflict: conflictDays > 0,
  }
}

export function dependencyWouldCycle(
  dependencies: readonly ScheduleDependencyInput[],
  input: {
    predecessorId: string
    successorId: string
    excludeDependencyId?: string
  },
): boolean {
  if (input.predecessorId === input.successorId)
    return true
  const outgoing = new Map<string, string[]>()
  for (const dependency of dependencies) {
    if (dependency.id === input.excludeDependencyId)
      continue
    outgoing.set(
      dependency.predId,
      [...(outgoing.get(dependency.predId) ?? []), dependency.succId],
    )
  }
  const pending = [input.successorId]
  const visited = new Set<string>()
  while (pending.length) {
    const taskId = pending.pop()!
    if (taskId === input.predecessorId)
      return true
    if (visited.has(taskId))
      continue
    visited.add(taskId)
    pending.push(...(outgoing.get(taskId) ?? []))
  }
  return false
}

export function rescheduledTaskWindow(input: {
  plannedStart: string
  plannedFinish: string
  deltaDays: number
  mode: ScheduleTaskDragMode
}): { plannedStart: string, plannedFinish: string } {
  const deltaDays = Math.trunc(input.deltaDays)
  if (input.mode === 'move') {
    return {
      plannedStart: addCalendarDays(input.plannedStart, deltaDays),
      plannedFinish: addCalendarDays(input.plannedFinish, deltaDays),
    }
  }
  const proposedFinish = addCalendarDays(input.plannedFinish, deltaDays)
  return {
    plannedStart: input.plannedStart,
    plannedFinish: calendarDays(input.plannedStart, proposedFinish) < 0
      ? input.plannedStart
      : proposedFinish,
  }
}

export function planTemplateTasks(
  startDate: string,
  overlapMode: ScheduleOverlapMode,
  rows: readonly ScheduleTemplatePlanInput[],
): ScheduleTemplatePlanRow[] {
  parseCalendarDate(startDate)
  let cursor = startDate
  const result: ScheduleTemplatePlanRow[] = []
  for (const row of rows) {
    if (!row.enabled)
      continue
    const durationDays = Math.max(1, Math.trunc(row.durationDays))
    const plannedStart = row.anchorStart || cursor
    const plannedFinish = addCalendarDays(plannedStart, durationDays - 1)
    result.push({ key: row.key, durationDays, plannedStart, plannedFinish })
    if (overlapMode === 'seq')
      cursor = addCalendarDays(plannedFinish, 1)
    else if (overlapMode === 'same')
      cursor = startDate
    else
      cursor = addCalendarDays(plannedStart, Math.max(1, Math.round(durationDays / 2)))
  }
  return result
}

export function schedulePlannedProgress(plannedStart: string, plannedFinish: string, today: string): number {
  const total = Math.max(calendarDays(plannedStart, plannedFinish), 1)
  const elapsed = calendarDays(plannedStart, today)
  return Math.max(0, Math.min(1, elapsed / total))
}

export function scheduleDeviationDays(input: {
  plannedStart: string
  plannedFinish: string
  actualProgress: number
  today: string
}): number {
  const duration = Math.max(calendarDays(input.plannedStart, input.plannedFinish), 1)
  const planned = schedulePlannedProgress(input.plannedStart, input.plannedFinish, input.today)
  return Math.round((input.actualProgress - planned) * duration)
}

export function dependencyConflicts(
  tasks: readonly ScheduleDependencyTask[],
  dependencies: readonly ScheduleDependencyInput[],
): ScheduleDependencyConflict[] {
  const taskById = new Map(tasks.map(task => [task.id, task]))
  const conflicts: ScheduleDependencyConflict[] = []
  for (const dependency of dependencies) {
    const predecessor = taskById.get(dependency.predId)
    const successor = taskById.get(dependency.succId)
    if (!predecessor || !successor)
      continue

    const predecessorAnchor = dependency.dependencyType === 'SS' || dependency.dependencyType === 'SF'
      ? predecessor.plannedStart
      : predecessor.plannedFinish
    const successorDate = dependency.dependencyType === 'FF' || dependency.dependencyType === 'SF'
      ? successor.plannedFinish
      : successor.plannedStart
    const requiredDate = addCalendarDays(predecessorAnchor, dependency.lagDays)
    if (calendarDays(requiredDate, successorDate) >= 0)
      continue
    conflicts.push({
      dependencyId: dependency.id,
      predecessorId: predecessor.id,
      predecessorName: predecessor.name,
      successorId: successor.id,
      successorName: successor.name,
      requiredDate,
      actualDate: successorDate,
    })
  }
  return conflicts
}
