import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { QuantityHollowMigrationEvidence } from '../../app/lib/quantity/hollow-migration-contract'
import type { QuantityMigrationGraph } from '../../app/lib/quantity/migration-graph'
import { quantityProblem } from '../../app/lib/quantity/central-contract'
import { hollowEqual } from '../../app/lib/quantity/central-hollow-primitives'
import { initializeQuantityHollowSchema, QUANTITY_HOLLOW_COLUMNS, QUANTITY_HOLLOW_TABLES } from '../../app/lib/quantity/central-hollow-schema'
import { hollowRowKey, quantityHollowHash } from '../../app/lib/quantity/hollow-migration-graph'
import { quantityHollowIdentityCollector } from '../../app/lib/quantity/hollow-migration-mapping'
import { proveQuantityHollowMigrationGraph } from '../../app/lib/quantity/hollow-migration-proof'
import { buildQuantityHollowMigrationGraphs, QUANTITY_HOLLOW_EVIDENCE_COLUMNS, QUANTITY_HOLLOW_EVIDENCE_TABLE, readQuantityHollowMigrationEvidence, verifyQuantityHollowMigrationEvidence } from '../../app/lib/quantity/hollow-migration-source'
import { readQuantityHollowTables } from '../../app/lib/quantity/hollow-migration-tables'

export async function initializeQuantityHollowMigrationEvidence(tx: TransactionDb): Promise<void> {
  await initializeQuantityHollowSchema(tx)
  const registered = await tx.select('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'production_participants\'')
  if (registered.length) {
    if (!(await tx.select('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=?', [QUANTITY_HOLLOW_EVIDENCE_TABLE])).length)
      throw quantityProblem('unavailable', '正式空鼓证据表缺少已登记连续升级')
    return
  }
  await tx.execute(`CREATE TABLE IF NOT EXISTS ${QUANTITY_HOLLOW_EVIDENCE_TABLE} (
    entity_id TEXT PRIMARY KEY, project_id TEXT NOT NULL UNIQUE, batch_id TEXT NOT NULL,
    source_package_json TEXT NOT NULL, source_fingerprint TEXT NOT NULL, mapped_package_json TEXT NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) DEFERRABLE INITIALLY DEFERRED)`)
}

export async function insertQuantityHollowMigration(tx: TransactionDb, input: { entityId: string, projectId: string, batchId: string, source: QuantityMigrationGraph, mapped: QuantityMigrationGraph }): Promise<void> {
  if (input.source.version === 1 && input.mapped.version === 1)
    return
  if (input.source.version !== 2 || input.mapped.version !== 2)
    throw quantityProblem('relationship-mismatch', '空鼓迁入来源和目标版本不一致')
  const source = await proveQuantityHollowMigrationGraph(input.source.hollow, input.source.projectId)
  const mapped = await proveQuantityHollowMigrationGraph(input.mapped.hollow, input.projectId)
  if (!hollowEqual(source.graph.origins, mapped.graph.origins))
    throw quantityProblem('relationship-mismatch', '空鼓迁入改变了原件正文')
  await initializeQuantityHollowMigrationEvidence(tx)
  for (const table of QUANTITY_HOLLOW_TABLES) {
    const columns = QUANTITY_HOLLOW_COLUMNS[table]
    for (const row of mapped.graph.tables[table]) await tx.execute(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`, columns.map(column => row[column]))
  }
  const raw = JSON.stringify(source.graph)
  const evidence: QuantityHollowMigrationEvidence = { entity_id: input.entityId, project_id: input.projectId, batch_id: input.batchId, source_package_json: raw, source_fingerprint: await quantityHollowHash(raw), mapped_package_json: JSON.stringify(mapped.graph) }
  await tx.execute(`INSERT INTO ${QUANTITY_HOLLOW_EVIDENCE_TABLE}(${QUANTITY_HOLLOW_EVIDENCE_COLUMNS.join(',')}) VALUES(${QUANTITY_HOLLOW_EVIDENCE_COLUMNS.map(() => '?').join(',')})`, QUANTITY_HOLLOW_EVIDENCE_COLUMNS.map(column => evidence[column]))
  await verifyQuantityHollowMigrationEvidence(evidence, (await readQuantityHollowTables(tx))!)
}

export interface QuantityHollowMigrationRemoval {
  entityIds?: readonly string[]
  projects?: readonly string[]
  crews?: readonly string[]
  workers?: readonly string[]
  quantity?: readonly { table: string, id: string }[]
}
/** 恢复保护同时覆盖物理根、原责任闭包及迁入后新增的真实原件。 */
export async function assertQuantityHollowMigrationReferences(tx: TransactionDb, removed: QuantityHollowMigrationRemoval): Promise<void> {
  const keys = new Set([...(removed.projects ?? []).map(id => hollowRowKey('projects', id)), ...(removed.crews ?? []).map(id => hollowRowKey('crews', id)), ...(removed.workers ?? []).map(id => hollowRowKey('workers', id)), ...(removed.quantity ?? []).map(row => hollowRowKey(row.table, row.id))])
  if (!keys.size && !removed.entityIds?.length)
    return
  const tables = await readQuantityHollowTables(tx)
  if (!tables)
    return
  const evidence = await readQuantityHollowMigrationEvidence(tx)
  const deleting = evidence.filter(row => removed.entityIds?.includes(row.entity_id))
  const owned = new Set<string>()
  for (const row of deleting) {
    const proof = await verifyQuantityHollowMigrationEvidence(row, tables)
    for (const entry of proof.graph.rowOrigins) owned.add(hollowRowKey(entry.table, entry.exportedId))
    const roots = new Set(proof.histories.keys())
    for (const table of QUANTITY_HOLLOW_TABLES) {
      if (tables[table].some(value => roots.has(String(table === 'quantity_hollow_records' ? value.id : value.record_id)) && !owned.has(hollowRowKey(table, value.id))))
        throw quantityProblem('conflict', '迁入空鼓检查已有独立追加的修订、整改或回执；已阻止恢复并保留原件')
    }
  }
  const projects = await tx.select<{ id: string }>('SELECT id FROM projects ORDER BY id')
  const graphs = await buildQuantityHollowMigrationGraphs(tx, tables, projects.map(row => row.id))
  for (const graph of graphs.values()) {
    const proof = await proveQuantityHollowMigrationGraph(graph)
    for (const history of proof.histories.values()) {
      if (owned.has(hollowRowKey('quantity_hollow_records', history.recordId)))
        continue
      const collector = quantityHollowIdentityCollector()
      collector.history(history)
      if (collector.identities().some(entry => entry.kind === 'row' && keys.has(hollowRowKey(entry.table, entry.sourceId))))
        throw quantityProblem('conflict', '独立空鼓检查原件仍引用本批次项目、责任或施工主体；已阻止恢复并保留全部当前事实')
    }
  }
}

export async function removeQuantityHollowMigration(tx: TransactionDb, entityIds: readonly string[]): Promise<void> {
  if (!entityIds.length)
    return
  const evidence = (await readQuantityHollowMigrationEvidence(tx)).filter(row => entityIds.includes(row.entity_id))
  const tables = await readQuantityHollowTables(tx)
  if (!tables && evidence.length)
    throw quantityProblem('relationship-mismatch', '空鼓迁入原表已缺失，不能恢复')
  for (const row of evidence) {
    const proof = await verifyQuantityHollowMigrationEvidence(row, tables!)
    for (const table of [...QUANTITY_HOLLOW_TABLES].reverse()) {
      for (const value of proof.graph.tables[table]) await tx.execute(`DELETE FROM ${table} WHERE id=?`, [value.id])
    }
    await tx.execute(`DELETE FROM ${QUANTITY_HOLLOW_EVIDENCE_TABLE} WHERE entity_id=?`, [row.entity_id])
  }
}
