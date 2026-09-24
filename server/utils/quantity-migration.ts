import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CoreMigrationServerEntityDTO, CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type { QuantityMigrationGraph, QuantityMigrationTable } from '../../app/lib/quantity/migration-graph'
import type { QuantityMigrationIdentity } from '../../app/lib/quantity/migration-mapping'
import { createHash } from 'node:crypto'
import { quantityProblem } from '../../app/lib/quantity/central-contract'
import { parseQuantityMigrationGraph, QUANTITY_MIGRATION_COLUMNS, QUANTITY_MIGRATION_PROJECT_PARENTS, QUANTITY_MIGRATION_TABLES, quantityMigrationRowId } from '../../app/lib/quantity/migration-graph'
import { mapQuantityMigrationGraph } from '../../app/lib/quantity/migration-mapping'
import { assertQuantityHollowMigrationReferences, insertQuantityHollowMigration, removeQuantityHollowMigration } from './quantity-hollow-migration'

export interface ImportedQuantityProject {
  entityId: string
  projectId: string
  batchId: string
  fingerprint: string
  identities: QuantityMigrationIdentity[]
  previousArchive: string | null
  createdBoqIds: string[]
}

function invalid(message: string): never {
  throw quantityProblem('relationship-mismatch', `工程量迁移：${message}`)
}

function bindings(rows: readonly CoreMigrationServerEntityDTO[], entityType: string) {
  const result = new Map<string, string>()
  for (const row of rows.filter(row => row.entityType === entityType)) {
    if (result.has(row.legacyId))
      invalid(`${entityType}旧身份重复`)
    result.set(row.legacyId, row.id)
  }
  return result
}

export function planQuantityMigration(snapshot: CoreMigrationSnapshotDTO, current: ReadonlyMap<string, ImportedQuantityProject>) {
  const batchId = snapshot.authority === 'central' ? snapshot.activeBatchId : null
  if (snapshot.authority === 'central' && !batchId)
    invalid('中央迁移缺少活动批次')
  const entities = batchId ? snapshot.entities.filter(row => row.entityType === 'quantity_projects') : []
  const ids = new Set(entities.map(row => row.id))
  if (ids.size !== entities.length)
    invalid('工程量逻辑项目身份重复')
  const removed = [...current.values()].filter(row => row.batchId !== batchId || !ids.has(row.entityId))
  const imports = new Map([...current].filter(([, row]) => !removed.includes(row)))
  const incoming: { entity: CoreMigrationServerEntityDTO, project: CoreMigrationServerEntityDTO, source: QuantityMigrationGraph, graph: QuantityMigrationGraph, identities: QuantityMigrationIdentity[], fingerprint: string }[] = []
  const projects = new Set<string>()
  for (const entity of entities) {
    if (entity.batchId !== batchId || !entity.references.projectId || projects.has(entity.references.projectId))
      invalid('工程量批次或项目引用不唯一')
    projects.add(entity.references.projectId)
    const project = snapshot.entities.find(row => row.entityType === 'projects' && row.id === entity.references.projectId)
    if (!project || project.legacyId !== entity.legacyId)
      invalid('无法核对当前项目的显式旧身份')
    let raw: unknown
    try {
      raw = JSON.parse(String(entity.attributes.graphJson))
    }
    catch { invalid('工程量图不是合法JSON') }
    const source = parseQuantityMigrationGraph(raw, entity.legacyId)
    const fingerprint = createHash('sha256').update(JSON.stringify([source, entity.references.projectId])).digest('hex')
    const existing = imports.get(entity.id)
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        invalid('同批次工程量来源内容发生变化')
      continue
    }
    const contracts = snapshot.entities.filter(row => row.entityType === 'construction_contracts' && row.references.projectId === project.id)
    const mapped = mapQuantityMigrationGraph(source, {
      namespace: entity.id,
      projectId: project.id,
      crews: bindings(snapshot.entities, 'crews'),
      workers: bindings(snapshot.entities, 'workers'),
      contracts: bindings(contracts, 'construction_contracts'),
      boqLineIds: new Set(source.boqReferences.map(row => row.id)),
    })
    incoming.push({ entity, project, source, ...mapped, fingerprint })
  }
  return { incoming, removed, imports, references: snapshot.entities, affectedProjects: [...new Set([...removed.map(row => row.projectId), ...incoming.map(row => row.project.id)])] }
}

function idColumn(table: QuantityMigrationTable) {
  return table === 'file_payloads' ? 'file_ref_id' : 'id'
}

async function assertRollbackIndependentRecords(db: TransactionDb, removed: readonly ImportedQuantityProject[]) {
  if (!removed.length)
    return
  const projects = new Set(removed.map(row => row.projectId))
  const owned = new Set(removed.flatMap(row => row.identities.map(identity => JSON.stringify([identity.table, identity.id]))))
  const ancestors = new Map<string, string>()
  for (const [name, [parent, field]] of Object.entries(QUANTITY_MIGRATION_PROJECT_PARENTS)) {
    const table = name as keyof typeof QUANTITY_MIGRATION_PROJECT_PARENTS
    const rows = await db.select<Record<string, string | number | null>>(`SELECT ${QUANTITY_MIGRATION_COLUMNS[table].join(', ')} FROM ${table}`)
    for (const row of rows) {
      if (table === 'file_refs' && row.owner_type !== 'unit_stage_completion')
        continue
      const key = JSON.stringify([table, quantityMigrationRowId(table, row)])
      const projectId = parent === 'projects' ? String(row[field]) : ancestors.get(JSON.stringify([parent, row[field]]))
      if (!projectId)
        invalid(`现有 ${table} 记录缺少可核对的项目祖先`)
      ancestors.set(key, projectId)
      if (projects.has(projectId) && !owned.has(key))
        throw quantityProblem('conflict', `该批次项目已有独立新增的工程量记录（${table}），仍引用迁入祖先；已阻止回滚并保留全部当前事实，请先核对处理这些记录。`)
    }
  }
}

export async function applyQuantityMigration(db: TransactionDb, plan: ReturnType<typeof planQuantityMigration>) {
  const removedEntityIds = plan.removed.map(row => row.entityId)
  await assertQuantityHollowMigrationReferences(db, { entityIds: removedEntityIds, projects: plan.removed.map(row => row.projectId), quantity: plan.removed.flatMap(row => row.identities) })
  await assertRollbackIndependentRecords(db, plan.removed)
  await removeQuantityHollowMigration(db, removedEntityIds)
  // 整户行已由真实来源携带。候选事务内暂停新增模板的便捷触发器，避免造出第二条整户行。
  const [wholeUnitTrigger] = await db.select<{ sql: string }>('SELECT sql FROM sqlite_master WHERE type = \'trigger\' AND name = \'trg_house_type_templates_whole_unit\'')
  if (!wholeUnitTrigger?.sql)
    invalid('缺少已知整户生成触发器，不能保证完整字段导入')
  await db.execute('DROP TRIGGER trg_house_type_templates_whole_unit')
  for (const previous of plan.removed) {
    for (const identity of previous.identities) {
      if (identity.table !== 'operation_logs' && identity.table !== 'file_payloads')
        await db.execute('DELETE FROM operation_logs WHERE table_name = ? AND record_id = ?', [identity.table, identity.id])
    }
    await db.execute('DELETE FROM operation_logs WHERE table_name = \'projects\' AND record_id = ?', [previous.projectId])
    for (const table of [...QUANTITY_MIGRATION_TABLES].reverse()) {
      for (const identity of previous.identities.filter(row => row.table === table))
        await db.execute(`DELETE FROM ${table} WHERE ${idColumn(table)} = ?`, [identity.id])
    }
    for (const id of previous.createdBoqIds)
      await db.execute('DELETE FROM quantity_boq_references WHERE id = ?', [id])
    await db.execute('UPDATE projects SET matrix_archived_at = ? WHERE id = ?', [previous.previousArchive, previous.projectId])
  }
  for (const next of plan.incoming) {
    const [before] = await db.select<{ matrix_archived_at: string | null }>('SELECT matrix_archived_at FROM projects WHERE id = ?', [next.project.id])
    await db.execute('INSERT INTO projects (id, name, matrix_archived_at, deleted_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET matrix_archived_at = excluded.matrix_archived_at', [next.project.id, next.project.name, next.graph.archivedAt, next.project.deletedAt])
    for (const type of ['crews', 'workers'] as const) {
      for (const row of plan.references.filter(row => row.entityType === type))
        await db.execute(`INSERT INTO ${type} (id, name, deleted_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING`, [row.id, row.name, row.deletedAt])
    }
    const createdBoqIds: string[] = []
    for (const row of next.graph.boqReferences) {
      const [existing] = await db.select<{ project_id: string, contract_id: string }>('SELECT project_id, contract_id FROM quantity_boq_references WHERE id = ?', [row.id])
      if (existing && (existing.project_id !== row.projectId || existing.contract_id !== row.contractId))
        invalid('BOQ稳定身份已属于另一项目或合同')
      if (!existing) {
        await db.execute('INSERT INTO quantity_boq_references (id, project_id, contract_id) VALUES (?, ?, ?)', [row.id, row.projectId, row.contractId])
        createdBoqIds.push(row.id)
      }
    }
    for (const table of QUANTITY_MIGRATION_TABLES) {
      const columns = QUANTITY_MIGRATION_COLUMNS[table]
      for (const row of next.graph.tables[table]) {
        await db.execute(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, columns.map(column => row[column]))
        const [actual] = await db.select<Record<string, unknown>>(`SELECT ${columns.join(', ')} FROM ${table} WHERE ${idColumn(table)} = ?`, [quantityMigrationRowId(table, row)])
        if (!actual || columns.some(column => actual[column] !== row[column]))
          invalid(`${table} 写后字段对账不一致`)
      }
    }
    await insertQuantityHollowMigration(db, { entityId: next.entity.id, projectId: next.project.id, batchId: next.entity.batchId, source: next.source, mapped: next.graph })
    plan.imports.set(next.entity.id, { entityId: next.entity.id, projectId: next.project.id, batchId: next.entity.batchId, fingerprint: next.fingerprint, identities: next.identities, previousArchive: before?.matrix_archived_at ?? null, createdBoqIds })
  }
  await db.execute(wholeUnitTrigger.sql)
}
