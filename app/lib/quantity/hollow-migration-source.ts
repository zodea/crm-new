import type { SoftDb } from '../db/soft-delete'
import type { QuantityHollowTables } from './central-hollow-schema'
import type { QuantityHollowMigrationEvidence, QuantityHollowMigrationGraph, QuantityHollowOriginBody } from './hollow-migration-contract'
import { hollowEqual } from './central-hollow-primitives'
import { extendQuantityHollowProvenHistory, proveQuantityHollowRecord } from './central-hollow-proof'
import { QUANTITY_HOLLOW_TABLES } from './central-hollow-schema'
import { emptyQuantityHollowMigrationGraph, hollowMigrationInvalid, hollowRowKey, quantityHollowHash } from './hollow-migration-graph'
import { quantityHollowIdentityCollector } from './hollow-migration-mapping'
import { proveQuantityHollowMigrationGraph } from './hollow-migration-proof'
import { quantityHollowRecordTables } from './hollow-migration-tables'

export const QUANTITY_HOLLOW_EVIDENCE_TABLE = 'quantity_hollow_migration_evidence'
export const QUANTITY_HOLLOW_EVIDENCE_COLUMNS = ['entity_id', 'project_id', 'batch_id', 'source_package_json', 'source_fingerprint', 'mapped_package_json'] as const
export async function readQuantityHollowMigrationEvidence(db: Pick<SoftDb, 'select'>): Promise<QuantityHollowMigrationEvidence[]> {
  const schema = await db.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\'')
  if (!schema.some(row => row.name === QUANTITY_HOLLOW_EVIDENCE_TABLE))
    return []
  return db.select<QuantityHollowMigrationEvidence>(`SELECT ${QUANTITY_HOLLOW_EVIDENCE_COLUMNS.join(', ')} FROM ${QUANTITY_HOLLOW_EVIDENCE_TABLE} ORDER BY entity_id`)
}

/** 每次核物理原件集合；缓存的源证明不得为新增/丢失的物理行背书。 */
export async function verifyQuantityHollowMigrationEvidence(evidence: QuantityHollowMigrationEvidence, physical: QuantityHollowTables) {
  if (await quantityHollowHash(evidence.source_package_json) !== evidence.source_fingerprint)
    hollowMigrationInvalid('迁入来源包摘要不一致')
  const source = await proveQuantityHollowMigrationGraph(JSON.parse(evidence.source_package_json))
  const mapped = await proveQuantityHollowMigrationGraph(JSON.parse(evidence.mapped_package_json), evidence.project_id)
  if (!hollowEqual(source.graph.origins, mapped.graph.origins))
    hollowMigrationInvalid('迁入后的原件正文集合发生改变')
  for (const table of QUANTITY_HOLLOW_TABLES) {
    const rows = new Map(physical[table].map(row => [row.id, row]))
    for (const expected of mapped.graph.tables[table]) {
      if (!hollowEqual(expected, rows.get(expected.id)))
        hollowMigrationInvalid('迁入原件物理行已改变或缺失')
    }
  }
  return mapped
}

/** 由当前真实物理五表导出；已有原件复制原字节，仅新增尚未归档的 native 后缀。 */
export async function buildQuantityHollowMigrationGraphs(db: Pick<SoftDb, 'select'>, tables: QuantityHollowTables, projectIds: readonly string[]): Promise<ReadonlyMap<string, QuantityHollowMigrationGraph>> {
  const records = new Map(tables.quantity_hollow_records.map(row => [row.id, row]))
  for (const table of QUANTITY_HOLLOW_TABLES) {
    for (const row of tables[table]) {
      const root = table === 'quantity_hollow_records' ? row : records.get(row.record_id)
      if (!root || !projectIds.includes(String(root.project_id)) || (Object.hasOwn(row, 'project_id') && row.project_id !== root.project_id))
        hollowMigrationInvalid('空鼓行缺少显式原项目或检查祖先')
    }
  }
  const evidenceRows = await readQuantityHollowMigrationEvidence(db)
  const graphs = new Map<string, QuantityHollowMigrationGraph>()
  for (const projectId of projectIds) {
    const evidence = evidenceRows.filter(row => row.project_id === projectId)
    if (evidence.length > 1)
      hollowMigrationInvalid('当前项目出现多个活动迁入原件包')
    const existing = evidence[0] ? await verifyQuantityHollowMigrationEvidence(evidence[0], tables) : null
    const graph = structuredClone(existing?.graph ?? emptyQuantityHollowMigrationGraph())
    const owned = new Set(graph.rowOrigins.map(row => hollowRowKey(row.table, row.exportedId)))
    for (const root of tables.quantity_hollow_records.filter(row => row.project_id === projectId)) {
      const recordId = String(root.id)
      const rows = quantityHollowRecordTables(tables, recordId)
      const suffix = Object.fromEntries(QUANTITY_HOLLOW_TABLES.map(table => [table, rows[table].filter(row => !owned.has(hollowRowKey(table, row.id)))])) as QuantityHollowTables
      if (!QUANTITY_HOLLOW_TABLES.some(table => suffix[table].length))
        continue
      const prefix = existing?.histories.get(recordId)
      const result = prefix ? await extendQuantityHollowProvenHistory(prefix, suffix) : await proveQuantityHollowRecord({ projectId, recordId, tables: suffix })
      if (result.status !== 'proven')
        hollowMigrationInvalid(result.diagnostics.map(item => item.message).join('；'))
      const parentId = existing?.terminals.get(recordId)
      const parent = parentId ? existing!.origins.get(parentId)! : null
      const body: QuantityHollowOriginBody = { schemaVersion: 1, kind: prefix ? 'suffix' : 'root', projectId, recordId, base: parent ? { originId: parentId!, recordId: parent.history.recordId, headLogId: parent.history.fact.proof.headLogId, fingerprint: parent.history.fact.proof.fingerprint } : null, tables: suffix }
      const bodyJson = JSON.stringify(body)
      const originId = await quantityHollowHash(bodyJson)
      const collector = quantityHollowIdentityCollector()
      collector.history(result.history)
      for (const table of QUANTITY_HOLLOW_TABLES) {
        for (const row of suffix[table]) collector.row(table, row)
      }
      graph.origins.push({ id: originId, bodyJson })
      graph.bindings.push({ originId, identities: collector.identities() })
      for (const table of QUANTITY_HOLLOW_TABLES) {
        graph.tables[table].push(...suffix[table])
        graph.rowOrigins.push(...suffix[table].map(row => ({ table, exportedId: String(row.id), originId, sourceId: String(row.id) })))
      }
    }
    await proveQuantityHollowMigrationGraph(graph, projectId)
    graphs.set(projectId, graph)
  }
  if (evidenceRows.some(row => !graphs.has(row.project_id)))
    hollowMigrationInvalid('迁入原件包丢失当前项目')
  return graphs
}
