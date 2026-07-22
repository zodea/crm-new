import type { ScheduleOverlapMode, ScheduleTemplatePlanInput } from '~/lib/schedule/planning'
import type { ScheduleBuildingOption, ScheduleCatalogProject, ScheduleProjectView } from '~/lib/schedule/read-model'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { execute, select, withTransaction } from '~/lib/db/connection'
import {
  logCreate,
  selectVisibleSql,
  softDelete,
  undoOperation,
  withUpdateLog,
} from '~/lib/db/soft-delete'
import {
  addCalendarDays,
  calendarDays,
  dependencyConflicts,
  planTemplateTasks,
} from '~/lib/schedule/planning'
import { loadScheduleBuildings, loadScheduleCatalog, loadScheduleProject } from '~/lib/schedule/read-model'
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

export interface AddScheduleTaskDraft {
  templateKey: string
  plannedStart: string
}

interface IdCodeRow { id: string, code: string }

export const useScheduleStore = defineStore('schedule', () => {
  const catalog = shallowRef<ScheduleCatalogProject[]>([])
  const buildings = shallowRef<ScheduleBuildingOption[]>([])
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

  async function loadBuildings(projectId: string) {
    buildings.value = projectId ? await loadScheduleBuildings(db, projectId) : []
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
    if (!draft.projectId || !name)
      throw new Error('项目与分组名称必填')
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
        const buildingPlaceholders = buildingIds.map(() => '?').join(', ')
        const buildings = await tx.select<{ id: string }>(
          selectVisibleSql('buildings', `AND project_id = ? AND id IN (${buildingPlaceholders})`),
          [draft.projectId, ...buildingIds],
        )
        if (buildings.length !== buildingIds.length)
          throw new Error('楼栋范围包含无效或已删除记录')

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

        const [order] = await tx.select<{ next_order: number }>(
          `SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_order
           FROM schedule_groups WHERE project_id = ? AND deleted_at IS NULL`,
          [draft.projectId],
        )
        await tx.execute(
          `INSERT INTO schedule_groups (id, project_id, name, sort_order)
           VALUES (?, ?, ?, ?)`,
          [groupId, draft.projectId, name, Number(order?.next_order) || 10],
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
            await tx.execute(
              `INSERT INTO task_item_map (id, task_id, item_id) VALUES (?, ?, ?)`,
              [mapId, taskId, itemByCode.get(itemCode)!],
            )
            await logCreate(tx, 'task_item_map', mapId)
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

  async function updateTask(
    taskId: string,
    patch: UpdateScheduleTaskPatch,
    today = activeToday,
  ) {
    const current = snapshot.value?.groups.flatMap(group => group.tasks).find(task => task.id === taskId)
    if (!current)
      throw new Error('工序不存在或已删除')
    if (current.hasQty && patch.manualProgress != null)
      throw new Error('工程量联动工序不能人工填报')
    const manualProgress = patch.manualProgress ?? current.manualProgress
    if (!current.hasQty && (manualProgress == null || manualProgress < 0 || manualProgress > 1))
      throw new Error('人工进度必须在 0~100% 之间')
    const plannedStart = patch.plannedStart ?? current.plannedStart
    const plannedFinish = patch.plannedFinish ?? current.plannedFinish
    if (calendarDays(plannedStart, plannedFinish) < 0)
      throw new Error('计划完成不能早于计划开始')

    saving.value = true
    try {
      const logId = await withUpdateLog(db, 'schedule_tasks', taskId, () => execute(
        `UPDATE schedule_tasks
         SET planned_start = ?, planned_finish = ?, duration_days = ?, manual_progress = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [plannedStart, plannedFinish, calendarDays(plannedStart, plannedFinish) + 1, current.hasQty ? null : manualProgress, taskId],
      ))
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

  async function updateDependency(
    successorId: string,
    predecessorId: string,
    lagDays: number,
    today = activeToday,
  ) {
    const tasks = snapshot.value?.groups.flatMap(group => group.tasks) ?? []
    const successor = tasks.find(task => task.id === successorId)
    const predecessor = tasks.find(task => task.id === predecessorId)
    if (!successor || !predecessor || successor.groupId !== predecessor.groupId)
      throw new Error('前置工序与后续工序必须属于同一楼栋分组')
    if (successor.id === predecessor.id)
      throw new Error('工序不能依赖自身')

    const normalizedLag = Math.trunc(lagDays)
    const current = snapshot.value?.dependencies.find(dependency => dependency.succId === successorId)
    saving.value = true
    try {
      let logId: string | null
      if (current) {
        logId = await withUpdateLog(db, 'task_dependencies', current.id, () => execute(
          `UPDATE task_dependencies
           SET pred_id = ?, dependency_type = 'FS', lag_days = ?, updated_at = datetime('now')
           WHERE id = ?`,
          [predecessorId, normalizedLag, current.id],
        ))
      }
      else {
        const dependencyId = generateId('schedule_dependency')
        await execute(
          `INSERT INTO task_dependencies (id, pred_id, succ_id, dependency_type, lag_days)
           VALUES (?, ?, ?, 'FS', ?)`,
          [dependencyId, predecessorId, successorId, normalizedLag],
        )
        logId = await logCreate(db, 'task_dependencies', dependencyId)
      }
      await loadProject(successor.projectId, today)
      return logId
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
        await tx.execute(`INSERT INTO task_item_map (id, task_id, item_id) VALUES (?, ?, ?)`, [mapId, taskId, itemByCode.get(itemCode)!])
        await logCreate(tx, 'task_item_map', mapId)
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
    snapshot: readonly(snapshot),
    loading: readonly(loading),
    saving: readonly(saving),
    error: readonly(error),
    loadCatalog,
    loadBuildings,
    loadProject,
    createGroup,
    updateTask,
    updateDependency,
    setBaseline,
    addTask,
    removeTask,
    undo,
  }
})
