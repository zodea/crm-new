import type { SoftDb } from '~/lib/db/soft-delete'
import {
  hiddenCtesFor,
  selectVisibleSql,
  visibleCond,
  withUpdateLog,
} from '~/lib/db/soft-delete'

export const SCHEDULE_CONTRACT_BIND_OPERATOR = 'schedule:bind-contract'

interface GroupRow {
  id: string
  project_id: string
  contract_id: string | null
  scope_basis: 'contract' | 'provisional' | null
  name: string
}

interface ContractRow {
  id: string
  project_id: string
  no: string
  name: string
}

interface BuildingCoverageRow {
  id: string
  code: string
  name: string
  line_count: number
}

interface ItemRow {
  id: string
  code: string
  name: string
  unit: string | null
}

interface QuantityRow {
  item_id: string
  qty: number
  line_count?: number
}

export interface ScheduleContractBindingBuilding {
  id: string
  code: string
  name: string
  covered: boolean
  contractLineCount: number
}

export interface ScheduleContractBindingItem {
  id: string
  code: string
  name: string
  unit: string
  mapped: boolean
  provisionalQty: number
  contractQty: number
  differenceQty: number
}

export interface ScheduleContractBindingPreview {
  groupId: string
  groupName: string
  projectId: string
  contractId: string
  contractNo: string
  contractName: string
  buildings: readonly ScheduleContractBindingBuilding[]
  extraContractBuildings: readonly ScheduleContractBindingBuilding[]
  items: readonly ScheduleContractBindingItem[]
  blockers: readonly string[]
  warnings: readonly string[]
  canBind: boolean
}

function numberValue(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ')
}

async function loadGroup(db: SoftDb, groupId: string): Promise<GroupRow> {
  const [group] = await db.select<GroupRow>(
    selectVisibleSql('schedule_groups', 'AND id = ?'),
    [groupId],
  )
  if (!group)
    throw new Error('楼栋分组不存在或已删除')
  if ((group.scope_basis ?? (group.contract_id ? 'contract' : 'provisional')) !== 'provisional')
    throw new Error('只有待绑定合同的内部暂估分组可以执行此操作')
  return group
}

async function loadContract(
  db: SoftDb,
  projectId: string,
  contractId: string,
): Promise<ContractRow> {
  const [contract] = await db.select<ContractRow>(
    selectVisibleSql(
      'contracts',
      `AND id = ? AND project_id = ? AND kind = '施工'`,
    ),
    [contractId, projectId],
  )
  if (!contract)
    throw new Error('施工合同无效、已删除或不属于当前项目')
  return contract
}

async function loadBuildingCoverage(
  db: SoftDb,
  groupId: string,
  projectId: string,
  contractId: string,
) {
  const rows = await db.select<BuildingCoverageRow>(
    `${hiddenCtesFor('schedule_group_buildings', 'buildings', 'boq_lines')}
     SELECT building.id,
            building.code,
            building.name,
            (
              SELECT COUNT(*)
              FROM boq_lines contract_line
              WHERE ${visibleCond('boq_lines', 'contract_line')}
                AND contract_line.project_id = ?
                AND contract_line.contract_id = ?
                AND trim(contract_line.building) <> ''
                AND (
                  contract_line.building = building.code
                  OR contract_line.building = building.name
                )
            ) AS line_count
     FROM schedule_group_buildings group_building
     JOIN buildings building ON building.id = group_building.building_id
     WHERE ${visibleCond('schedule_group_buildings', 'group_building')}
       AND ${visibleCond('buildings', 'building')}
       AND group_building.group_id = ?
     ORDER BY group_building.sort_order, building.sort_order, building.code, building.id`,
    [projectId, contractId, groupId],
  )
  return rows.map<ScheduleContractBindingBuilding>(row => ({
    id: row.id,
    code: row.code,
    name: row.name,
    covered: numberValue(row.line_count) > 0,
    contractLineCount: numberValue(row.line_count),
  }))
}

async function loadExtraContractBuildings(
  db: SoftDb,
  groupId: string,
  projectId: string,
  contractId: string,
) {
  const rows = await db.select<BuildingCoverageRow>(
    `${hiddenCtesFor('buildings', 'schedule_group_buildings', 'boq_lines')}
     SELECT 'contract-building:' || trim(contract_line.building) AS id,
            trim(contract_line.building) AS code,
            trim(contract_line.building) AS name,
            COUNT(contract_line.id) AS line_count
     FROM boq_lines contract_line
     WHERE ${visibleCond('boq_lines', 'contract_line')}
       AND contract_line.contract_id = ?
       AND contract_line.project_id = ?
       AND trim(contract_line.building) <> ''
       AND NOT EXISTS (
         SELECT 1
         FROM schedule_group_buildings group_building
         JOIN buildings building ON building.id = group_building.building_id
         WHERE ${visibleCond('schedule_group_buildings', 'group_building')}
           AND ${visibleCond('buildings', 'building')}
           AND group_building.group_id = ?
           AND (
             trim(contract_line.building) = building.code
             OR trim(contract_line.building) = building.name
           )
       )
     GROUP BY trim(contract_line.building)
     ORDER BY trim(contract_line.building)`,
    [contractId, projectId, groupId],
  )
  return rows.map<ScheduleContractBindingBuilding>(row => ({
    id: row.id,
    code: row.code,
    name: row.name,
    covered: true,
    contractLineCount: numberValue(row.line_count),
  }))
}

async function loadMappedItems(db: SoftDb, groupId: string): Promise<ItemRow[]> {
  return db.select<ItemRow>(
    `${hiddenCtesFor('schedule_tasks', 'task_item_map', 'items')}
     SELECT DISTINCT item.id, item.code, item.name, item.unit
     FROM schedule_tasks task
     JOIN task_item_map task_item ON task_item.task_id = task.id
     JOIN items item ON item.id = task_item.item_id
     WHERE ${visibleCond('schedule_tasks', 'task')}
       AND ${visibleCond('task_item_map', 'task_item')}
       AND ${visibleCond('items', 'item')}
       AND task.group_id = ?
     ORDER BY item.sort_order, item.code, item.id`,
    [groupId],
  )
}

async function loadProvisionalQuantities(
  db: SoftDb,
  groupId: string,
  itemIds: readonly string[],
): Promise<Map<string, number>> {
  if (!itemIds.length)
    return new Map()
  const rows = await db.select<QuantityRow>(
    `${hiddenCtesFor(
      'schedule_group_buildings',
      'floors',
      'units',
      'rooms',
      'house_type_template_items',
    )}
     SELECT template_item.item_id,
            SUM(COALESCE(template_item.provisional_qty, 0)) AS qty
     FROM schedule_group_buildings group_building
     JOIN floors floor_row ON floor_row.building_id = group_building.building_id
     JOIN units unit_row ON unit_row.floor_id = floor_row.id
     JOIN rooms room_row ON room_row.template_id = unit_row.house_type_template_id
     JOIN house_type_template_items template_item ON template_item.room_id = room_row.id
     WHERE ${visibleCond('schedule_group_buildings', 'group_building')}
       AND ${visibleCond('floors', 'floor_row')}
       AND ${visibleCond('units', 'unit_row')}
       AND ${visibleCond('rooms', 'room_row')}
       AND ${visibleCond('house_type_template_items', 'template_item')}
       AND group_building.group_id = ?
       AND template_item.item_id IN (${placeholders(itemIds)})
     GROUP BY template_item.item_id`,
    [groupId, ...itemIds],
  )
  return new Map(rows.map(row => [row.item_id, numberValue(row.qty)]))
}

async function loadContractQuantities(
  db: SoftDb,
  groupId: string,
  projectId: string,
  contractId: string,
  itemIds: readonly string[],
): Promise<Map<string, { qty: number, lineCount: number }>> {
  if (!itemIds.length)
    return new Map()
  const rows = await db.select<QuantityRow>(
    `${hiddenCtesFor('boq_lines', 'schedule_group_buildings', 'buildings')}
     SELECT contract_line.item_id,
            SUM(COALESCE(contract_line.qty, 0)) AS qty,
            COUNT(contract_line.id) AS line_count
     FROM boq_lines contract_line
     WHERE ${visibleCond('boq_lines', 'contract_line')}
       AND contract_line.project_id = ?
       AND contract_line.contract_id = ?
       AND contract_line.item_id IN (${placeholders(itemIds)})
       AND EXISTS (
         SELECT 1
         FROM schedule_group_buildings group_building
         JOIN buildings building ON building.id = group_building.building_id
         WHERE ${visibleCond('schedule_group_buildings', 'group_building')}
           AND ${visibleCond('buildings', 'building')}
           AND group_building.group_id = ?
           AND trim(contract_line.building) <> ''
           AND (
             contract_line.building = building.code
             OR contract_line.building = building.name
           )
       )
     GROUP BY contract_line.item_id`,
    [projectId, contractId, ...itemIds, groupId],
  )
  return new Map(rows.map(row => [
    row.item_id,
    { qty: numberValue(row.qty), lineCount: numberValue(row.line_count) },
  ]))
}

export async function previewScheduleContractBinding(
  db: SoftDb,
  groupId: string,
  contractId: string,
): Promise<ScheduleContractBindingPreview> {
  const group = await loadGroup(db, groupId)
  const contract = await loadContract(db, group.project_id, contractId)
  const [buildings, extraContractBuildings, mappedItems] = await Promise.all([
    loadBuildingCoverage(db, group.id, group.project_id, contract.id),
    loadExtraContractBuildings(db, group.id, group.project_id, contract.id),
    loadMappedItems(db, group.id),
  ])
  const itemIds = mappedItems.map(item => item.id)
  const [provisionalQtyByItem, contractQtyByItem] = await Promise.all([
    loadProvisionalQuantities(db, group.id, itemIds),
    loadContractQuantities(db, group.id, group.project_id, contract.id, itemIds),
  ])
  const items = mappedItems.map<ScheduleContractBindingItem>((item) => {
    const provisionalQty = provisionalQtyByItem.get(item.id) ?? 0
    const contract = contractQtyByItem.get(item.id)
    const contractQty = contract?.qty ?? 0
    return {
      id: item.id,
      code: item.code,
      name: item.name,
      unit: item.unit ?? '',
      mapped: Boolean(contract?.lineCount),
      provisionalQty,
      contractQty,
      differenceQty: contractQty - provisionalQty,
    }
  })
  const blockers = [
    ...(buildings.length ? [] : ['楼栋分组尚未配置任何楼栋']),
    ...buildings
      .filter(building => !building.covered)
      .map(building => `合同清单未明确覆盖楼栋：${building.name}`),
    ...items
      .filter(item => !item.mapped)
      .map(item => `合同清单未映射排程分项：${item.name}`),
  ]
  const warnings = extraContractBuildings.map(
    building => `合同还包含分组外楼栋：${building.name}`,
  )
  return {
    groupId: group.id,
    groupName: group.name,
    projectId: group.project_id,
    contractId: contract.id,
    contractNo: contract.no,
    contractName: contract.name,
    buildings,
    extraContractBuildings,
    items,
    blockers,
    warnings,
    canBind: blockers.length === 0,
  }
}

export async function bindScheduleContract(
  db: SoftDb,
  groupId: string,
  contractId: string,
): Promise<{ logId: string, preview: ScheduleContractBindingPreview }> {
  const preview = await previewScheduleContractBinding(db, groupId, contractId)
  if (!preview.canBind)
    throw new Error(preview.blockers.join('；'))
  const logId = await withUpdateLog(
    db,
    'schedule_groups',
    groupId,
    async () => {
      await db.execute(
        `UPDATE schedule_groups
         SET contract_id = ?,
             scope_basis = 'contract',
             contract_bound_at = datetime('now'),
             updated_at = datetime('now')
         WHERE id = ?
           AND deleted_at IS NULL
           AND COALESCE(scope_basis, CASE WHEN contract_id IS NULL THEN 'provisional' ELSE 'contract' END) = 'provisional'
           AND contract_id IS NULL`,
        [contractId, groupId],
      )
      const [result] = await db.select<{ changed: number }>('SELECT changes() AS changed')
      if (!result?.changed)
        throw new Error('楼栋分组不存在、已删除或绑定状态已变化')
    },
    SCHEDULE_CONTRACT_BIND_OPERATOR,
  )
  if (!logId)
    throw new Error('楼栋分组不存在、已删除或绑定状态已变化')
  return { logId, preview }
}
