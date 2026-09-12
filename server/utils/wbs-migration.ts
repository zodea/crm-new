import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type { WbsMigrationGraph, WbsMigrationTable } from '../../app/lib/migration/wbs-source'
import type { QuantityMigrationRow } from '../../app/lib/quantity/migration-graph'
import type { ImportedQuantityProject } from './quantity-migration'
import { createHash } from 'node:crypto'
import { wbsMigrationInvalid as invalid, parseWbsMigrationGraph, parseWbsSnapshot, WBS_MIGRATION_COLUMNS, WBS_MIGRATION_TABLES } from '../../app/lib/migration/wbs-source'
import { quantityProblem } from '../../app/lib/quantity/central-contract'
import { prepareProcessLibraryMigration } from './process-library-migration'
import { planQuantityMigration } from './quantity-migration'

export interface ImportedWbsProject {
  entityId: string
  projectId: string
  batchId: string
  fingerprint: string
  identities: { table: WbsMigrationTable, legacyId: string, id: string }[]
  /** 候选验证后冻结的原合同关系；恢复不得靠可变日志显示字段推测日常绑定。 */
  bindings: { groupId: string, contractId: string | null, scopeBasis: string | null, boundAt: string | null }[]
}
type IdMaps = Record<string, Map<string, string>>
function resolve(maps: IdMaps, table: string, value: unknown): string | null {
  if (value === null)
    return null
  const result = typeof value === 'string' ? maps[table]?.get(value) : undefined
  if (!result)
    invalid(`${table}缺少显式旧身份 ${String(value)}，不能按名称或本地同 ID 推断`)
  return result
}
const fields: Record<string, string> = {
  project_id: 'projects',
  group_id: 'schedule_groups',
  parent_id: 'schedule_tasks',
  task_id: 'schedule_tasks',
  pred_id: 'schedule_tasks',
  succ_id: 'schedule_tasks',
  building_id: 'buildings',
  floor_id: 'floors',
  item_id: 'items',
  stage_id: 'construction_stages',
  contract_id: 'contracts',
  boq_line_id: 'boq_lines',
  process_library_id: 'schedule_process_libraries',
  source_library_task_id: 'schedule_process_library_tasks',
}
const snapshotFields: Record<string, string> = {
  libraryId: 'schedule_process_libraries',
  libraryTaskId: 'schedule_process_library_tasks',
  projectId: 'projects',
  contractId: 'contracts',
  buildingId: 'buildings',
  floorId: 'floors',
  itemId: 'items',
  stageId: 'construction_stages',
  unitId: 'units',
  houseId: 'units',
  templateId: 'house_type_templates',
  roomId: 'rooms',
  boqLineId: 'boq_lines',
}
function mappedTemplate(value: unknown, maps: IdMaps): string | null {
  if (value === null)
    return null
  const input = parseWbsSnapshot(value, '工序冻结快照')
  const result = { ...input }
  for (const [key, table] of Object.entries(snapshotFields)) {
    if (Object.hasOwn(result, key))
      result[key] = resolve(maps, table, result[key])
  }
  for (const [key, table] of Object.entries({ buildingIds: 'buildings', itemIds: 'items', unitIds: 'units', houseIds: 'units', stageIds: 'construction_stages' })) {
    if (Object.hasOwn(result, key)) {
      if (!Array.isArray(result[key]))
        invalid(`冻结快照 ${key}必须为身份数组`)
      result[key] = (result[key] as unknown[]).map(value => resolve(maps, table, value))
    }
  }
  if (Object.hasOwn(input, 'provisionalFloorPlans')) {
    if (!Array.isArray(input.provisionalFloorPlans))
      invalid('冻结暂估楼层列表无效')
    result.provisionalFloorPlans = input.provisionalFloorPlans.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry))
        invalid('冻结暂估楼层必须为明确对象')
      const mapped = { ...entry } as Record<string, unknown>
      for (const [key, table] of Object.entries(snapshotFields)) {
        if (Object.hasOwn(mapped, key))
          mapped[key] = resolve(maps, table, mapped[key])
      }
      return mapped
    })
  }
  return JSON.stringify(result)
}
function mappedRow(table: WbsMigrationTable, input: QuantityMigrationRow, maps: IdMaps): QuantityMigrationRow {
  const result = { ...input }
  if (Object.hasOwn(result, 'id'))
    result.id = resolve(maps, table, result.id)
  for (const [field, target] of Object.entries(fields)) {
    if (Object.hasOwn(result, field))
      result[field] = resolve(maps, target, result[field])
  }
  if (Object.hasOwn(result, 'template_snapshot_json'))
    result.template_snapshot_json = mappedTemplate(result.template_snapshot_json, maps)
  return result
}

/** 候选纯计划；即使工程量批次已经确认，也从原图显式重建同一身份映射，不读取持锁 service。 */
export function planWbsMigration(snapshot: CoreMigrationSnapshotDTO, current: ReadonlyMap<string, ImportedWbsProject>) {
  const batchId = snapshot.authority === 'central' ? snapshot.activeBatchId : null
  const entities = batchId ? snapshot.entities.filter(row => row.entityType === 'wbs_projects') : []
  const incomingIds = new Set(entities.map(row => row.id))
  if (incomingIds.size !== entities.length)
    invalid('项目图身份重复')
  const removed = [...current.values()].filter(row => row.batchId !== batchId || !incomingIds.has(row.entityId))
  const imports = new Map([...current].filter(([, row]) => !removed.includes(row)))
  const quantity = entities.length ? planQuantityMigration(snapshot, new Map()) : null
  const libraryVersions = entities.length ? prepareProcessLibraryMigration([], snapshot).versions : []
  const incoming: { record: ImportedWbsProject, graph: WbsMigrationGraph, legacyGraphJson: string }[] = []
  const seenProjects = new Set<string>()
  for (const entity of entities) {
    const project = snapshot.entities.find(row => row.entityType === 'projects' && row.id === entity.references.projectId)
    if (!batchId || entity.batchId !== batchId || !project || project.legacyId !== entity.legacyId || seenProjects.has(project.id))
      invalid('项目图批次或项目身份缺失、重复')
    seenProjects.add(project.id)
    const source = parseWbsMigrationGraph(parseWbsSnapshot(entity.attributes.graphJson, '完整图'), entity.legacyId)
    const fingerprint = createHash('sha256').update(JSON.stringify([source, project.id])).digest('hex')
    const existing = imports.get(entity.id)
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        invalid('同批次 WBS 来源变化，不能覆盖日常更正')
      continue
    }
    const quantitySource = quantity?.incoming.find(row => row.project.id === project.id)
    const maps: IdMaps = { projects: new Map([[entity.legacyId, project.id]]), contracts: new Map(), boq_lines: new Map(), schedule_process_libraries: new Map(), schedule_process_library_tasks: new Map() }
    for (const identity of quantitySource?.identities ?? []) {
      maps[identity.table] ??= new Map()
      maps[identity.table]!.set(identity.legacyId, identity.id)
    }
    for (const contract of snapshot.entities.filter(row => row.entityType === 'construction_contracts' && row.references.projectId === project.id))
      maps.contracts!.set(contract.legacyId, contract.id)
    for (const boq of quantitySource?.graph.boqReferences ?? [])
      maps.boq_lines!.set(boq.id, boq.id)
    for (const library of libraryVersions) {
      maps.schedule_process_libraries!.set(library.legacyId!, library.id)
      for (const task of library.tasks)
        maps.schedule_process_library_tasks!.set(task.legacyId!, task.id)
    }
    const identities: ImportedWbsProject['identities'] = []
    for (const table of WBS_MIGRATION_TABLES) {
      maps[table] = new Map(source.tables[table].map((row) => {
        const legacyId = String(row.id)
        const id = `${entity.id}:${table}:${encodeURIComponent(legacyId)}`
        identities.push({ table, legacyId, id })
        return [legacyId, id]
      }))
    }
    const tables = {} as WbsMigrationGraph['tables']
    for (const table of WBS_MIGRATION_TABLES) {
      tables[table] = source.tables[table].map((row) => {
        const result = mappedRow(table, row, maps)
        if (table === 'operation_logs') {
          const target = String(row.table_name) as WbsMigrationTable
          result.record_id = resolve(maps, target, row.record_id)
          for (const field of ['before_data', 'after_data']) {
            if (row[field] !== null)
              result[field] = JSON.stringify(mappedRow(target, parseWbsSnapshot(row[field], '审计') as QuantityMigrationRow, maps))
          }
        }
        return result
      })
    }
    const graph = parseWbsMigrationGraph({ ...source, projectId: project.id, tables })
    const quantityTables = quantitySource?.graph.tables
    function assertBoqContract(taskId: unknown, boqId: unknown) {
      if (boqId === null)
        return
      const task = graph.tables.schedule_tasks.find(row => row.id === taskId)!
      const group = graph.tables.schedule_groups.find(row => row.id === task.group_id)
      const boq = quantitySource?.graph.boqReferences.find(row => row.id === boqId)
      if (!boq || (group?.contract_id !== null && group?.contract_id !== undefined && group.contract_id !== boq.contractId))
        invalid('任务或楼层清单不属于分组明确施工合同')
    }
    for (const group of graph.tables.schedule_groups) {
      if (group.process_library_id !== null) {
        const library = libraryVersions.find(row => row.id === group.process_library_id)
        if (!library || library.version !== group.process_library_version_snapshot)
          invalid('分组冻结版本与明确库身份不一致')
      }
    }
    for (const task of graph.tables.schedule_tasks) {
      const frozen = task.template_snapshot_json === null ? null : parseWbsSnapshot(task.template_snapshot_json, '工序冻结快照')
      if (task.source_library_task_id !== null) {
        const library = libraryVersions.find(row => row.tasks.some(item => item.id === task.source_library_task_id))
        if (!library || task.source_library_version !== library.version)
          invalid('任务冻结工序版本错配')
        const group = graph.tables.schedule_groups.find(row => row.id === task.group_id)
        if (group && group.process_library_id !== library.id)
          invalid('任务所用工序不属于分组明确版本')
        if (frozen && ((Object.hasOwn(frozen, 'libraryId') && frozen.libraryId !== library.id)
          || (Object.hasOwn(frozen, 'libraryTaskId') && frozen.libraryTaskId !== task.source_library_task_id)
          || (Object.hasOwn(frozen, 'libraryVersion') && frozen.libraryVersion !== task.source_library_version))) {
          invalid('工序冻结快照与任务明确库版本身份不一致')
        }
      }
      if (frozen && Object.hasOwn(frozen, 'stageId') && frozen.stageId !== task.stage_id)
        invalid('工序冻结阶段与任务当前来源身份不一致')
    }
    for (const floorPlan of graph.tables.schedule_task_floor_plans) {
      assertBoqContract(floorPlan.task_id, floorPlan.boq_line_id)
      const task = graph.tables.schedule_tasks.find(row => row.id === floorPlan.task_id)!
      const floor = quantityTables?.floors.find(row => row.id === floorPlan.floor_id)
      if (!floor || (task.group_id !== null && !graph.tables.schedule_group_buildings.some(row => row.group_id === task.group_id && row.building_id === floor.building_id)))
        invalid('楼层计划不属于分组显式楼栋范围')
      if (!graph.tables.task_item_map.some(row => row.task_id === task.id && row.item_id === floorPlan.item_id))
        invalid('楼层计划分项不属于任务映射')
    }
    for (const mapping of graph.tables.task_item_map)
      assertBoqContract(mapping.task_id, mapping.boq_line_id)
    const bindings = graph.tables.schedule_groups.map(row => ({ groupId: String(row.id), contractId: row.contract_id === null ? null : String(row.contract_id), scopeBasis: row.scope_basis === null ? null : String(row.scope_basis), boundAt: row.contract_bound_at === null ? null : String(row.contract_bound_at) }))
    incoming.push({ record: { entityId: entity.id, projectId: project.id, batchId, fingerprint, identities, bindings }, graph, legacyGraphJson: JSON.stringify(source) })
  }
  return { incoming, removed, imports, snapshot, affectedProjects: [...new Set([...incoming.map(row => row.record.projectId), ...removed.map(row => row.projectId)])] }
}

/** 删除迁入祖先前，独立 WBS（包括软删除边界和审计）仍需保有全部可解释引用。 */
export async function removeWbsMigration(db: TransactionDb, plan: ReturnType<typeof planWbsMigration>, removedQuantity: readonly ImportedQuantityProject[], removedLibraryIds: ReadonlySet<string> = new Set()) {
  // 在删除组及审计前与可信迁入基准比较。即使日志/回执缺损，也不丢掉已经改变的合同关系。
  for (const imported of plan.removed) {
    for (const binding of imported.bindings) {
      const [current] = await db.select<{ contract_id: string | null, scope_basis: string | null, contract_bound_at: string | null }>('SELECT contract_id, scope_basis, contract_bound_at FROM schedule_groups WHERE id = ?', [binding.groupId])
      if (!current || current.contract_id !== binding.contractId || current.scope_basis !== binding.scopeBasis || current.contract_bound_at !== binding.boundAt)
        throw quantityProblem('conflict', '迁入后分组已有新的施工合同绑定依据，恢复会删除其关系及审计；已保留全部当前事实')
    }
  }
  const removedProjectIds = new Set(removedQuantity.map(row => row.projectId))
  if (plan.snapshot.authority !== 'central') {
    for (const imported of plan.removed)
      removedProjectIds.add(imported.projectId)
  }
  const owned = new Set(plan.removed.flatMap(row => row.identities.map(identity => JSON.stringify([identity.table, identity.id]))))
  const owners = new Map<string, string>()
  for (const table of WBS_MIGRATION_TABLES.filter(table => table !== 'operation_logs')) {
    const rows = await db.select<QuantityMigrationRow>(`SELECT ${WBS_MIGRATION_COLUMNS[table].join(', ')} FROM ${table}`)
    for (const row of rows) {
      const projectId = table === 'schedule_groups' || table === 'schedule_tasks'
        ? String(row.project_id)
        : table === 'schedule_group_buildings'
          ? owners.get(String(row.group_id))
          : table === 'task_dependencies' ? owners.get(String(row.pred_id)) : owners.get(String(row.task_id))
      if (!projectId)
        invalid('当前 WBS 缺少可解释项目祖先，不能恢复')
      owners.set(String(row.id), projectId)
      if (!owned.has(JSON.stringify([table, row.id]))
        && ((table === 'schedule_groups' && removedLibraryIds.has(String(row.process_library_id)))
          || (table === 'schedule_tasks' && row.template_snapshot_json !== null && removedLibraryIds.has(String(parseWbsSnapshot(row.template_snapshot_json, '当前任务快照').libraryId))))) {
        throw quantityProblem('conflict', '独立中央 WBS 仍引用待撤工序库版本；已阻止恢复并保留全部当前事实')
      }
      if (removedProjectIds.has(projectId) && !owned.has(JSON.stringify([table, row.id])))
        throw quantityProblem('conflict', '迁入项目已有独立中央 WBS 仍引用本批项目、区域或库版本；已阻止恢复并保留全部当前事实')
    }
  }
  for (const previous of plan.removed) {
    for (const identity of previous.identities.filter(row => row.table !== 'operation_logs'))
      await db.execute('DELETE FROM operation_logs WHERE table_name = ? AND record_id = ?', [identity.table, identity.id])
    for (const table of [...WBS_MIGRATION_TABLES].reverse()) {
      for (const identity of previous.identities.filter(row => row.table === table))
        await db.execute(`DELETE FROM ${table} WHERE id = ?`, [identity.id])
    }
  }
}
export async function applyWbsMigration(db: TransactionDb, plan: ReturnType<typeof planWbsMigration>) {
  for (const next of plan.incoming) {
    const project = plan.snapshot.entities.find(row => row.entityType === 'projects' && row.id === next.record.projectId)!
    await db.execute('INSERT INTO projects (id, name, deleted_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING', [project.id, project.name, project.deletedAt])
    for (const contract of plan.snapshot.entities.filter(row => row.entityType === 'construction_contracts' && row.references.projectId === project.id)) {
      const [existing] = await db.select<{ project_id: string }>('SELECT project_id FROM quantity_contract_references WHERE id = ?', [contract.id])
      if (existing && existing.project_id !== project.id)
        invalid('施工合同中央身份属于其他项目')
      await db.execute('INSERT INTO quantity_contract_references (id, project_id) VALUES (?, ?) ON CONFLICT(id) DO NOTHING', [contract.id, project.id])
    }
    for (const table of WBS_MIGRATION_TABLES) {
      const columns = WBS_MIGRATION_COLUMNS[table]
      for (const row of next.graph.tables[table]) {
        await db.execute(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, columns.map(column => row[column]))
        const [actual] = await db.select<QuantityMigrationRow>(`SELECT ${columns.join(', ')} FROM ${table} WHERE id = ?`, [row.id])
        if (!actual || columns.some(column => row[column] !== actual[column]))
          invalid(`${table}写后字段、历史或关系对账不一致`)
      }
    }
    for (const floorPlan of next.graph.tables.schedule_task_floor_plans.filter(row => row.source_basis === 'provisional')) {
      const task = next.graph.tables.schedule_tasks.find(row => row.id === floorPlan.task_id)!
      await db.execute('INSERT INTO schedule_floor_quantity_snapshots (id, project_id, snapshot_json, legacy_missing) VALUES (?, ?, ?, 1)', [floorPlan.id, next.record.projectId, JSON.stringify({ value: floorPlan.provisional_qty, unit: null, completeness: 'legacy-detail-unavailable', sourceSnapshot: task.template_snapshot_json === null ? null : parseWbsSnapshot(task.template_snapshot_json, '原暂估快照') })])
    }
    await db.execute('INSERT INTO schedule_migration_evidence (entity_id, project_id, batch_id, source_graph_json, provisional_detail_status) VALUES (?, ?, ?, ?, ?)', [next.record.entityId, next.record.projectId, next.record.batchId, next.legacyGraphJson, next.graph.tables.schedule_task_floor_plans.some(row => row.source_basis === 'provisional') ? 'legacy-detail-unavailable' : 'not-applicable'])
    plan.imports.set(next.record.entityId, next.record)
  }
  for (const previous of plan.removed) {
    await db.execute('DELETE FROM schedule_migration_evidence WHERE entity_id = ?', [previous.entityId])
    for (const identity of previous.identities.filter(row => row.table === 'schedule_task_floor_plans'))
      await db.execute('DELETE FROM schedule_floor_quantity_snapshots WHERE id = ?', [identity.id])
  }
}
