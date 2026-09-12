import type { TransactionDb } from '../db/coordinator'
import type { QuantityMeasureTotal } from '../quantity/totals'
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
import {
  hiddenCtesFor,
  logCreate,
  restoreRecord,
  selectVisibleSql,
  softDelete,
  undoOperation,
  visibleCond,
  withUpdateLog,
} from '~/lib/db/soft-delete'
import {
  bindScheduleContract,
  previewScheduleContractBinding,
} from '~/lib/schedule/contract-binding'
import {
  addCalendarDays,
  calendarDays,
  dependencyConflictPreview,
  dependencyConflicts,
  dependencyWouldCycle,
  normalizeDependencyLag,
  planTemplateTasks,
  SCHEDULE_DEPENDENCY_CONFLICT_OPERATOR,
  SCHEDULE_DEPENDENCY_MANUAL_REMOVE_OPERATOR,
  SCHEDULE_DEPENDENCY_RESTORE_OPERATOR,
} from '~/lib/schedule/planning'
import {
  loadScheduleProcessLibraries,
  loadScheduleProcessLibraryTasks,
} from '~/lib/schedule/process-library'
import {
  loadScheduleBuildingCoverage,
  loadScheduleBuildings,
  loadScheduleCatalog,
  loadScheduleContracts,
  loadScheduleProject,
} from '~/lib/schedule/read-model'
import { toErrorMessage } from '~/lib/util/error'
import { generateId } from '~/lib/util/id'
import { toLocalDateInputValue } from '~/lib/util/local-date'
import { quantityMeasureTotal } from '../quantity/totals'

type ScheduleDb = TransactionDb

export interface CreateScheduleGroupDraft {
  librarySourceVersion?: string
  projectId: string
  scopeBasis?: 'contract' | 'provisional'
  contractId?: string | null
  processLibraryId?: string
  name: string
  buildingIds: readonly string[]
  startDate: string
  overlapMode: ScheduleOverlapMode
  tasks: readonly ({
    templateKey: string
    predecessorKey?: string | null
    predecessorDisabled?: boolean
  } & Omit<ScheduleTemplatePlanInput, 'key'>)[]
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
  disableDependencyIds?: readonly string[]
  task: UpdateScheduleTaskPatch
  floorPlans: readonly UpdateScheduleFloorPlanPatch[]
  /** null 表示本次未编辑依赖；主动移除必须使用独立 removeDependency 动作。 */
  dependency: { predecessorId: string, lagDays: number } | null
}

interface IdCodeRow { id: string, code: string, completion_mode?: 'unit' | 'manual', trade?: string }
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
interface ProvisionalFloorSourceRow {
  building_id: string
  floor_id: string
  item_id: string
  item_code: string
  provisional_qty: number | null
  unit_count: number
  quantity_unit: string
  source_count: number
  missing_count: number
  sources_json: string
}

async function validateEffectiveStageMapping(db: ScheduleDb, stage: IdCodeRow | undefined, itemIds: readonly string[]) {
  if (!stage || stage.completion_mode === 'manual')
    return
  if (!itemIds.length)
    throw new Error('按户计量工序需要当前项目启用的分项映射')
  const rows = await db.select<{ item_id: string }>(selectVisibleSql('construction_stage_items', 'AND stage_id = ?'), [stage.id])
  if (itemIds.some(id => !rows.some(row => row.item_id === id)))
    throw new Error('工序分项尚未在当前阶段启用，请先核对阶段映射')
}

export interface ScheduleProvisionalBuildingPreview {
  quantities: (QuantityMeasureTotal & { unit: string })[]
  blockers: string[]
  buildingId: string
  floorCount: number
  unitCount: number
  typedUnitCount: number
  itemCount: number
  itemCodes: readonly string[]
  totalQty: number
}

export interface ScheduleProvisionalScopePreview {
  quantities: (QuantityMeasureTotal & { unit: string })[]
  blockers: string[]
  floorCount: number
  unitCount: number
  itemCount: number
  itemCodes: readonly string[]
  totalQty: number
  buildings: readonly ScheduleProvisionalBuildingPreview[]
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

function validateContractFloorCoverage(buildings: readonly { id: string, name: string }[], templates: readonly { name: string, itemCodes: readonly string[] }[], itemByCode: Map<string, string>, lines: Map<string, BoqLineRow[]>, floors: readonly FloorRow[]) {
  for (const building of buildings) {
    for (const template of templates) {
      if (template.itemCodes.length && !template.itemCodes.some(code => (lines.get(itemByCode.get(code)!) ?? []).some(line => applicableFloors(line, floors.filter(floor => floor.building_id === building.id)).length)))
        throw new Error(`「${building.name}」缺少「${template.name}」的显式清单关联或有效楼层范围`)
    }
  }
}

async function createFloorPlans(
  targetDb: ScheduleDb,
  taskId: string,
  itemId: string,
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
        (id, task_id, floor_id, item_id, boq_line_id, source_basis,
         planned_start, planned_finish, sort_order)
       VALUES (?, ?, ?, ?, ?, 'contract', ?, ?, ?)`,
      [
        planId,
        taskId,
        floor.id,
        itemId,
        boqLineId,
        window.plannedStart,
        window.plannedFinish,
        (index + 1) * 10,
      ],
    )
    await logCreate(targetDb, 'schedule_task_floor_plans', planId)
  }
}

async function loadProvisionalFloorSources(
  targetDb: ScheduleDb,
  buildingIds: readonly string[],
  itemIds: readonly string[] = [],
): Promise<ProvisionalFloorSourceRow[]> {
  const uniqueBuildingIds = [...new Set(buildingIds)]
  const uniqueItemIds = [...new Set(itemIds)]
  if (!uniqueBuildingIds.length)
    return []
  const itemFilter = uniqueItemIds.length
    ? `AND template_item.item_id IN (${uniqueItemIds.map(() => '?').join(', ')})`
    : ''
  return targetDb.select<ProvisionalFloorSourceRow>(
    `${hiddenCtesFor(
      'floors',
      'units',
      'house_type_templates',
      'rooms',
      'house_type_template_items',
      'items',
    )}
     SELECT floor_row.building_id,
            unit_row.floor_id,
            template_item.item_id,
            item.code AS item_code,
            SUM(template_item.provisional_qty) AS provisional_qty,
            COUNT(DISTINCT unit_row.id) AS unit_count,
            COALESCE(item.unit, '') AS quantity_unit,
            COUNT(*) AS source_count,
            SUM(CASE WHEN template_item.provisional_qty IS NULL THEN 1 ELSE 0 END) AS missing_count,
            json_group_array(json_object('unitId', unit_row.id, 'templateItemId', template_item.id, 'quantity', template_item.provisional_qty, 'unit', COALESCE(item.unit, ''))) AS sources_json
     FROM units unit_row
     JOIN floors floor_row ON floor_row.id = unit_row.floor_id
     JOIN house_type_templates template
       ON template.id = unit_row.house_type_template_id
     JOIN rooms room_row ON room_row.template_id = template.id
     JOIN house_type_template_items template_item
       ON template_item.room_id = room_row.id
     JOIN items item ON item.id = template_item.item_id
     WHERE ${visibleCond('units', 'unit_row')}
       AND ${visibleCond('floors', 'floor_row')}
       AND ${visibleCond('house_type_templates', 'template')}
       AND ${visibleCond('rooms', 'room_row')}
       AND ${visibleCond('house_type_template_items', 'template_item')}
       AND ${visibleCond('items', 'item')}
       AND floor_row.building_id IN (${uniqueBuildingIds.map(() => '?').join(', ')})
       ${itemFilter}
     GROUP BY floor_row.building_id, unit_row.floor_id, template_item.item_id, item.code, item.unit
     ORDER BY floor_row.building_id, floor_row.sort_order, unit_row.floor_id,
              template_item.item_id`,
    [...uniqueBuildingIds, ...uniqueItemIds],
  )
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
    `${hiddenCtesFor('boq_lines', 'house_type_template_items')}
     SELECT DISTINCT line.id, matched.item_id, line.building, line.unit_type, line.floor_zone
     FROM boq_lines line JOIN (
       SELECT id AS boq_line_id, item_id FROM boq_lines WHERE item_id IS NOT NULL
       UNION
       SELECT template_item.boq_line_id, template_item.item_id FROM house_type_template_items template_item
       WHERE ${visibleCond('house_type_template_items', 'template_item')} AND template_item.boq_line_id IS NOT NULL
     ) matched ON matched.boq_line_id = line.id
     JOIN items item ON item.id = matched.item_id AND item.project_id = line.project_id AND item.deleted_at IS NULL
     WHERE ${visibleCond('boq_lines', 'line')} AND line.project_id = ? AND line.contract_id = ?
       AND trim(line.building) <> '' AND matched.item_id IN (${uniqueItemIds.map(() => '?').join(', ')})
     ORDER BY line.sort_order, line.id`,
    [projectId, contractId, ...uniqueItemIds],
  )
  const linesByItem = new Map<string, BoqLineRow[]>()
  for (const row of rows) {
    linesByItem.set(row.item_id, [...(linesByItem.get(row.item_id) ?? []), row])
  }
  return linesByItem
}

export function createScheduleEngine(db: ScheduleDb, withTransaction: <T>(work: (tx: ScheduleDb) => Promise<T>) => Promise<T>, shallowRef: <T>(value: T) => { value: T } = value => ({ value })) {
  const readonly = <T>(value: T) => value
  const expandedGroupIdsByProject = shallowRef<Record<string, string[]>>({})
  const catalog = shallowRef<ScheduleCatalogProject[]>([])
  const buildings = shallowRef<ScheduleBuildingOption[]>([])
  const buildingCoverage = shallowRef<ScheduleBuildingCoverage[]>([])
  const contracts = shallowRef<ScheduleContractOption[]>([])
  const processLibraries = shallowRef<Awaited<ReturnType<typeof loadScheduleProcessLibraries>>>([])
  const processTasks = shallowRef<Awaited<ReturnType<typeof loadScheduleProcessLibraryTasks>>>([])
  const processTasksLibraryId = shallowRef('')
  let processTaskRequestGeneration = 0
  let processLibraryRequestGeneration = 0
  const snapshot = shallowRef<ScheduleProjectView | null>(null)
  const loading = shallowRef(false)
  const saving = shallowRef(false)
  const error = shallowRef('')
  let activeProjectId = ''
  let activeToday = toLocalDateInputValue()
  let latestRequest = 0

  function setExpandedGroupIds(projectId: string, groupIds: readonly string[]) {
    expandedGroupIdsByProject.value = {
      ...expandedGroupIdsByProject.value,
      [projectId]: [...new Set(groupIds)],
    }
  }

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

  async function previewProvisionalScope(
    buildingIds: readonly string[],
    targetDb: ScheduleDb = db,
  ): Promise<ScheduleProvisionalScopePreview> {
    const rows = await loadProvisionalFloorSources(targetDb, buildingIds)
    const uniqueBuildingIds = [...new Set(buildingIds)]
    const unitSummaries = uniqueBuildingIds.length
      ? await targetDb.select<{
          building_id: string
          floor_count: number
          unit_count: number
          typed_unit_count: number
        }>(
          `${hiddenCtesFor('floors', 'units', 'house_type_templates')}
           SELECT floor_row.building_id,
                  COUNT(DISTINCT floor_row.id) AS floor_count,
                  COUNT(DISTINCT unit_row.id) AS unit_count,
                  COUNT(DISTINCT CASE
                    WHEN template.id IS NOT NULL THEN unit_row.id
                  END) AS typed_unit_count
           FROM floors floor_row
           LEFT JOIN units unit_row
             ON unit_row.floor_id = floor_row.id
            AND ${visibleCond('units', 'unit_row')}
           LEFT JOIN house_type_templates template
             ON template.id = unit_row.house_type_template_id
            AND ${visibleCond('house_type_templates', 'template')}
           WHERE ${visibleCond('floors', 'floor_row')}
             AND floor_row.building_id IN (${uniqueBuildingIds.map(() => '?').join(', ')})
           GROUP BY floor_row.building_id`,
          uniqueBuildingIds,
        )
      : []
    const unitsByBuilding = new Map(unitSummaries.map(row => [row.building_id, row]))
    const quantitiesFor = (sources: ProvisionalFloorSourceRow[]) => [...new Set(sources.map(row => row.quantity_unit))].map((unit) => {
      const group = sources.filter(row => row.quantity_unit === unit)
      const values = group.flatMap(row => row.provisional_qty === null ? [] : [row.provisional_qty])
      return { unit, ...quantityMeasureTotal(values.length ? values.reduce((a, b) => a + b, 0) : null, group.reduce((sum, row) => sum + row.source_count, 0), group.reduce((sum, row) => sum + row.missing_count, 0), unit) }
    })
    const buildings = uniqueBuildingIds.map((buildingId) => {
      const buildingRows = rows.filter(row => row.building_id === buildingId)
      const unitSummary = unitsByBuilding.get(buildingId)
      return {
        quantities: quantitiesFor(buildingRows),
        blockers: [
          ...(!unitSummary?.floor_count ? ['缺少楼层'] : []),
          ...(!unitSummary?.unit_count ? ['缺少户'] : []),
          ...(unitSummary && unitSummary.typed_unit_count < unitSummary.unit_count ? ['部分户未关联有效模板'] : []),
          ...(!buildingRows.length ? ['缺少有效分项来源'] : []),
        ],
        buildingId,
        floorCount: Number(unitSummary?.floor_count) || 0,
        unitCount: Number(unitSummary?.unit_count) || 0,
        typedUnitCount: Number(unitSummary?.typed_unit_count) || 0,
        itemCount: new Set(buildingRows.map(row => row.item_id)).size,
        itemCodes: [...new Set(buildingRows.map(row => row.item_code))],
        totalQty: buildingRows.reduce(
          (sum, row) => sum + (Number(row.provisional_qty) || 0),
          0,
        ),
      }
    })
    return {
      quantities: quantitiesFor(rows),
      blockers: buildings.flatMap(building => building.blockers.map(message => `${building.buildingId}：${message}`)),
      floorCount: buildings.reduce((sum, building) => sum + building.floorCount, 0),
      unitCount: buildings.reduce((sum, building) => sum + building.unitCount, 0),
      itemCount: new Set(rows.map(row => row.item_id)).size,
      itemCodes: [...new Set(rows.map(row => row.item_code))],
      totalQty: buildings.reduce((sum, building) => sum + building.totalQty, 0),
      buildings,
    }
  }

  async function loadProcessLibraries() {
    const generation = ++processLibraryRequestGeneration
    const loaded = await loadScheduleProcessLibraries(db)
    if (generation === processLibraryRequestGeneration)
      processLibraries.value = loaded
  }

  async function loadProcessLibraryTasks(libraryId: string) {
    const generation = ++processTaskRequestGeneration
    const loaded = await loadScheduleProcessLibraryTasks(db, libraryId)
    if (generation !== processTaskRequestGeneration)
      return []
    processTasks.value = loaded
    processTasksLibraryId.value = libraryId
    return loaded
  }

  async function previewContractBinding(groupId: string, contractId: string) {
    return previewScheduleContractBinding(db, groupId, contractId)
  }

  async function bindContract(
    groupId: string,
    contractId: string,
    today = activeToday,
  ) {
    saving.value = true
    error.value = ''
    try {
      const result = await withTransaction(tx =>
        bindScheduleContract(tx, groupId, contractId),
      )
      await loadProject(result.preview.projectId, today)
      return result
    }
    catch (cause) {
      error.value = `施工合同绑定失败：${toErrorMessage(cause)}`
      throw cause
    }
    finally {
      saving.value = false
    }
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
    const scopeBasis = draft.scopeBasis ?? (draft.contractId ? 'contract' : 'provisional')
    if (!draft.projectId || !name)
      throw new Error('项目与分组名称必填')
    if (scopeBasis === 'contract' && !draft.contractId)
      throw new Error('合同清单模式必须选择施工合同')
    if (scopeBasis === 'provisional' && draft.contractId)
      throw new Error('内部暂估模式不能绑定施工合同')
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

    const groupId = generateId('schedule_group')
    saving.value = true
    error.value = ''
    try {
      await withTransaction(async (tx) => {
        const libraries = await loadScheduleProcessLibraries(tx)
        const processLibrary = draft.processLibraryId
          ? libraries.find(row => row.id === draft.processLibraryId)
          : libraries.find(row => row.isDefault) ?? libraries[0]
        if (!processLibrary)
          throw new Error('标准工序库无效或已停用')
        const libraryTasks = await loadScheduleProcessLibraryTasks(tx, processLibrary.id)
        const libraryTaskByKey = new Map(libraryTasks.map(task => [task.key, task]))
        const templates = plannedRows.map((row) => {
          const template = libraryTaskByKey.get(row.key)
          if (!template)
            throw new Error(`标准工序库不包含工序：${row.key}`)
          return { row, template }
        })

        const contractId = scopeBasis === 'contract' ? draft.contractId! : ''
        const buildings = (await loadScheduleBuildings(tx, draft.projectId, contractId))
          .filter(building => buildingIds.includes(building.id))
        if (buildings.length !== buildingIds.length) {
          throw new Error(scopeBasis === 'contract'
            ? '楼栋范围包含无效、已删除或不属于该合同清单的记录'
            : '楼栋范围包含无效、已删除、已排程或不属于当前项目的记录')
        }

        if (scopeBasis === 'contract') {
          const [contract] = await tx.select<{ id: string }>(
            selectVisibleSql('contracts', `AND id = ? AND project_id = ? AND kind = '施工'`),
            [contractId, draft.projectId],
          )
          if (!contract)
            throw new Error('施工合同无效、已删除或不属于当前项目')
        }

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
        for (const { template } of templates)
          await validateEffectiveStageMapping(tx, stages.find(row => row.code === template.stageCode), template.itemCodes.map(code => itemByCode.get(code)!))
        const boqLinesByItem = await loadBoqLinesByItem(
          tx,
          draft.projectId,
          contractId,
          [...itemByCode.values()],
        )
        const floors = await loadFloorsByBuildings(tx, buildingIds)
        if (scopeBasis === 'provisional') {
          const preview = await previewProvisionalScope(buildingIds, tx)
          if (preview.blockers.length)
            throw new Error(preview.blockers.join('；'))
        }
        if (scopeBasis === 'contract')
          validateContractFloorCoverage(buildings, templates.map(row => row.template), itemByCode, boqLinesByItem, floors)
        const provisionalSources = scopeBasis === 'provisional'
          ? await loadProvisionalFloorSources(tx, buildingIds, [...itemByCode.values()])
          : []
        const provisionalSourcesByItem = new Map<string, ProvisionalFloorSourceRow[]>()
        for (const source of provisionalSources) {
          provisionalSourcesByItem.set(
            source.item_id,
            [...(provisionalSourcesByItem.get(source.item_id) ?? []), source],
          )
        }
        if (scopeBasis === 'provisional') {
          for (const building of buildings) {
            const taskWithoutQuantity = templates.find(({ template }) =>
              template.itemCodes.length
              && !template.itemCodes.some(code =>
                (provisionalSourcesByItem.get(itemByCode.get(code)!) ?? [])
                  .some(source => source.building_id === building.id)),
            )
            if (taskWithoutQuantity) {
              throw new Error(
                `「${building.name}」缺少「${taskWithoutQuantity.template.name}」对应分项的有效暂估量`,
              )
            }
          }
        }

        const [order] = await tx.select<{ next_order: number }>(
          `SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_order
           FROM schedule_groups WHERE project_id = ? AND deleted_at IS NULL`,
          [draft.projectId],
        )
        await tx.execute(
          `INSERT INTO schedule_groups
            (id, project_id, contract_id, scope_basis, process_library_id,
             process_library_name_snapshot, process_library_version_snapshot,
             name, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            groupId,
            draft.projectId,
            contractId || null,
            scopeBasis,
            processLibrary.id,
            processLibrary.name,
            processLibrary.version,
            name,
            Number(order?.next_order) || 10,
          ],
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

        const enabledTaskKeys = new Set(templates.map(({ row }) => row.key))
        const resolvedPredecessorByKey = new Map<string, string | null>()
        const resolvedPredecessorDisabledByKey = new Map<string, boolean>()
        for (const [index, { row, template }] of templates.entries()) {
          const taskDraft = draft.tasks.find(task => task.templateKey === row.key)
          const hasExplicitPredecessor = taskDraft?.predecessorKey !== undefined
          const configuredPredecessor = hasExplicitPredecessor
            ? taskDraft.predecessorKey ?? null
            : template.predecessorKey
          if (hasExplicitPredecessor && configuredPredecessor && !enabledTaskKeys.has(configuredPredecessor))
            throw new Error('前置工序不在当前启用范围，请重新核对')
          resolvedPredecessorByKey.set(
            row.key,
            configuredPredecessor && enabledTaskKeys.has(configuredPredecessor)
              ? configuredPredecessor
              : hasExplicitPredecessor
                ? null
                : templates[index - 1]?.row.key ?? null,
          )
          resolvedPredecessorDisabledByKey.set(
            row.key,
            hasExplicitPredecessor
              ? Boolean(taskDraft?.predecessorDisabled)
              : configuredPredecessor && enabledTaskKeys.has(configuredPredecessor)
                ? template.predecessorDisabled
                : false,
          )
        }
        const plannedRowByKey = new Map(templates.map(({ row }) => [row.key, row]))
        const plannedDependencies: ScheduleDependencyInput[] = []
        for (const [successorKey, predecessorKey] of resolvedPredecessorByKey) {
          if (!predecessorKey || resolvedPredecessorDisabledByKey.get(successorKey))
            continue
          if (predecessorKey === successorKey || dependencyWouldCycle(plannedDependencies, { predecessorId: predecessorKey, successorId: successorKey }))
            throw new Error('启用的工序前置关系不能依赖自身或形成循环')
          plannedDependencies.push({ id: successorKey, predId: predecessorKey, succId: successorKey, dependencyType: 'FS', lagDays: 0 })
        }
        for (const [successorKey, predecessorKey] of resolvedPredecessorByKey) {
          if (!predecessorKey || resolvedPredecessorDisabledByKey.get(successorKey))
            continue
          const predecessor = plannedRowByKey.get(predecessorKey)
          const successor = plannedRowByKey.get(successorKey)
          if (
            predecessor
            && successor
            && calendarDays(predecessor.plannedStart, successor.plannedStart) < 0
          ) {
            throw new Error('后续工序开始日期不能早于仍启用的前置工序；请先调整日期或置灰冲突关系')
          }
        }

        const createdTaskByKey = new Map<string, {
          id: string
          plannedFinish: string
          plannedStart: string
        }>()
        for (const [index, { row, template }] of templates.entries()) {
          const taskId = generateId('schedule_task')
          const stageId = template.stageCode ? stageByCode.get(template.stageCode)! : null
          const hasQuantity = Boolean(stageId && stages.find(row => row.id === stageId)?.completion_mode !== 'manual')
          const provisionalFloorPlans = scopeBasis === 'provisional'
            ? template.itemCodes.flatMap((itemCode, itemIndex) => {
                const itemId = itemByCode.get(itemCode)!
                const sources = provisionalSourcesByItem.get(itemId) ?? []
                return sources.map((source, floorIndex) => ({
                  floorId: source.floor_id,
                  itemId,
                  provisionalQty: source.missing_count ? null : source.provisional_qty,
                  quantitySnapshot: { unit: source.quantity_unit, ...quantityMeasureTotal(source.provisional_qty, source.source_count, source.missing_count, source.quantity_unit), sources: JSON.parse(source.sources_json) },
                  unitCount: Number(source.unit_count) || 0,
                  sortOrder: (itemIndex + 1) * 1000 + (floorIndex + 1) * 10,
                  ...floorPlanWindow(
                    row.plannedStart,
                    row.plannedFinish,
                    floorIndex,
                    sources.length,
                  ),
                }))
              })
            : []
          const templateSnapshot = JSON.stringify({
            libraryId: processLibrary.id,
            libraryName: processLibrary.name,
            libraryVersion: processLibrary.version,
            libraryTaskId: template.id,
            key: template.key,
            name: template.name,
            trade: template.trade,
            color: template.color,
            durationDays: row.durationDays,
            stageCode: template.stageCode ?? '',
            stageId,
            itemIds: template.itemCodes.map(code => itemByCode.get(code)!),
            itemCodes: template.itemCodes,
            provisionalFloorPlans,
            predecessorKey: resolvedPredecessorByKey.get(row.key) ?? null,
            predecessorDisabled: resolvedPredecessorDisabledByKey.get(row.key) ?? false,
          })
          await tx.execute(
            `INSERT INTO schedule_tasks
              (id, project_id, group_id, name, trade, color, duration_days,
               planned_start, planned_finish, has_qty, manual_progress, stage_id, sort_order,
               source_library_task_id, source_library_version, template_snapshot_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
              hasQuantity ? 1 : 0,
              hasQuantity ? null : 0,
              stageId,
              (index + 1) * 10,
              template.id,
              processLibrary.version,
              templateSnapshot,
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
                  itemId,
                  boqLine.id,
                  lineFloors,
                  row.plannedStart,
                  row.plannedFinish,
                )
              }
            }
            for (const plan of provisionalFloorPlans.filter(candidate => candidate.itemId === itemId)) {
              const planId = generateId('schedule_floor_plan')
              await tx.execute(
                `INSERT INTO schedule_task_floor_plans
                  (id, task_id, floor_id, item_id, boq_line_id, source_basis,
                   provisional_qty, planned_start, planned_finish, sort_order)
                 VALUES (?, ?, ?, ?, NULL, 'provisional', ?, ?, ?, ?)`,
                [
                  planId,
                  taskId,
                  plan.floorId,
                  itemId,
                  plan.provisionalQty,
                  plan.plannedStart,
                  plan.plannedFinish,
                  plan.sortOrder,
                ],
              )
              await logCreate(tx, 'schedule_task_floor_plans', planId)
              if ((await tx.select('SELECT name FROM sqlite_master WHERE type = \'table\' AND name = \'schedule_floor_quantity_snapshots\'')).length)
                await tx.execute('INSERT INTO schedule_floor_quantity_snapshots (id, project_id, snapshot_json, legacy_missing) VALUES (?, ?, ?, 0)', [planId, draft.projectId, JSON.stringify(plan.quantitySnapshot)])
            }
          }
          createdTaskByKey.set(row.key, {
            id: taskId,
            plannedStart: row.plannedStart,
            plannedFinish: row.plannedFinish,
          })
        }
        for (const { row } of templates) {
          const successor = createdTaskByKey.get(row.key)!
          const predecessorKey = resolvedPredecessorByKey.get(row.key) ?? null
          const predecessor = predecessorKey
            ? createdTaskByKey.get(predecessorKey)
            : null
          if (predecessor) {
            const dependencyId = generateId('schedule_dependency')
            await tx.execute(
              `INSERT INTO task_dependencies
                (id, pred_id, succ_id, dependency_type, lag_days)
               VALUES (?, ?, ?, 'FS', ?)`,
              [
                dependencyId,
                predecessor.id,
                successor.id,
                calendarDays(predecessor.plannedFinish, successor.plannedStart),
              ],
            )
            await logCreate(tx, 'task_dependencies', dependencyId)
            if (resolvedPredecessorDisabledByKey.get(row.key)) {
              await softDelete(
                tx,
                'task_dependencies',
                dependencyId,
                SCHEDULE_DEPENDENCY_CONFLICT_OPERATOR,
              )
            }
          }
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
    const plansBySource = new Map<string, typeof current.floorPlans>()
    for (const plan of current.floorPlans) {
      const sourceKey = plan.boqLineId ?? `item:${plan.itemId}`
      plansBySource.set(
        sourceKey,
        [...(plansBySource.get(sourceKey) ?? []), plan],
      )
    }
    for (const plans of plansBySource.values()) {
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
    dependencies: readonly ScheduleDependencyInput[],
    successorId: string,
    predecessorId: string,
    lagDays: number,
    currentDependencyId?: string,
  ) {
    const successor = tasks.find(task => task.id === successorId)
    const predecessor = tasks.find(task => task.id === predecessorId)
    if (!successor || !predecessor || successor.groupId !== predecessor.groupId)
      throw new Error('前置工序与后续工序必须属于同一楼栋分组')
    if (successor.id === predecessor.id)
      throw new Error('工序不能依赖自身')
    if (predecessor.plannedStart > successor.plannedStart)
      throw new Error('前置工序的计划开始不得晚于当前工序')
    normalizeDependencyLag(lagDays)
    if (dependencyWouldCycle(dependencies, {
      predecessorId,
      successorId,
      excludeDependencyId: currentDependencyId,
    })) {
      throw new Error('该前后置关系会形成循环依赖')
    }
    return { predecessor, successor }
  }

  async function persistDependency(
    tx: ScheduleDb,
    current: ScheduleDependencyInput | undefined,
    successorId: string,
    predecessorId: string,
    lagDays: number,
  ) {
    const normalizedLag = normalizeDependencyLag(lagDays)
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
    const current = snapshot.value?.dependencies.find(dependency => dependency.succId === successorId)
    const { successor } = validatedDependency(
      tasks,
      snapshot.value?.dependencies ?? [],
      successorId,
      predecessorId,
      lagDays,
      current?.id,
    )
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
    if (draft.dependency) {
      validatedDependency(
        tasks,
        snapshot.value?.dependencies ?? [],
        taskId,
        draft.dependency.predecessorId,
        draft.dependency.lagDays,
        snapshot.value?.dependencies.find(dependency => dependency.succId === taskId)?.id,
      )
    }
    const currentDependency = snapshot.value?.dependencies.find(dependency => dependency.succId === taskId)
    const nextTasks = tasks.map(task => task.id === taskId ? { ...task, ...draft.task } : task)
    const nextDependencies = (snapshot.value?.dependencies ?? []).filter(row => !draft.dependency || row.succId !== taskId)
    if (draft.dependency)
      nextDependencies.push({ id: currentDependency?.id ?? 'new-dependency', predId: draft.dependency.predecessorId, succId: taskId, dependencyType: 'FS', lagDays: draft.dependency.lagDays })
    const expectedDisable = dependencyConflicts(nextTasks, nextDependencies).filter(row => row.predecessorId === taskId || row.successorId === taskId).map(row => row.dependencyId).sort()
    const approvedDisable = [...new Set(draft.disableDependencyIds ?? [])].sort()
    if (JSON.stringify(expectedDisable) !== JSON.stringify(approvedDisable))
      throw new Error('依赖冲突状态已变化，请重新确认本次计划')

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
        for (const id of expectedDisable) {
          let targetId = id
          if (id === 'new-dependency') {
            const [created] = await tx.select<{ id: string }>('SELECT id FROM task_dependencies WHERE succ_id = ? AND deleted_at IS NULL', [taskId])
            targetId = created!.id
          }
          await softDelete(tx, 'task_dependencies', targetId, SCHEDULE_DEPENDENCY_CONFLICT_OPERATOR)
        }
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

  function previewTaskReschedule(
    taskId: string,
    patch: Pick<UpdateScheduleTaskPatch, 'plannedStart' | 'plannedFinish'>,
  ) {
    const currentSnapshot = snapshot.value
    const tasks = currentSnapshot?.groups.flatMap(group => group.tasks) ?? []
    const current = tasks.find(task => task.id === taskId)
    if (!current)
      throw new Error('工序不存在或已删除')
    validatedTaskPatch(current, patch)
    const nextTasks = tasks.map(task => task.id === taskId
      ? {
          ...task,
          plannedStart: patch.plannedStart ?? task.plannedStart,
          plannedFinish: patch.plannedFinish ?? task.plannedFinish,
        }
      : task)
    const dependencies = currentSnapshot?.dependencies ?? []
    const conflicts = dependencyConflicts(nextTasks, dependencies)
      .filter((conflict) => {
        const dependency = dependencies.find(row => row.id === conflict.dependencyId)
        return dependency?.predId === taskId || dependency?.succId === taskId
      })
    return { conflicts }
  }

  async function rescheduleTask(
    taskId: string,
    patch: Pick<UpdateScheduleTaskPatch, 'plannedStart' | 'plannedFinish'>,
    dependencyIdsToDisable: readonly string[],
    today = activeToday,
  ) {
    const current = snapshot.value?.groups.flatMap(group => group.tasks).find(task => task.id === taskId)
    if (!current)
      throw new Error('工序不存在或已删除')
    const preview = previewTaskReschedule(taskId, patch)
    const expectedIds = [...new Set(preview.conflicts.map(conflict => conflict.dependencyId))].sort()
    const approvedIds = [...new Set(dependencyIdsToDisable)].sort()
    if (expectedIds.length !== approvedIds.length || expectedIds.some((id, index) => id !== approvedIds[index]))
      throw new Error('依赖冲突状态已变化，请重新确认本次调期')

    saving.value = true
    try {
      const result = await withTransaction(async (tx) => {
        const taskLogId = await persistTaskPatch(tx, current, patch)
        const disabledDependencyLogIds: string[] = []
        for (const dependencyId of expectedIds) {
          const logId = await softDelete(
            tx,
            'task_dependencies',
            dependencyId,
            SCHEDULE_DEPENDENCY_CONFLICT_OPERATOR,
          )
          if (logId)
            disabledDependencyLogIds.push(logId)
        }
        return { taskLogId, disabledDependencyLogIds }
      })
      await loadProject(current.projectId, today)
      return result
    }
    finally {
      saving.value = false
    }
  }

  async function removeDependency(dependencyId: string, today = activeToday) {
    const current = snapshot.value?.dependencies.find(dependency => dependency.id === dependencyId)
    if (!current)
      return null
    const successor = snapshot.value?.groups
      .flatMap(group => group.tasks)
      .find(task => task.id === current.succId)
    const logId = await softDelete(
      db,
      'task_dependencies',
      dependencyId,
      SCHEDULE_DEPENDENCY_MANUAL_REMOVE_OPERATOR,
    )
    if (successor)
      await loadProject(successor.projectId, today)
    return logId
  }

  async function restoreDependency(dependencyId: string, today = activeToday) {
    const currentSnapshot = snapshot.value
    const dependency = currentSnapshot?.disabledDependencies.find(row => row.id === dependencyId)
    const tasks = currentSnapshot?.groups.flatMap(group => group.tasks) ?? []
    if (!dependency)
      throw new Error('已禁用的前后置关系不存在')
    if (currentSnapshot?.dependencies.some(row => row.succId === dependency.succId))
      throw new Error('当前后续工序已有其他前置关系，不能恢复为多前置')
    const { predecessor, successor } = validatedDependency(
      tasks,
      currentSnapshot?.dependencies ?? [],
      dependency.succId,
      dependency.predId,
      dependency.lagDays,
    )
    const preview = dependencyConflictPreview({
      predecessorFinish: predecessor.plannedFinish,
      successorStart: successor.plannedStart,
      lagDays: dependency.lagDays,
    })
    if (preview.hasConflict)
      throw new Error(`计划日期仍冲突：后续工序至少应从 ${preview.earliestStart} 开始`)

    saving.value = true
    try {
      const logId = await restoreRecord(
        db,
        'task_dependencies',
        dependencyId,
        SCHEDULE_DEPENDENCY_RESTORE_OPERATOR,
      )
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
    const template = group
      ? (await loadScheduleProcessLibraryTasks(db, group.processLibraryId))
          .find(candidate => candidate.key === draft.templateKey)
      : undefined
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
      await validateEffectiveStageMapping(tx, stage, [...itemByCode.values()])
      const boqLinesByItem = await loadBoqLinesByItem(
        tx,
        group.projectId,
        group.contractId,
        [...itemByCode.values()],
      )
      const floors = await loadFloorsByBuildings(tx, group.buildingIds)
      if (group.scopeBasis === 'contract') {
        const [contract] = await tx.select<{ id: string }>(selectVisibleSql('contracts', 'AND id = ? AND project_id = ? AND kind = \'施工\''), [group.contractId, group.projectId])
        const coverage = await loadScheduleBuildingCoverage(tx, group.projectId, group.contractId)
        if (!contract || group.buildingIds.some(id => !coverage.some(row => row.id === id && row.inContract)))
          throw new Error('分组的当前施工合同或逐栋显式清单范围已失效')
        validateContractFloorCoverage(group.buildingIds.map((id, index) => ({ id, name: group.buildingNames[index] ?? id })), [template], itemByCode, boqLinesByItem, floors)
      }
      const provisionalSources = group.scopeBasis === 'provisional'
        ? await loadProvisionalFloorSources(tx, group.buildingIds, [...itemByCode.values()])
        : []
      const provisionalSourcesByItem = new Map<string, ProvisionalFloorSourceRow[]>()
      for (const source of provisionalSources) {
        provisionalSourcesByItem.set(
          source.item_id,
          [...(provisionalSourcesByItem.get(source.item_id) ?? []), source],
        )
      }
      if (group.scopeBasis === 'provisional' && template.itemCodes.length) {
        for (const [index, buildingId] of group.buildingIds.entries()) {
          const hasQuantity = template.itemCodes.some(code =>
            (provisionalSourcesByItem.get(itemByCode.get(code)!) ?? [])
              .some(source => source.building_id === buildingId),
          )
          if (!hasQuantity) {
            const buildingName = group.buildingNames[index] ?? buildingId
            throw new Error(
              `「${buildingName}」缺少「${template.name}」对应分项的有效暂估量`,
            )
          }
        }
      }
      const provisionalFloorPlans = group.scopeBasis === 'provisional'
        ? template.itemCodes.flatMap((itemCode, itemIndex) => {
            const itemId = itemByCode.get(itemCode)!
            const sources = provisionalSourcesByItem.get(itemId) ?? []
            return sources.map((source, floorIndex) => ({
              floorId: source.floor_id,
              itemId,
              provisionalQty: source.missing_count ? null : source.provisional_qty,
              quantitySnapshot: { unit: source.quantity_unit, ...quantityMeasureTotal(source.provisional_qty, source.source_count, source.missing_count, source.quantity_unit), sources: JSON.parse(source.sources_json) },
              unitCount: Number(source.unit_count) || 0,
              sortOrder: (itemIndex + 1) * 1000 + (floorIndex + 1) * 10,
              ...floorPlanWindow(
                draft.plannedStart,
                plannedFinish,
                floorIndex,
                sources.length,
              ),
            }))
          })
        : []
      const lastTask = [...group.tasks].sort((left, right) => left.sortOrder - right.sortOrder).at(-1)
      const sortOrder = (lastTask?.sortOrder ?? 0) + 10
      await tx.execute(
        `INSERT INTO schedule_tasks
          (id, project_id, group_id, name, trade, color, duration_days,
           planned_start, planned_finish, has_qty, manual_progress, stage_id, sort_order,
           source_library_task_id, source_library_version, template_snapshot_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          stage && stage.completion_mode !== 'manual' ? 1 : 0,
          stage && stage.completion_mode !== 'manual' ? null : 0,
          stage?.id ?? null,
          sortOrder,
          template.id,
          template.libraryVersion,
          JSON.stringify({
            libraryId: template.libraryId,
            libraryName: group.processLibraryName,
            libraryVersion: template.libraryVersion,
            libraryTaskId: template.id,
            key: template.key,
            name: template.name,
            trade: template.trade,
            color: template.color,
            durationDays: template.durationDays,
            stageCode: template.stageCode ?? '',
            stageId: stage?.id ?? null,
            itemIds: [...itemByCode.values()],
            itemCodes: template.itemCodes,
            provisionalFloorPlans,
          }),
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
              itemId,
              boqLine.id,
              lineFloors,
              draft.plannedStart,
              plannedFinish,
            )
          }
        }
        for (const plan of provisionalFloorPlans.filter(candidate => candidate.itemId === itemId)) {
          const planId = generateId('schedule_floor_plan')
          await tx.execute(
            `INSERT INTO schedule_task_floor_plans
              (id, task_id, floor_id, item_id, boq_line_id, source_basis,
               provisional_qty, planned_start, planned_finish, sort_order)
             VALUES (?, ?, ?, ?, NULL, 'provisional', ?, ?, ?, ?)`,
            [
              planId,
              taskId,
              plan.floorId,
              itemId,
              plan.provisionalQty,
              plan.plannedStart,
              plan.plannedFinish,
              plan.sortOrder,
            ],
          )
          await logCreate(tx, 'schedule_task_floor_plans', planId)
          if ((await tx.select('SELECT name FROM sqlite_master WHERE type = \'table\' AND name = \'schedule_floor_quantity_snapshots\'')).length)
            await tx.execute('INSERT INTO schedule_floor_quantity_snapshots (id, project_id, snapshot_json, legacy_missing) VALUES (?, ?, ?, 0)', [planId, group.projectId, JSON.stringify(plan.quantitySnapshot)])
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
    expandedGroupIdsByProject: readonly(expandedGroupIdsByProject),
    catalog: readonly(catalog),
    buildings: readonly(buildings),
    buildingCoverage: readonly(buildingCoverage),
    contracts: readonly(contracts),
    processLibraries: readonly(processLibraries),
    processTasks: readonly(processTasks),
    processTasksLibraryId: readonly(processTasksLibraryId),
    snapshot: readonly(snapshot),
    loading: readonly(loading),
    saving: readonly(saving),
    error: readonly(error),
    setExpandedGroupIds,
    loadCatalog,
    loadBuildings,
    loadContracts,
    previewProvisionalScope,
    loadProcessLibraries,
    loadProcessLibraryTasks,
    previewContractBinding,
    bindContract,
    loadProject,
    createGroup,
    updateTask,
    updateFloorPlans,
    updateDependency,
    saveTaskPlan,
    previewTaskReschedule,
    rescheduleTask,
    removeDependency,
    restoreDependency,
    setBaseline,
    addTask,
    removeTask,
    undo,
  }
}
