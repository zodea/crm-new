import type { ScheduleDependencyInput, ScheduleDependencyType } from './planning'
import type { SoftDb } from '~/lib/db/soft-delete'
import { hiddenCtesFor, selectVisibleSql, visibleCond } from '~/lib/db/soft-delete'
import { loadQuantityStageProgress } from '~/lib/quantity/derived'
import { scheduleDeviationDays, schedulePlannedProgress } from './planning'

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

export interface ScheduleContractOption {
  id: string
  projectId: string
  no: string
  name: string
  lineCount: number
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
  applicableUnits: number | null
  completedUnits: number | null
  actualProgress: number
  actualStart: string | null
  actualFinish: string | null
  plannedProgress: number
  deviationDays: number
}

export interface ScheduleGroupView {
  id: string
  projectId: string
  contractId: string
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
  plannedStart: string | null
  plannedFinish: string | null
  actualProgress: number
  plannedProgress: number
  deviationDays: number
}

interface ProjectRow { id: string, name: string, code: string | null, status: string | null }
interface BuildingRow { id: string, project_id: string, code: string, name: string }
interface GroupRow { id: string, project_id: string, contract_id: string | null, name: string, sort_order: number }
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
}
interface TaskItemRow { task_id: string, item_id: string, boq_line_id: string | null, item_name: string }
interface DependencyRow {
  id: string
  pred_id: string
  succ_id: string
  dependency_type: ScheduleDependencyType
  lag_days: number
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

export async function loadScheduleCatalog(db: SoftDb): Promise<ScheduleCatalogProject[]> {
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

export async function loadScheduleBuildings(db: SoftDb, projectId: string): Promise<ScheduleBuildingOption[]> {
  const rows = await db.select<BuildingRow>(
    selectVisibleSql('buildings', 'AND project_id = ? ORDER BY sort_order, code, id'),
    [projectId],
  )
  return rows.map(row => ({
    id: row.id,
    projectId: row.project_id,
    code: row.code,
    name: row.name,
  }))
}

export async function loadScheduleContracts(db: SoftDb, projectId: string): Promise<ScheduleContractOption[]> {
  const rows = await db.select<{
    id: string
    project_id: string
    no: string
    name: string
    line_count: number
  }>(`
    SELECT contract.id,
           contract.project_id,
           contract.no,
           contract.name,
           COUNT(boq_line.id) AS line_count
    FROM contracts contract
    LEFT JOIN boq_lines boq_line
      ON boq_line.contract_id = contract.id
     AND boq_line.deleted_at IS NULL
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
  db: SoftDb,
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
  const dependencyRows = taskIds.length
    ? await db.select<DependencyRow>(
        selectVisibleSql('task_dependencies', `AND pred_id IN (${taskPlaceholders}) AND succ_id IN (${taskPlaceholders})
          ORDER BY created_at, id`),
        [...taskIds, ...taskIds],
      )
    : []

  const buildingsByGroup = new Map<string, GroupBuildingRow[]>()
  for (const row of buildingRows)
    buildingsByGroup.set(row.group_id, [...(buildingsByGroup.get(row.group_id) ?? []), row])
  const itemsByTask = new Map<string, TaskItemRow[]>()
  for (const row of itemRows)
    itemsByTask.set(row.task_id, [...(itemsByTask.get(row.task_id) ?? []), row])

  const taskViews = new Map<string, ScheduleTaskView[]>()
  for (const task of tasks) {
    const buildingIds = (buildingsByGroup.get(task.group_id) ?? []).map(row => row.building_id)
    const mappedItems = itemsByTask.get(task.id) ?? []
    let actualProgress = Number(task.manual_progress) || 0
    let applicableUnits: number | null = null
    let completedUnits: number | null = null
    let actualStart: string | null = null
    let actualFinish: string | null = null
    if (task.has_qty && task.stage_id) {
      const [progress] = await loadQuantityStageProgress(db, projectId, {
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
      boqLineIds: mappedItems.flatMap(item => item.boq_line_id ? [item.boq_line_id] : []),
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
  return {
    id: project.id,
    name: project.name,
    code: project.code ?? '',
    groups: groupViews,
    dependencies,
    plannedStart: minDate(allTasks.map(task => task.plannedStart)),
    plannedFinish: maxDate(allTasks.map(task => task.plannedFinish)),
    ...rollup(allTasks),
  }
}
