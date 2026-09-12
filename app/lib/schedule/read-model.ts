import type { QuantityMeasureTotal } from '../quantity/totals'
import type { ScheduleDependencyInput, ScheduleDependencyType } from './planning'
import type { SoftDb } from '~/lib/db/soft-delete'
import { hiddenCtesFor, selectVisibleSql, visibleCond } from '~/lib/db/soft-delete'
import { loadQuantityStageProgress } from '~/lib/quantity/derived'
import {
  SCHEDULE_DEPENDENCY_CONFLICT_OPERATOR,
  scheduleDeviationDays,
  schedulePlannedProgress,
} from './planning'

export interface ScheduleCatalogProject {
  id: string
  name: string
  code: string
  status: string
  groupCount: number
}

export interface ScheduleBuildingOption {
  id: string
  projectId: string
  code: string
  name: string
}

export interface ScheduleBuildingCoverage extends ScheduleBuildingOption {
  inContract: boolean
  scheduled: boolean
}

export interface ScheduleContractOption {
  id: string
  projectId: string
  no: string
  name: string
  lineCount: number
}

export interface ScheduleFloorPlanView {
  quantitySnapshot?: (QuantityMeasureTotal & { unit: string, sources: { unitId: string, templateItemId: string, quantity: number | null, unit: string }[] }) | null
  legacyQuantityDetailMissing?: boolean
  id: string
  taskId: string
  floorId: string
  floorName: string
  buildingName: string
  itemId: string
  boqLineId: string | null
  sourceBasis: ScheduleScopeBasis
  provisionalQty: number | null
  itemName: string
  plannedStart: string
  plannedFinish: string
  isManual: boolean
  note: string
  sortOrder: number
}

export interface ScheduleTaskView {
  id: string
  projectId: string
  groupId: string
  parentId: string | null
  name: string
  trade: string
  color: string
  durationDays: number
  plannedStart: string
  plannedFinish: string
  baselineStart: string | null
  baselineFinish: string | null
  hasQty: boolean
  manualProgress: number | null
  stageId: string | null
  sortOrder: number
  itemIds: readonly string[]
  itemNames: readonly string[]
  boqLineIds: readonly string[]
  floorPlans: readonly ScheduleFloorPlanView[]
  applicableUnits: number | null
  completedUnits: number | null
  actualProgress: number
  actualStart: string | null
  actualFinish: string | null
  plannedProgress: number
  deviationDays: number
  sourceLibraryTaskId: string | null
  sourceLibraryVersion: number | null
}

export type ScheduleScopeBasis = 'contract' | 'provisional'

export interface ScheduleGroupView {
  id: string
  projectId: string
  contractId: string
  scopeBasis: ScheduleScopeBasis
  processLibraryId: string
  processLibraryName: string
  processLibraryVersion: number | null
  name: string
  sortOrder: number
  buildingIds: readonly string[]
  buildingNames: readonly string[]
  tasks: readonly ScheduleTaskView[]
  plannedStart: string | null
  plannedFinish: string | null
  actualProgress: number
  plannedProgress: number
  deviationDays: number
}

export interface ScheduleProjectView {
  id: string
  name: string
  code: string
  groups: readonly ScheduleGroupView[]
  dependencies: readonly ScheduleDependencyInput[]
  disabledDependencies: readonly ScheduleDisabledDependencyView[]
  plannedStart: string | null
  plannedFinish: string | null
  actualProgress: number
  plannedProgress: number
  deviationDays: number
}

interface ProjectRow { id: string, name: string, code: string | null, status: string | null }
interface BuildingRow { id: string, project_id: string, code: string, name: string }
interface GroupRow {
  id: string
  project_id: string
  contract_id: string | null
  scope_basis: ScheduleScopeBasis | null
  process_library_id: string | null
  process_library_name_snapshot: string
  process_library_version_snapshot: number | null
  name: string
  sort_order: number
}

export interface ScheduleDisabledDependencyView extends ScheduleDependencyInput {
  disabledAt: string
  disabledReason: 'schedule-conflict'
  auditLogId: string
}
interface GroupBuildingRow { group_id: string, building_id: string, building_name: string }
interface TaskRow {
  id: string
  project_id: string
  group_id: string
  parent_id: string | null
  name: string
  trade: string
  color: string
  duration_days: number
  planned_start: string
  planned_finish: string
  baseline_start: string | null
  baseline_finish: string | null
  has_qty: number
  manual_progress: number | null
  stage_id: string | null
  sort_order: number
  source_library_task_id: string | null
  source_library_version: number | null
}
interface TaskItemRow { task_id: string, item_id: string, boq_line_id: string | null, item_name: string }
interface FloorPlanRow {
  id: string
  task_id: string
  floor_id: string
  floor_name: string
  building_name: string
  item_id: string
  boq_line_id: string | null
  source_basis: ScheduleScopeBasis
  provisional_qty: number | null
  item_name: string
  planned_start: string
  planned_finish: string
  is_manual: number
  note: string
  sort_order: number
}
interface DependencyRow {
  id: string
  pred_id: string
  succ_id: string
  dependency_type: ScheduleDependencyType
  lag_days: number
  deleted_at?: string
  delete_log_id?: string
}

function rollup(tasks: readonly ScheduleTaskView[]) {
  const totalWeight = tasks.reduce((sum, task) => sum + Math.max(task.durationDays, 1), 0)
  if (!totalWeight) {
    return { actualProgress: 0, plannedProgress: 0, deviationDays: 0 }
  }
  const actualProgress = tasks.reduce((sum, task) => sum + task.actualProgress * task.durationDays, 0) / totalWeight
  const plannedProgress = tasks.reduce((sum, task) => sum + task.plannedProgress * task.durationDays, 0) / totalWeight
  return {
    actualProgress,
    plannedProgress,
    deviationDays: Math.round((actualProgress - plannedProgress) * totalWeight / tasks.length),
  }
}

function minDate(values: readonly string[]): string | null {
  return values.length ? [...values].sort()[0]! : null
}

function maxDate(values: readonly string[]): string | null {
  return values.length ? [...values].sort().at(-1)! : null
}

export async function loadScheduleCatalog(db: Pick<SoftDb, 'select'>): Promise<ScheduleCatalogProject[]> {
  const rows = await db.select<ProjectRow>(selectVisibleSql('projects', 'ORDER BY created_at DESC, id'))
  const counts = await db.select<{ project_id: string, n: number }>(
    `${hiddenCtesFor('schedule_groups')}
     SELECT project_id, COUNT(*) AS n
     FROM schedule_groups
     WHERE ${visibleCond('schedule_groups')}
     GROUP BY project_id`,
  )
  const countByProject = new Map(counts.map(row => [row.project_id, Number(row.n) || 0]))
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    code: row.code ?? '',
    status: row.status ?? '',
    groupCount: countByProject.get(row.id) ?? 0,
  }))
}

export async function loadScheduleBuildings(
  db: Pick<SoftDb, 'select'>,
  projectId: string,
  contractId = '',
): Promise<ScheduleBuildingOption[]> {
  if (!contractId) {
    const rows = await db.select<BuildingRow>(
      `${hiddenCtesFor('buildings', 'schedule_group_buildings')}
       SELECT building_row.*
       FROM buildings building_row
       WHERE ${visibleCond('buildings', 'building_row')}
         AND building_row.project_id = ?
         AND NOT EXISTS (
           SELECT 1
           FROM schedule_group_buildings group_building
           WHERE group_building.building_id = building_row.id
             AND ${visibleCond('schedule_group_buildings', 'group_building')}
         )
       ORDER BY building_row.sort_order, building_row.code, building_row.id`,
      [projectId],
    )
    return rows.map(row => ({
      id: row.id,
      projectId: row.project_id,
      code: row.code,
      name: row.name,
    }))
  }
  return (await loadScheduleBuildingCoverage(db, projectId, contractId))
    .filter(building => building.inContract && !building.scheduled)
    .map(({ id, projectId: rowProjectId, code, name }) => ({
      id,
      projectId: rowProjectId,
      code,
      name,
    }))
}

export async function loadScheduleBuildingCoverage(
  db: Pick<SoftDb, 'select'>,
  projectId: string,
  contractId: string,
): Promise<ScheduleBuildingCoverage[]> {
  const allRows = await db.select<BuildingRow>(
    selectVisibleSql('buildings', 'AND project_id = ? ORDER BY sort_order, code, id'),
    [projectId],
  )
  if (!contractId) {
    return allRows.map(row => ({
      id: row.id,
      projectId: row.project_id,
      code: row.code,
      name: row.name,
      inContract: false,
      scheduled: false,
    }))
  }
  const contractRows = await db.select<{ id: string }>(
    `${hiddenCtesFor('buildings', 'boq_lines')}
     SELECT building.id
     FROM buildings building
     WHERE ${visibleCond('buildings', 'building')}
       AND building.project_id = ?
       AND EXISTS (
         SELECT 1
         FROM boq_lines boq_line
         WHERE ${visibleCond('boq_lines', 'boq_line')}
            AND boq_line.project_id = ?
            AND boq_line.contract_id = ?
            AND trim(boq_line.building) <> ''
            AND (
              boq_line.building = building.code
              OR boq_line.building = building.name
            )
            AND (SELECT COUNT(*) FROM buildings matched_building
              WHERE matched_building.project_id = building.project_id
                AND ${visibleCond('buildings', 'matched_building')}
                AND (boq_line.building = matched_building.code OR boq_line.building = matched_building.name)) = 1
        )
     ORDER BY building.sort_order, building.code, building.id`,
    [projectId, projectId, contractId],
  )
  const scheduledRows = await db.select<{ building_id: string }>(
    `${hiddenCtesFor('schedule_group_buildings')}
     SELECT DISTINCT group_building.building_id
     FROM schedule_group_buildings group_building
     JOIN schedule_groups group_row ON group_row.id = group_building.group_id
     WHERE ${visibleCond('schedule_group_buildings', 'group_building')}
       AND group_row.project_id = ?
       AND group_row.contract_id = ?`,
    [projectId, contractId],
  )
  const contractIds = new Set(contractRows.map(row => row.id))
  const scheduledIds = new Set(scheduledRows.map(row => row.building_id))
  return allRows.map(row => ({
    id: row.id,
    projectId: row.project_id,
    code: row.code,
    name: row.name,
    inContract: contractIds.has(row.id),
    scheduled: scheduledIds.has(row.id),
  }))
}

export async function loadScheduleContracts(db: Pick<SoftDb, 'select'>, projectId: string): Promise<ScheduleContractOption[]> {
  const rows = await db.select<{
    id: string
    project_id: string
    no: string
    name: string
    line_count: number
  }>(`${hiddenCtesFor('boq_lines')}
    SELECT contract.id,
           contract.project_id,
           contract.no,
           contract.name,
           COUNT(boq_line.id) AS line_count
    FROM contracts contract
    LEFT JOIN boq_lines boq_line
      ON boq_line.contract_id = contract.id
     AND ${visibleCond('boq_lines', 'boq_line')}
    WHERE contract.deleted_at IS NULL
      AND contract.project_id = ?
      AND contract.kind = '施工'
    GROUP BY contract.id
    ORDER BY contract.no, contract.name, contract.id
  `, [projectId])
  return rows.map(row => ({
    id: row.id,
    projectId: row.project_id,
    no: row.no,
    name: row.name,
    lineCount: Number(row.line_count) || 0,
  }))
}

export async function loadScheduleProject(
  db: Pick<SoftDb, 'select'>,
  projectId: string,
  today: string,
): Promise<ScheduleProjectView | null> {
  const [project] = await db.select<ProjectRow>(
    selectVisibleSql('projects', 'AND id = ?'),
    [projectId],
  )
  if (!project)
    return null

  const groups = await db.select<GroupRow>(
    selectVisibleSql('schedule_groups', 'AND project_id = ? ORDER BY sort_order, created_at, id'),
    [projectId],
  )
  const groupIds = groups.map(group => group.id)
  if (!groupIds.length) {
    return {
      id: project.id,
      name: project.name,
      code: project.code ?? '',
      groups: [],
      dependencies: [],
      disabledDependencies: [],
      plannedStart: null,
      plannedFinish: null,
      actualProgress: 0,
      plannedProgress: 0,
      deviationDays: 0,
    }
  }
  const placeholders = groupIds.map(() => '?').join(', ')
  const buildingRows = await db.select<GroupBuildingRow>(
    `${hiddenCtesFor('schedule_group_buildings')}
     SELECT sgb.group_id, sgb.building_id, b.name AS building_name
     FROM schedule_group_buildings sgb
     JOIN buildings b ON b.id = sgb.building_id
     WHERE ${visibleCond('schedule_group_buildings', 'sgb')}
       AND sgb.group_id IN (${placeholders})
     ORDER BY sgb.sort_order, b.sort_order, b.code, b.id`,
    groupIds,
  )
  const tasks = await db.select<TaskRow>(
    selectVisibleSql('schedule_tasks', `AND project_id = ? AND group_id IN (${placeholders})
      ORDER BY group_id, sort_order, created_at, id`),
    [projectId, ...groupIds],
  )
  const taskIds = tasks.map(task => task.id)
  const taskPlaceholders = taskIds.map(() => '?').join(', ')
  const itemRows = taskIds.length
    ? await db.select<TaskItemRow>(
        `${hiddenCtesFor('task_item_map')}
         SELECT tim.task_id, tim.item_id, tim.boq_line_id, i.name AS item_name
         FROM task_item_map tim
         JOIN items i ON i.id = tim.item_id
         WHERE ${visibleCond('task_item_map', 'tim')}
           AND tim.task_id IN (${taskPlaceholders})
         ORDER BY i.sort_order, i.code, i.id`,
        taskIds,
      )
    : []
  const floorPlanRows = taskIds.length
    ? await db.select<FloorPlanRow>(
        `${hiddenCtesFor('schedule_task_floor_plans')}
         SELECT plan.id,
                plan.task_id,
                plan.floor_id,
                floor_row.name AS floor_name,
                building.name AS building_name,
                plan.item_id,
                plan.boq_line_id,
                plan.source_basis,
                plan.provisional_qty,
                COALESCE(boq_line.item_name, item.name) AS item_name,
                plan.planned_start,
                plan.planned_finish,
                plan.is_manual,
                plan.note,
                plan.sort_order
         FROM schedule_task_floor_plans plan
         JOIN floors floor_row ON floor_row.id = plan.floor_id
         JOIN buildings building ON building.id = floor_row.building_id
         JOIN items item ON item.id = plan.item_id
         LEFT JOIN boq_lines boq_line ON boq_line.id = plan.boq_line_id
         WHERE ${visibleCond('schedule_task_floor_plans', 'plan')}
           AND plan.task_id IN (${taskPlaceholders})
         ORDER BY plan.task_id,
                  plan.sort_order,
                  building.sort_order,
                  floor_row.sort_order,
                  plan.item_id,
                  plan.id`,
        taskIds,
      )
    : []
  const dependencyRows = taskIds.length
    ? await db.select<DependencyRow>(
        selectVisibleSql('task_dependencies', `AND pred_id IN (${taskPlaceholders}) AND succ_id IN (${taskPlaceholders})
          ORDER BY created_at, id`),
        [...taskIds, ...taskIds],
      )
    : []
  const disabledDependencyRows = taskIds.length
    ? await db.select<DependencyRow>(
        `SELECT dependency.id,
                dependency.pred_id,
                dependency.succ_id,
                dependency.dependency_type,
                dependency.lag_days,
                dependency.deleted_at,
                delete_log.id AS delete_log_id
         FROM task_dependencies dependency
         JOIN operation_logs delete_log
           ON delete_log.rowid = (
             SELECT MAX(candidate_log.rowid)
             FROM operation_logs candidate_log
             WHERE candidate_log.table_name = 'task_dependencies'
               AND candidate_log.record_id = dependency.id
               AND candidate_log.action = 'delete'
           )
         WHERE dependency.deleted_at IS NOT NULL
           AND delete_log.operator = ?
           AND dependency.pred_id IN (${taskPlaceholders})
           AND dependency.succ_id IN (${taskPlaceholders})
         ORDER BY dependency.deleted_at DESC, dependency.id`,
        [SCHEDULE_DEPENDENCY_CONFLICT_OPERATOR, ...taskIds, ...taskIds],
      )
    : []

  const buildingsByGroup = new Map<string, GroupBuildingRow[]>()
  for (const row of buildingRows)
    buildingsByGroup.set(row.group_id, [...(buildingsByGroup.get(row.group_id) ?? []), row])
  const itemsByTask = new Map<string, TaskItemRow[]>()
  for (const row of itemRows)
    itemsByTask.set(row.task_id, [...(itemsByTask.get(row.task_id) ?? []), row])
  const floorPlansByTask = new Map<string, ScheduleFloorPlanView[]>()
  for (const row of floorPlanRows) {
    const plan: ScheduleFloorPlanView = {
      id: row.id,
      taskId: row.task_id,
      floorId: row.floor_id,
      floorName: row.floor_name,
      buildingName: row.building_name,
      itemId: row.item_id,
      boqLineId: row.boq_line_id,
      sourceBasis: row.source_basis,
      provisionalQty: row.provisional_qty == null ? null : Number(row.provisional_qty),
      itemName: row.item_name,
      plannedStart: row.planned_start,
      plannedFinish: row.planned_finish,
      isManual: Boolean(row.is_manual),
      note: row.note,
      sortOrder: Number(row.sort_order) || 0,
    }
    floorPlansByTask.set(row.task_id, [...(floorPlansByTask.get(row.task_id) ?? []), plan])
  }

  const taskViews = new Map<string, ScheduleTaskView[]>()
  for (const task of tasks) {
    const buildingIds = (buildingsByGroup.get(task.group_id) ?? []).map(row => row.building_id)
    const mappedItems = itemsByTask.get(task.id) ?? []
    const floorPlans = floorPlansByTask.get(task.id) ?? []
    let actualProgress = Number(task.manual_progress) || 0
    let applicableUnits: number | null = null
    let completedUnits: number | null = null
    let actualStart: string | null = null
    let actualFinish: string | null = null
    if (task.has_qty && task.stage_id) {
      const [progress] = await loadQuantityStageProgress(db, projectId, {
        currentApplicabilityOnly: true,
        stageIds: [task.stage_id],
        buildingIds,
        itemIds: mappedItems.map(item => item.item_id),
      })
      actualProgress = progress?.completionRate ?? 0
      applicableUnits = progress?.applicableUnits ?? 0
      completedUnits = progress?.completedUnits ?? 0
      actualStart = progress?.firstCompletedAt ?? null
      actualFinish = progress && progress.applicableUnits > 0 && progress.completedUnits >= progress.applicableUnits
        ? progress.lastCompletedAt
        : null
    }
    const plannedProgress = schedulePlannedProgress(task.planned_start, task.planned_finish, today)
    const view: ScheduleTaskView = {
      id: task.id,
      projectId: task.project_id,
      groupId: task.group_id,
      parentId: task.parent_id,
      name: task.name,
      trade: task.trade,
      color: task.color,
      durationDays: Number(task.duration_days) || 1,
      plannedStart: task.planned_start,
      plannedFinish: task.planned_finish,
      baselineStart: task.baseline_start,
      baselineFinish: task.baseline_finish,
      hasQty: Boolean(task.has_qty),
      manualProgress: task.manual_progress,
      stageId: task.stage_id,
      sortOrder: Number(task.sort_order) || 0,
      itemIds: mappedItems.map(item => item.item_id),
      itemNames: mappedItems.map(item => item.item_name),
      boqLineIds: [...new Set([
        ...mappedItems.flatMap(item => item.boq_line_id ? [item.boq_line_id] : []),
        ...floorPlans.flatMap(plan => plan.boqLineId ? [plan.boqLineId] : []),
      ])],
      floorPlans,
      applicableUnits,
      completedUnits,
      actualProgress,
      actualStart,
      actualFinish,
      plannedProgress,
      deviationDays: scheduleDeviationDays({
        plannedStart: task.planned_start,
        plannedFinish: task.planned_finish,
        actualProgress,
        today,
      }),
      sourceLibraryTaskId: task.source_library_task_id,
      sourceLibraryVersion: task.source_library_version == null
        ? null
        : Number(task.source_library_version),
    }
    taskViews.set(task.group_id, [...(taskViews.get(task.group_id) ?? []), view])
  }

  const groupViews = groups.map<ScheduleGroupView>((group) => {
    const groupTasks = taskViews.get(group.id) ?? []
    const groupBuildings = buildingsByGroup.get(group.id) ?? []
    return {
      id: group.id,
      projectId: group.project_id,
      contractId: group.contract_id ?? '',
      scopeBasis: group.scope_basis ?? (group.contract_id ? 'contract' : 'provisional'),
      processLibraryId: group.process_library_id ?? '',
      processLibraryName: group.process_library_name_snapshot,
      processLibraryVersion: group.process_library_version_snapshot == null
        ? null
        : Number(group.process_library_version_snapshot),
      name: group.name,
      sortOrder: Number(group.sort_order) || 0,
      buildingIds: groupBuildings.map(row => row.building_id),
      buildingNames: groupBuildings.map(row => row.building_name),
      tasks: groupTasks,
      plannedStart: minDate(groupTasks.map(task => task.plannedStart)),
      plannedFinish: maxDate(groupTasks.map(task => task.plannedFinish)),
      ...rollup(groupTasks),
    }
  })
  const allTasks = groupViews.flatMap(group => group.tasks)
  const dependencies: ScheduleDependencyInput[] = dependencyRows.map(row => ({
    id: row.id,
    predId: row.pred_id,
    succId: row.succ_id,
    dependencyType: row.dependency_type,
    lagDays: Number(row.lag_days) || 0,
  }))
  const disabledDependencies: ScheduleDisabledDependencyView[] = disabledDependencyRows.map(row => ({
    id: row.id,
    predId: row.pred_id,
    succId: row.succ_id,
    dependencyType: row.dependency_type,
    lagDays: Number(row.lag_days) || 0,
    disabledAt: row.deleted_at!,
    disabledReason: 'schedule-conflict',
    auditLogId: row.delete_log_id!,
  }))
  return {
    id: project.id,
    name: project.name,
    code: project.code ?? '',
    groups: groupViews,
    dependencies,
    disabledDependencies,
    plannedStart: minDate(allTasks.map(task => task.plannedStart)),
    plannedFinish: maxDate(allTasks.map(task => task.plannedFinish)),
    ...rollup(allTasks),
  }
}
