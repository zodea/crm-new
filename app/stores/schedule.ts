import type {
  ScheduleDependencyInput,
  ScheduleOverlapMode,
  ScheduleTemplatePlanInput,
} from '~/lib/schedule/planning'
import type {
  ScheduleBuildingCoverage,
  ScheduleBuildingOption,
  ScheduleCatalogProject,
  ScheduleContractOption,
  ScheduleProjectView,
  ScheduleTaskView,
} from '~/lib/schedule/read-model'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { execute, select, withTransaction } from '~/lib/db/connection'
import {
  hiddenCtesFor,
  logCreate,
  selectVisibleSql,
  softDelete,
  undoOperation,
  visibleCond,
  withUpdateLog,
} from '~/lib/db/soft-delete'
import {
  addCalendarDays,
  calendarDays,
  dependencyConflicts,
  planTemplateTasks,
} from '~/lib/schedule/planning'
import {
  loadScheduleBuildingCoverage,
  loadScheduleBuildings,
  loadScheduleCatalog,
  loadScheduleContracts,
  loadScheduleProject,
} from '~/lib/schedule/read-model'
import { SCHEDULE_TEMPLATE_BY_KEY } from '~/lib/schedule/template'
import { toErrorMessage } from '~/lib/util/error'
import { generateId } from '~/lib/util/id'
import { toLocalDateInputValue } from '~/lib/util/local-date'

interface ScheduleDb {
  execute: typeof execute
  select: typeof select
}

const db: ScheduleDb = { execute, select }

export interface CreateScheduleGroupDraft {
  projectId: string
  contractId: string
  name: string
  buildingIds: readonly string[]
  startDate: string
  overlapMode: ScheduleOverlapMode
  tasks: readonly ({ templateKey: string } & Omit<ScheduleTemplatePlanInput, 'key'>)[]
}

export interface UpdateScheduleTaskPatch {
  plannedStart?: string
  plannedFinish?: string
  manualProgress?: number
}

export interface UpdateScheduleFloorPlanPatch {
  id: string
  plannedStart: string
  plannedFinish: string
}

export interface AddScheduleTaskDraft {
  templateKey: string
  plannedStart: string
}

export interface SaveScheduleTaskPlanDraft {
  task: UpdateScheduleTaskPatch
  floorPlans: readonly UpdateScheduleFloorPlanPatch[]
  dependency: { predecessorId: string, lagDays: number } | null
}

interface IdCodeRow { id: string, code: string }
interface BoqLineRow {
  id: string
  item_id: string
  building: string
  unit_type: string
  floor_zone: string
}
interface FloorRow {
  id: string
  building_id: string
  building_code: string
  building_name: string
  code: string
  name: string
  sort_order: number
  unitTypes: readonly string[]
}

function floorPlanWindow(
  plannedStart: string,
  plannedFinish: string,
  index: number,
  count: number,
) {
  const durationDays = calendarDays(plannedStart, plannedFinish) + 1
  const startOffset = Math.floor(index * durationDays / count)
  const finishOffset = Math.max(startOffset, Math.ceil((index + 1) * durationDays / count) - 1)
  return {
    plannedStart: addCalendarDays(plannedStart, startOffset),
    plannedFinish: addCalendarDays(plannedStart, finishOffset),
  }
}

async function loadFloorsByBuildings(
  targetDb: ScheduleDb,
  buildingIds: readonly string[],
): Promise<FloorRow[]> {
  if (!buildingIds.length)
    return []
  const rows = await targetDb.select<Omit<FloorRow, 'unitTypes'>>(
    `${hiddenCtesFor('floors')}
     SELECT floor_row.id,
            floor_row.building_id,
            building.code AS building_code,
            building.name AS building_name,
            floor_row.code,
            floor_row.name,
            floor_row.sort_order
     FROM floors floor_row
     JOIN buildings building ON building.id = floor_row.building_id
     WHERE ${visibleCond('floors', 'floor_row')}
       AND floor_row.building_id IN (${buildingIds.map(() => '?').join(', ')})
     ORDER BY floor_row.building_id, floor_row.sort_order, floor_row.code, floor_row.id`,
    [...buildingIds],
  )
  if (!rows.length)
    return []
  const unitTypeRows = await targetDb.select<{
    floor_id: string
    code: string
    name: string | null
  }>(
    `${hiddenCtesFor('units', 'house_type_templates')}
     SELECT DISTINCT unit_row.floor_id, template.code, template.name
     FROM units unit_row
     JOIN house_type_templates template ON template.id = unit_row.house_type_template_id
     WHERE ${visibleCond('units', 'unit_row')}
       AND ${visibleCond('house_type_templates', 'template')}
       AND unit_row.floor_id IN (${rows.map(() => '?').join(', ')})`,
    rows.map(row => row.id),
  )
  const unitTypesByFloor = new Map<string, string[]>()
  for (const row of unitTypeRows) {
    unitTypesByFloor.set(
      row.floor_id,
      [...(unitTypesByFloor.get(row.floor_id) ?? []), row.code, row.name ?? '']
        .filter(Boolean),
    )
  }
  const buildingOrder = new Map(buildingIds.map((id, index) => [id, index]))
  return rows
    .map(row => ({ ...row, unitTypes: unitTypesByFloor.get(row.id) ?? [] }))
    .sort((left, right) =>
      (buildingOrder.get(left.building_id) ?? 0) - (buildingOrder.get(right.building_id) ?? 0)
      || Number(left.sort_order) - Number(right.sort_order)
      || left.id.localeCompare(right.id),
    )
}

function applicableFloors(line: BoqLineRow, floors: readonly FloorRow[]): FloorRow[] {
  const building = line.building.trim().toLocaleLowerCase('zh-CN')
  const unitType = line.unit_type.trim().toLocaleLowerCase('zh-CN')
  const floorZone = line.floor_zone.trim().toLocaleLowerCase('zh-CN')
  return floors.filter((floor) => {
    if (
      building
      && floor.building_code.toLocaleLowerCase('zh-CN') !== building
      && floor.building_name.toLocaleLowerCase('zh-CN') !== building
    ) {
      return false
    }
    if (
      unitType
      && !floor.unitTypes.some(candidate =>
        candidate.toLocaleLowerCase('zh-CN') === unitType,
      )
    ) {
      return false
    }
    if (
      floorZone
      && floor.code.toLocaleLowerCase('zh-CN') !== floorZone
      && floor.name.toLocaleLowerCase('zh-CN') !== floorZone
    ) {
      return false
    }
    return true
  })
}

async function createFloorPlans(
  targetDb: ScheduleDb,
  taskId: string,
  boqLineId: string,
  floors: readonly FloorRow[],
  plannedStart: string,
  plannedFinish: string,
) {
  for (const [index, floor] of floors.entries()) {
    const planId = generateId('schedule_floor_plan')
    const window = floorPlanWindow(plannedStart, plannedFinish, index, floors.length)
    await targetDb.execute(
      `INSERT INTO schedule_task_floor_plans
        (id, task_id, floor_id, boq_line_id, planned_start, planned_finish, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        planId,
        taskId,
        floor.id,
        boqLineId,
        window.plannedStart,
        window.plannedFinish,
        (index + 1) * 10,
      ],
    )
    await logCreate(targetDb, 'schedule_task_floor_plans', planId)
  }
}

async function loadBoqLinesByItem(
  targetDb: ScheduleDb,
  projectId: string,
  contractId: string,
  itemIds: readonly string[],
): Promise<Map<string, BoqLineRow[]>> {
  const uniqueItemIds = [...new Set(itemIds)]
  if (!contractId || !uniqueItemIds.length)
    return new Map()
  const rows = await targetDb.select<BoqLineRow>(
    selectVisibleSql(
      'boq_lines',
      `AND project_id = ? AND contract_id = ?
       AND item_id IN (${uniqueItemIds.map(() => '?').join(', ')})
       ORDER BY sort_order, id`,
    ),
    [projectId, contractId, ...uniqueItemIds],
  )
  const linesByItem = new Map<string, BoqLineRow[]>()
  for (const row of rows) {
    linesByItem.set(row.item_id, [...(linesByItem.get(row.item_id) ?? []), row])
  }
  return linesByItem
}

export const useScheduleStore = defineStore('schedule', () => {
  const catalog = shallowRef<ScheduleCatalogProject[]>([])
  const buildings = shallowRef<ScheduleBuildingOption[]>([])
  const buildingCoverage = shallowRef<ScheduleBuildingCoverage[]>([])
  const contracts = shallowRef<ScheduleContractOption[]>([])
  const snapshot = shallowRef<ScheduleProjectView | null>(null)
  const loading = shallowRef(false)
  const saving = shallowRef(false)
  const error = shallowRef('')
  let activeProjectId = ''
  let activeToday = toLocalDateInputValue()
  let latestRequest = 0

  async function loadCatalog() {
    catalog.value = await loadScheduleCatalog(db)
  }

  async function loadBuildings(projectId: string, contractId = '') {
    if (!projectId) {
      buildings.value = []
      buildingCoverage.value = []
      return
    }
    if (!contractId) {
      buildings.value = await loadScheduleBuildings(db, projectId)
      buildingCoverage.value = []
      return
    }
    buildingCoverage.value = await loadScheduleBuildingCoverage(db, projectId, contractId)
    buildings.value = buildingCoverage.value
      .filter(building => building.inContract && !building.scheduled)
      .map(({ id, projectId: rowProjectId, code, name }) => ({
        id,
        projectId: rowProjectId,
        code,
        name,
      }))
  }

  async function loadContracts(projectId: string) {
    contracts.value = projectId ? await loadScheduleContracts(db, projectId) : []
  }

  async function loadProject(projectId: string, today = toLocalDateInputValue()) {
    const request = ++latestRequest
    activeProjectId = projectId
    activeToday = today
    loading.value = true
    error.value = ''
    try {
      const result = projectId ? await loadScheduleProject(db, projectId, today) : null
      if (request === latestRequest)
        snapshot.value = result
    }
    catch (cause) {
      if (request === latestRequest) {
        snapshot.value = null
        error.value = `施工进度加载失败：${toErrorMessage(cause)}`
      }
      throw cause
    }
    finally {
      if (request === latestRequest)
        loading.value = false
    }
  }

  async function reload(projectId = activeProjectId, today = activeToday) {
    await Promise.all([loadCatalog(), loadProject(projectId, today)])
  }

  async function createGroup(draft: CreateScheduleGroupDraft, today = toLocalDateInputValue()) {
    const name = draft.name.trim()
    if (!draft.projectId || !draft.contractId || !name)
      throw new Error('项目、施工合同与分组名称必填')
    const buildingIds = [...new Set(draft.buildingIds)]
    if (!buildingIds.length)
      throw new Error('请至少选择一栋楼')
    const plannedRows = planTemplateTasks(
      draft.startDate,
      draft.overlapMode,
      draft.tasks.map(task => ({ ...task, key: task.templateKey })),
    )
    if (!plannedRows.length)
      throw new Error('请至少选择一道工序')

    const templates = plannedRows.map((row) => {
      const template = SCHEDULE_TEMPLATE_BY_KEY.get(row.key)
      if (!template)
        throw new Error(`未知工序模板：${row.key}`)
      return { row, template }
    })
    const groupId = generateId('schedule_group')
    saving.value = true
    error.value = ''
    try {
      await withTransaction(async (tx) => {
        const buildings = (await loadScheduleBuildings(tx, draft.projectId, draft.contractId))
          .filter(building => buildingIds.includes(building.id))
        if (buildings.length !== buildingIds.length)
          throw new Error('楼栋范围包含无效、已删除或不属于该合同清单的记录')

        const [contract] = await tx.select<{ id: string }>(
          selectVisibleSql('contracts', `AND id = ? AND project_id = ? AND kind = '施工'`),
          [draft.contractId, draft.projectId],
        )
        if (!contract)
          throw new Error('施工合同无效、已删除或不属于当前项目')

        const stageCodes = templates.flatMap(({ template }) => template.stageCode ? [template.stageCode] : [])
        const itemCodes = templates.flatMap(({ template }) => template.itemCodes)
        const stages = stageCodes.length
          ? await tx.select<IdCodeRow>(
              selectVisibleSql('construction_stages', `AND project_id = ? AND code IN (${stageCodes.map(() => '?').join(', ')})`),
              [draft.projectId, ...stageCodes],
            )
          : []
        const items = itemCodes.length
          ? await tx.select<IdCodeRow>(
              selectVisibleSql('items', `AND project_id = ? AND code IN (${itemCodes.map(() => '?').join(', ')})`),
              [draft.projectId, ...itemCodes],
            )
          : []
        const stageByCode = new Map(stages.map(row => [row.code, row.id]))
        const itemByCode = new Map(items.map(row => [row.code, row.id]))
        const missingStage = stageCodes.find(code => !stageByCode.has(code))
        const missingItem = itemCodes.find(code => !itemByCode.has(code))
        if (missingStage || missingItem)
          throw new Error(`工序模板映射未就绪：${missingStage ?? missingItem}`)
        const boqLinesByItem = await loadBoqLinesByItem(
          tx,
          draft.projectId,
          draft.contractId,
          [...itemByCode.values()],
        )
        const floors = await loadFloorsByBuildings(tx, buildingIds)

        const [order] = await tx.select<{ next_order: number }>(
          `SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_order
           FROM schedule_groups WHERE project_id = ? AND deleted_at IS NULL`,
          [draft.projectId],
        )
        await tx.execute(
          `INSERT INTO schedule_groups (id, project_id, contract_id, name, sort_order)
           VALUES (?, ?, ?, ?, ?)`,
          [groupId, draft.projectId, draft.contractId, name, Number(order?.next_order) || 10],
        )
        await logCreate(tx, 'schedule_groups', groupId)

        for (const [index, buildingId] of buildingIds.entries()) {
          const id = generateId('schedule_group_building')
          await tx.execute(
            `INSERT INTO schedule_group_buildings (id, group_id, building_id, sort_order)
             VALUES (?, ?, ?, ?)`,
            [id, groupId, buildingId, (index + 1) * 10],
          )
          await logCreate(tx, 'schedule_group_buildings', id)
        }

        let previous: { id: string, plannedFinish: string } | null = null
        for (const [index, { row, template }] of templates.entries()) {
          const taskId = generateId('schedule_task')
          const stageId = template.stageCode ? stageByCode.get(template.stageCode)! : null
          await tx.execute(
            `INSERT INTO schedule_tasks
              (id, project_id, group_id, name, trade, color, duration_days,
               planned_start, planned_finish, has_qty, manual_progress, stage_id, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              taskId,
              draft.projectId,
              groupId,
              template.name,
              template.trade,
              template.color,
              row.durationDays,
              row.plannedStart,
              row.plannedFinish,
              stageId ? 1 : 0,
              stageId ? null : 0,
              stageId,
              (index + 1) * 10,
            ],
          )
          await logCreate(tx, 'schedule_tasks', taskId)

          for (const itemCode of template.itemCodes) {
            const mapId = generateId('schedule_task_item')
            const itemId = itemByCode.get(itemCode)!
            const boqLines = boqLinesByItem.get(itemId) ?? []
            const boqLineId = boqLines[0]?.id ?? null
            await tx.execute(
              `INSERT INTO task_item_map (id, task_id, item_id, boq_line_id)
               VALUES (?, ?, ?, ?)`,
              [mapId, taskId, itemId, boqLineId],
            )
            await logCreate(tx, 'task_item_map', mapId)
            for (const boqLine of boqLines) {
              const lineFloors = applicableFloors(boqLine, floors)
              if (lineFloors.length) {
                await createFloorPlans(
                  tx,
                  taskId,
                  boqLine.id,
                  lineFloors,
                  row.plannedStart,
                  row.plannedFinish,
                )
              }
            }
          }
          if (previous) {
            const dependencyId = generateId('schedule_dependency')
            await tx.execute(
              `INSERT INTO task_dependencies
                (id, pred_id, succ_id, dependency_type, lag_days)
               VALUES (?, ?, ?, 'FS', ?)`,
              [dependencyId, previous.id, taskId, calendarDays(previous.plannedFinish, row.plannedStart)],
            )
            await logCreate(tx, 'task_dependencies', dependencyId)
          }
          previous = { id: taskId, plannedFinish: row.plannedFinish }
        }
      })
      await reload(draft.projectId, today)
      return groupId
    }
    catch (cause) {
      error.value = `楼栋分组创建失败：${toErrorMessage(cause)}`
      throw cause
    }
    finally {
      saving.value = false
    }
  }

  function validatedTaskPatch(current: ScheduleTaskView, patch: UpdateScheduleTaskPatch) {
    if (current.hasQty && patch.manualProgress != null)
      throw new Error('工程量联动工序不能人工填报')
    const manualProgress = patch.manualProgress ?? current.manualProgress
    if (!current.hasQty && (manualProgress == null || manualProgress < 0 || manualProgress > 1))
      throw new Error('人工进度必须在 0~100% 之间')
    const plannedStart = patch.plannedStart ?? current.plannedStart
    const plannedFinish = patch.plannedFinish ?? current.plannedFinish
    if (calendarDays(plannedStart, plannedFinish) < 0)
      throw new Error('计划完成不能早于计划开始')
    return { manualProgress, plannedStart, plannedFinish }
  }

  async function persistTaskPatch(
    tx: ScheduleDb,
    current: ScheduleTaskView,
    patch: UpdateScheduleTaskPatch,
  ) {
    const { manualProgress, plannedStart, plannedFinish } = validatedTaskPatch(current, patch)
    const taskLogId = await withUpdateLog(tx, 'schedule_tasks', current.id, () => tx.execute(
      `UPDATE schedule_tasks
       SET planned_start = ?, planned_finish = ?, duration_days = ?, manual_progress = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [
        plannedStart,
        plannedFinish,
        calendarDays(plannedStart, plannedFinish) + 1,
        current.hasQty ? null : manualProgress,
        current.id,
      ],
    ))
    const plansByBoqLine = new Map<string, typeof current.floorPlans>()
    for (const plan of current.floorPlans) {
      plansByBoqLine.set(
        plan.boqLineId,
        [...(plansByBoqLine.get(plan.boqLineId) ?? []), plan],
      )
    }
    for (const plans of plansByBoqLine.values()) {
      const orderedPlans = [...plans].sort((left, right) => left.sortOrder - right.sortOrder)
      for (const [index, plan] of orderedPlans.entries()) {
        if (plan.isManual)
          continue
        const window = floorPlanWindow(plannedStart, plannedFinish, index, orderedPlans.length)
        await withUpdateLog(tx, 'schedule_task_floor_plans', plan.id, () => tx.execute(
          `UPDATE schedule_task_floor_plans
           SET planned_start = ?, planned_finish = ?, updated_at = datetime('now')
           WHERE id = ?`,
          [window.plannedStart, window.plannedFinish, plan.id],
        ))
      }
    }
    return taskLogId
  }

  function validateFloorPlanPatches(
    current: ScheduleTaskView,
    patches: readonly UpdateScheduleFloorPlanPatch[],
  ) {
    const patchById = new Map(patches.map(patch => [patch.id, patch]))
    if (patchById.size !== patches.length)
      throw new Error('楼层计划包含重复记录')
    const currentById = new Map(current.floorPlans.map(plan => [plan.id, plan]))
    for (const patch of patches) {
      if (!currentById.has(patch.id))
        throw new Error('楼层计划不属于当前工序或已删除')
      if (calendarDays(patch.plannedStart, patch.plannedFinish) < 0)
        throw new Error('楼层计划完成不能早于开始')
    }
    return currentById
  }

  async function persistFloorPlanPatches(
    tx: ScheduleDb,
    current: ScheduleTaskView,
    patches: readonly UpdateScheduleFloorPlanPatch[],
  ) {
    const currentById = validateFloorPlanPatches(current, patches)
    const logIds: string[] = []
    for (const patch of patches) {
      const currentPlan = currentById.get(patch.id)!
      if (
        currentPlan.plannedStart === patch.plannedStart
        && currentPlan.plannedFinish === patch.plannedFinish
      ) {
        continue
      }
      const logId = await withUpdateLog(tx, 'schedule_task_floor_plans', patch.id, () => tx.execute(
        `UPDATE schedule_task_floor_plans
         SET planned_start = ?,
             planned_finish = ?,
             is_manual = 1,
             updated_at = datetime('now')
         WHERE id = ?`,
        [patch.plannedStart, patch.plannedFinish, patch.id],
      ))
      if (logId)
        logIds.push(logId)
    }
    return logIds
  }

  function validatedDependency(
    tasks: readonly ScheduleTaskView[],
    successorId: string,
    predecessorId: string,
  ) {
    const successor = tasks.find(task => task.id === successorId)
    const predecessor = tasks.find(task => task.id === predecessorId)
    if (!successor || !predecessor || successor.groupId !== predecessor.groupId)
      throw new Error('前置工序与后续工序必须属于同一楼栋分组')
    if (successor.id === predecessor.id)
      throw new Error('工序不能依赖自身')
    return { predecessor, successor }
  }

  async function persistDependency(
    tx: ScheduleDb,
    current: ScheduleDependencyInput | undefined,
    successorId: string,
    predecessorId: string,
    lagDays: number,
  ) {
    const normalizedLag = Math.trunc(lagDays)
    if (current) {
      return withUpdateLog(tx, 'task_dependencies', current.id, () => tx.execute(
        `UPDATE task_dependencies
         SET pred_id = ?, dependency_type = 'FS', lag_days = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [predecessorId, normalizedLag, current.id],
      ))
    }
    const dependencyId = generateId('schedule_dependency')
    await tx.execute(
      `INSERT INTO task_dependencies (id, pred_id, succ_id, dependency_type, lag_days)
       VALUES (?, ?, ?, 'FS', ?)`,
      [dependencyId, predecessorId, successorId, normalizedLag],
    )
    return logCreate(tx, 'task_dependencies', dependencyId)
  }

  async function updateTask(
    taskId: string,
    patch: UpdateScheduleTaskPatch,
    today = activeToday,
  ) {
    const current = snapshot.value?.groups.flatMap(group => group.tasks).find(task => task.id === taskId)
    if (!current)
      throw new Error('工序不存在或已删除')
    validatedTaskPatch(current, patch)

    saving.value = true
    try {
      const logId = await withTransaction(tx => persistTaskPatch(tx, current, patch))
      await loadProject(current.projectId, today)
      const allTasks = snapshot.value?.groups.flatMap(group => group.tasks) ?? []
      return {
        logId,
        conflicts: dependencyConflicts(allTasks, snapshot.value?.dependencies ?? []),
      }
    }
    finally {
      saving.value = false
    }
  }

  async function updateFloorPlans(
    taskId: string,
    patches: readonly UpdateScheduleFloorPlanPatch[],
    today = activeToday,
  ) {
    const current = snapshot.value?.groups.flatMap(group => group.tasks).find(task => task.id === taskId)
    if (!current)
      throw new Error('工序不存在或已删除')
    validateFloorPlanPatches(current, patches)
    saving.value = true
    try {
      const logIds = await withTransaction(tx => persistFloorPlanPatches(tx, current, patches))
      await loadProject(current.projectId, today)
      return logIds
    }
    finally {
      saving.value = false
    }
  }

  async function updateDependency(
    successorId: string,
    predecessorId: string,
    lagDays: number,
    today = activeToday,
  ) {
    const tasks = snapshot.value?.groups.flatMap(group => group.tasks) ?? []
    const { successor } = validatedDependency(tasks, successorId, predecessorId)
    const current = snapshot.value?.dependencies.find(dependency => dependency.succId === successorId)
    saving.value = true
    try {
      const logId = await withTransaction(tx =>
        persistDependency(tx, current, successorId, predecessorId, lagDays),
      )
      await loadProject(successor.projectId, today)
      const allTasks = snapshot.value?.groups.flatMap(group => group.tasks) ?? []
      return {
        logId,
        conflicts: dependencyConflicts(allTasks, snapshot.value?.dependencies ?? []),
      }
    }
    finally {
      saving.value = false
    }
  }

  async function saveTaskPlan(
    taskId: string,
    draft: SaveScheduleTaskPlanDraft,
    today = activeToday,
  ) {
    const tasks = snapshot.value?.groups.flatMap(group => group.tasks) ?? []
    const current = tasks.find(task => task.id === taskId)
    if (!current)
      throw new Error('工序不存在或已删除')
    validatedTaskPatch(current, draft.task)
    validateFloorPlanPatches(current, draft.floorPlans)
    if (draft.dependency)
      validatedDependency(tasks, taskId, draft.dependency.predecessorId)
    const currentDependency = snapshot.value?.dependencies.find(dependency => dependency.succId === taskId)

    saving.value = true
    try {
      const logs = await withTransaction(async (tx) => {
        const taskLogId = await persistTaskPatch(tx, current, draft.task)
        const floorPlanLogIds = await persistFloorPlanPatches(tx, current, draft.floorPlans)
        const dependencyLogId = draft.dependency
          ? await persistDependency(
              tx,
              currentDependency,
              taskId,
              draft.dependency.predecessorId,
              draft.dependency.lagDays,
            )
          : null
        return { taskLogId, floorPlanLogIds, dependencyLogId }
      })
      await loadProject(current.projectId, today)
      const nextTasks = snapshot.value?.groups.flatMap(group => group.tasks) ?? []
      return {
        ...logs,
        conflicts: dependencyConflicts(nextTasks, snapshot.value?.dependencies ?? []),
      }
    }
    finally {
      saving.value = false
    }
  }

  async function setBaseline(projectId: string, today = activeToday) {
    const tasks = snapshot.value?.id === projectId
      ? snapshot.value.groups.flatMap(group => group.tasks)
      : []
    const logIds: string[] = []
    await withTransaction(async (tx) => {
      for (const task of tasks) {
        const logId = await withUpdateLog(tx, 'schedule_tasks', task.id, () => tx.execute(
          `UPDATE schedule_tasks
           SET baseline_start = planned_start,
               baseline_finish = planned_finish,
               updated_at = datetime('now')
           WHERE id = ?`,
          [task.id],
        ))
        if (logId)
          logIds.push(logId)
      }
    })
    await loadProject(projectId, today)
    return logIds
  }

  async function addTask(
    groupId: string,
    draft: AddScheduleTaskDraft,
    today = activeToday,
  ) {
    const group = snapshot.value?.groups.find(candidate => candidate.id === groupId)
    const template = SCHEDULE_TEMPLATE_BY_KEY.get(draft.templateKey)
    if (!group || !template)
      throw new Error('楼栋分组或工序模板不存在')
    const taskId = generateId('schedule_task')
    const plannedFinish = addCalendarDays(draft.plannedStart, template.durationDays - 1)
    await withTransaction(async (tx) => {
      const [stage] = template.stageCode
        ? await tx.select<IdCodeRow>(
            selectVisibleSql('construction_stages', 'AND project_id = ? AND code = ?'),
            [group.projectId, template.stageCode],
          )
        : []
      if (template.stageCode && !stage)
        throw new Error(`工序阶段未就绪：${template.stageCode}`)
      const items = template.itemCodes.length
        ? await tx.select<IdCodeRow>(
            selectVisibleSql('items', `AND project_id = ? AND code IN (${template.itemCodes.map(() => '?').join(', ')})`),
            [group.projectId, ...template.itemCodes],
          )
        : []
      if (items.length !== template.itemCodes.length)
        throw new Error('工序分项映射未就绪')
      const itemByCode = new Map(items.map(item => [item.code, item.id]))
      const boqLinesByItem = await loadBoqLinesByItem(
        tx,
        group.projectId,
        group.contractId,
        [...itemByCode.values()],
      )
      const floors = await loadFloorsByBuildings(tx, group.buildingIds)
      const lastTask = [...group.tasks].sort((left, right) => left.sortOrder - right.sortOrder).at(-1)
      const sortOrder = (lastTask?.sortOrder ?? 0) + 10
      await tx.execute(
        `INSERT INTO schedule_tasks
          (id, project_id, group_id, name, trade, color, duration_days,
           planned_start, planned_finish, has_qty, manual_progress, stage_id, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          taskId,
          group.projectId,
          group.id,
          template.name,
          template.trade,
          template.color,
          template.durationDays,
          draft.plannedStart,
          plannedFinish,
          stage ? 1 : 0,
          stage ? null : 0,
          stage?.id ?? null,
          sortOrder,
        ],
      )
      await logCreate(tx, 'schedule_tasks', taskId)
      for (const itemCode of template.itemCodes) {
        const mapId = generateId('schedule_task_item')
        const itemId = itemByCode.get(itemCode)!
        const boqLines = boqLinesByItem.get(itemId) ?? []
        const boqLineId = boqLines[0]?.id ?? null
        await tx.execute(
          `INSERT INTO task_item_map (id, task_id, item_id, boq_line_id) VALUES (?, ?, ?, ?)`,
          [mapId, taskId, itemId, boqLineId],
        )
        await logCreate(tx, 'task_item_map', mapId)
        for (const boqLine of boqLines) {
          const lineFloors = applicableFloors(boqLine, floors)
          if (lineFloors.length) {
            await createFloorPlans(
              tx,
              taskId,
              boqLine.id,
              lineFloors,
              draft.plannedStart,
              plannedFinish,
            )
          }
        }
      }
      if (lastTask) {
        const dependencyId = generateId('schedule_dependency')
        await tx.execute(
          `INSERT INTO task_dependencies (id, pred_id, succ_id, dependency_type, lag_days)
           VALUES (?, ?, ?, 'FS', ?)`,
          [dependencyId, lastTask.id, taskId, calendarDays(lastTask.plannedFinish, draft.plannedStart)],
        )
        await logCreate(tx, 'task_dependencies', dependencyId)
      }
    })
    await loadProject(group.projectId, today)
    return taskId
  }

  async function removeTask(taskId: string, today = activeToday) {
    const task = snapshot.value?.groups.flatMap(group => group.tasks).find(candidate => candidate.id === taskId)
    if (!task)
      return null
    const logId = await softDelete(db, 'schedule_tasks', taskId)
    await loadProject(task.projectId, today)
    return logId
  }

  async function undo(logIds: readonly string[], today = activeToday) {
    await withTransaction(async (tx) => {
      for (const logId of [...logIds].reverse())
        await undoOperation(tx, logId)
    })
    await reload(activeProjectId, today)
  }

  return {
    catalog: readonly(catalog),
    buildings: readonly(buildings),
    buildingCoverage: readonly(buildingCoverage),
    contracts: readonly(contracts),
    snapshot: readonly(snapshot),
    loading: readonly(loading),
    saving: readonly(saving),
    error: readonly(error),
    loadCatalog,
    loadBuildings,
    loadContracts,
    loadProject,
    createGroup,
    updateTask,
    updateFloorPlans,
    updateDependency,
    saveTaskPlan,
    setBaseline,
    addTask,
    removeTask,
    undo,
  }
})
