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

function parseCalendarDate(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match)
    throw new Error(`无效日期：${value}`)
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
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
