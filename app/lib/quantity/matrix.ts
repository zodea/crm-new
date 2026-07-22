import type {
  QuantityAssignment,
  QuantityCompletion,
  QuantityProjectSnapshot,
} from './read-model'

export const ALL_QUANTITY_FILTER = 'all'

export type QuantityMatrixViewMode = 'trade' | 'crew'
export type QuantityNavigationKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'

export interface QuantityOption {
  key: string
  label: string
}

export interface QuantityMatrixFilters {
  buildingId: string
  buildingIds?: readonly string[]
  month: string
  viewMode: QuantityMatrixViewMode
  trade: string
  assigneeKey: string
  stageId?: string
}

export interface QuantityMatrixColumn {
  key: string
  label: string
  sortOrder: number
}

export type QuantityMatrixCellState = 'unassigned' | 'assigned' | 'draft' | 'completed'

export interface QuantityMatrixCell {
  id: string
  unitId: string
  unitName: string
  unitCode: string
  floorId: string
  floorName: string
  columnKey: string
  assignments: QuantityAssignment[]
  timeline: QuantityCompletion[]
  summary: QuantityCompletion | null
  draftCount: number
  hasResponsibility: boolean
  state: QuantityMatrixCellState
  completionMonth: string | null
  ariaLabel: string
}

export interface QuantityMatrixRow {
  id: string
  label: string
  cells: Array<QuantityMatrixCell | null>
}

export interface QuantityMatrixPosition {
  id: string
  row: number
  column: number
}

export interface QuantityMatrixView {
  columns: QuantityMatrixColumn[]
  rows: QuantityMatrixRow[]
  positions: QuantityMatrixPosition[]
  totalUnits: number
  activeUnits: number
}

function compareCompletion(left: QuantityCompletion, right: QuantityCompletion): number {
  const byDate = (right.completedAt ?? '').localeCompare(left.completedAt ?? '')
  if (byDate)
    return byDate
  const byStatus = Number(right.status === 'completed') - Number(left.status === 'completed')
  if (byStatus)
    return byStatus
  return right.stageSortOrder - left.stageSortOrder || right.id.localeCompare(left.id)
}

function monthOf(completion: QuantityCompletion): string | null {
  if (completion.status !== 'completed')
    return null
  return completion.completedAt?.slice(0, 7) ?? null
}

function matchingAssignments(assignments: readonly QuantityAssignment[], filters: QuantityMatrixFilters): QuantityAssignment[] {
  if (filters.viewMode === 'trade') {
    if (filters.trade === ALL_QUANTITY_FILTER)
      return [...assignments]
    return assignments.filter(assignment => assignment.trade === filters.trade)
  }
  if (filters.assigneeKey === ALL_QUANTITY_FILTER)
    return [...assignments]
  return assignments.filter(assignment => `${assignment.assigneeKind}:${assignment.assigneeId}` === filters.assigneeKey)
}

function matchingCompletions(completions: readonly QuantityCompletion[], filters: QuantityMatrixFilters): QuantityCompletion[] {
  const scoped = filters.stageId
    ? completions.filter(completion => completion.stageId === filters.stageId)
    : [...completions]
  if (filters.viewMode === 'trade') {
    if (filters.trade === ALL_QUANTITY_FILTER)
      return scoped
    return scoped.filter(completion => completion.stageTrade === filters.trade)
  }
  if (filters.assigneeKey === ALL_QUANTITY_FILTER)
    return scoped
  return scoped.filter(completion => (
    completion.assigneeKind != null
    && `${completion.assigneeKind}:${completion.assigneeId}` === filters.assigneeKey
  ))
}

function cellState(
  assignments: QuantityAssignment[],
  summary: QuantityCompletion | null,
): QuantityMatrixCellState {
  if (summary?.status === 'completed')
    return 'completed'
  if (summary?.status === 'draft')
    return 'draft'
  return assignments.length ? 'assigned' : 'unassigned'
}

function cellAriaLabel(
  floorName: string,
  unitName: string,
  assignments: QuantityAssignment[],
  summary: QuantityCompletion | null,
  draftCount: number,
): string {
  const responsibility = assignments.length
    ? `当前责任：${assignments.map(item => `${item.trade} ${item.assigneeName}`).join('、')}`
    : '当前未指派'
  const stage = summary
    ? `${summary.stageName}，${summary.status === 'completed' ? `完成于 ${summary.completedAt?.slice(0, 10)}` : '草稿'}，执行责任 ${summary.assigneeName}`
    : '筛选范围内暂无阶段完成'
  const anomaly = draftCount
    ? `；${summary?.status === 'draft' ? '共' : '另有'} ${draftCount} 条草稿异常`
    : ''
  return `${floorName}，${unitName}；${responsibility}；${stage}${anomaly}`
}

export function quantityMonthOptions(snapshot: QuantityProjectSnapshot): QuantityOption[] {
  const months = [...new Set(snapshot.completions.map(monthOf).filter((month): month is string => Boolean(month)))]
    .sort((left, right) => right.localeCompare(left))
  return [
    { key: ALL_QUANTITY_FILTER, label: '全部月份' },
    ...months.map(month => ({ key: month, label: `${month.replace('-', '年')}月` })),
  ]
}

export function quantityTradeOptions(snapshot: QuantityProjectSnapshot): QuantityOption[] {
  const ordered: string[] = []
  for (const stage of [...snapshot.stages].sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))) {
    if (!ordered.includes(stage.trade))
      ordered.push(stage.trade)
  }
  for (const assignment of snapshot.assignments) {
    if (!ordered.includes(assignment.trade))
      ordered.push(assignment.trade)
  }
  return [
    { key: ALL_QUANTITY_FILTER, label: '全部工种' },
    ...ordered.map(trade => ({ key: trade, label: trade })),
  ]
}

export function quantityAssigneeOptions(snapshot: QuantityProjectSnapshot): QuantityOption[] {
  const names = new Map<string, { kind: QuantityAssignment['assigneeKind'], name: string }>()
  for (const assignment of snapshot.assignments) {
    names.set(
      `${assignment.assigneeKind}:${assignment.assigneeId}`,
      { kind: assignment.assigneeKind, name: assignment.assigneeName },
    )
  }
  for (const completion of snapshot.completions) {
    if (completion.assigneeKind == null || completion.assigneeId == null)
      continue
    const key = `${completion.assigneeKind}:${completion.assigneeId}`
    if (!names.has(key)) {
      names.set(key, {
        kind: completion.assigneeKind,
        name: completion.assigneeName,
      })
    }
  }
  return [
    { key: ALL_QUANTITY_FILTER, label: '全部班组 / 个人' },
    ...[...names]
      .sort((left, right) => (
        Number(left[1].kind === 'worker') - Number(right[1].kind === 'worker')
        || left[1].name.localeCompare(right[1].name, 'zh-CN')
        || left[0].localeCompare(right[0])
      ))
      .map(([key, assignee]) => ({
        key,
        label: `${assignee.name}${assignee.kind === 'crew' ? '（班组）' : '（个人）'}`,
      })),
  ]
}

export function buildQuantityMatrix(
  snapshot: QuantityProjectSnapshot,
  filters: QuantityMatrixFilters,
): QuantityMatrixView {
  const scopedBuildingIds = new Set(filters.buildingIds?.length ? filters.buildingIds : [filters.buildingId])
  const floors = snapshot.floors
    .filter(floor => scopedBuildingIds.has(floor.buildingId))
    .sort((left, right) => left.sortOrder - right.sortOrder || right.code.localeCompare(left.code) || left.id.localeCompare(right.id))
  const floorIds = new Set(floors.map(floor => floor.id))
  const units = snapshot.units
    .filter(unit => floorIds.has(unit.floorId))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.code.localeCompare(right.code) || left.id.localeCompare(right.id))
  const columnsByCode = new Map<string, QuantityMatrixColumn>()
  for (const unit of units) {
    const current = columnsByCode.get(unit.code)
    if (!current || unit.sortOrder < current.sortOrder) {
      columnsByCode.set(unit.code, {
        key: unit.code,
        label: `${unit.code}户`,
        sortOrder: unit.sortOrder,
      })
    }
  }
  const columns = [...columnsByCode.values()]
    .sort((left, right) => left.sortOrder - right.sortOrder || left.key.localeCompare(right.key))

  const assignmentsByUnit = new Map<string, QuantityAssignment[]>()
  for (const assignment of snapshot.assignments) {
    const list = assignmentsByUnit.get(assignment.unitId) ?? []
    list.push(assignment)
    assignmentsByUnit.set(assignment.unitId, list)
  }
  const completionsByUnit = new Map<string, QuantityCompletion[]>()
  for (const completion of snapshot.completions) {
    const list = completionsByUnit.get(completion.unitId) ?? []
    list.push(completion)
    completionsByUnit.set(completion.unitId, list)
  }

  const positions: QuantityMatrixPosition[] = []
  let activeUnits = 0
  const rows = floors.map<QuantityMatrixRow>((floor, rowIndex) => {
    const floorUnits = units.filter(unit => unit.floorId === floor.id)
    const cells = columns.map<QuantityMatrixCell | null>((column, columnIndex) => {
      const unit = floorUnits.find(candidate => candidate.code === column.key)
      if (!unit)
        return null
      const assignments = matchingAssignments(assignmentsByUnit.get(unit.id) ?? [], filters)
      const timeline = matchingCompletions(completionsByUnit.get(unit.id) ?? [], filters).sort(compareCompletion)
      const completed = timeline.filter(completion => completion.status === 'completed')
      const monthCompletions = filters.month === ALL_QUANTITY_FILTER
        ? completed
        : completed.filter(completion => monthOf(completion) === filters.month)
      const summary = monthCompletions[0]
        ?? (filters.month === ALL_QUANTITY_FILTER
          ? timeline.find(completion => completion.status === 'draft')
          : null)
        ?? null
      const draftCount = timeline.filter(completion => completion.status === 'draft').length
      const hasResponsibility = assignments.length > 0
      if (hasResponsibility || summary || draftCount)
        activeUnits += 1
      positions.push({ id: unit.id, row: rowIndex, column: columnIndex })
      return {
        id: unit.id,
        unitId: unit.id,
        unitName: unit.name,
        unitCode: unit.code,
        floorId: floor.id,
        floorName: floor.name,
        columnKey: column.key,
        assignments,
        timeline,
        summary,
        draftCount,
        hasResponsibility,
        state: cellState(assignments, summary),
        completionMonth: summary ? monthOf(summary) : null,
        ariaLabel: cellAriaLabel(floor.name, unit.name, assignments, summary, draftCount),
      }
    })
    const buildingName = snapshot.buildings.find(building => building.id === floor.buildingId)?.name ?? ''
    return {
      id: floor.id,
      label: scopedBuildingIds.size > 1 ? `${buildingName} · ${floor.name}` : floor.name,
      cells,
    }
  })

  return {
    columns,
    rows,
    positions,
    totalUnits: units.length,
    activeUnits,
  }
}

export function moveQuantityFocus(
  positions: readonly QuantityMatrixPosition[],
  currentId: string,
  key: QuantityNavigationKey,
): string {
  const current = positions.find(position => position.id === currentId)
  if (!current)
    return positions[0]?.id ?? ''

  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const direction = key === 'ArrowLeft' ? -1 : 1
    const target = positions
      .filter(position => position.row === current.row && (position.column - current.column) * direction > 0)
      .sort((left, right) => Math.abs(left.column - current.column) - Math.abs(right.column - current.column))[0]
    return target?.id ?? current.id
  }

  const direction = key === 'ArrowUp' ? -1 : 1
  const candidateRows = [...new Set(
    positions
      .filter(position => (position.row - current.row) * direction > 0)
      .map(position => position.row),
  )].sort((left, right) => Math.abs(left - current.row) - Math.abs(right - current.row))
  for (const row of candidateRows) {
    const target = positions
      .filter(position => position.row === row)
      .sort((left, right) => (
        Math.abs(left.column - current.column) - Math.abs(right.column - current.column)
        || left.column - right.column
      ))[0]
    if (target)
      return target.id
  }
  return current.id
}
