import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { QuantityHollowMigratedProof, QuantityHollowProvenHistory } from '../../app/lib/quantity/central-hollow-proof-contract'
import { parseQuantityHollowMigrationGraph } from '../../app/lib/quantity/hollow-migration-graph'
import { readQuantityHollowMigrationEvidence, verifyQuantityHollowMigrationEvidence } from '../../app/lib/quantity/hollow-migration-source'
import { readQuantityHollowTables } from '../../app/lib/quantity/hollow-migration-tables'

/** 只返回迁入前缀。native 后缀由来源服务继续证明，不冒充迁入回执。 */
export async function loadQuantityHollowMigratedProof(tx: TransactionDb, projectId: string): Promise<QuantityHollowMigratedProof> {
  const evidence = (await readQuantityHollowMigrationEvidence(tx)).filter(row => row.project_id === projectId)
  if (!evidence.length)
    return { histories: new Map(), unavailable: [] }
  const tables = await readQuantityHollowTables(tx)
  const histories = new Map<string, QuantityHollowProvenHistory>()
  const unavailable: QuantityHollowMigratedProof['unavailable'][number][] = []
  for (const row of evidence) {
    try {
      if (!tables || evidence.length !== 1)
        throw new Error('迁入原件五表或唯一来源缺失')
      const proof = await verifyQuantityHollowMigrationEvidence(row, tables)
      for (const [id, history] of proof.histories) histories.set(id, history)
    }
    catch (cause) {
      const ids = new Set<string>()
      try {
        for (const root of parseQuantityHollowMigrationGraph(JSON.parse(row.mapped_package_json)).tables.quantity_hollow_records) ids.add(String(root.id))
      }
      catch { for (const root of tables?.quantity_hollow_records.filter(root => root.project_id === projectId) ?? []) ids.add(String(root.id)) }
      if (!ids.size)
        unavailable.push({ code: 'migration-unproven', message: '迁入原检查来源包无法证明', recordId: null, target: null })
      for (const recordId of ids) unavailable.push({ code: 'migration-unproven', message: cause instanceof Error ? cause.message : '迁入原检查来源包无法证明', recordId, target: null })
    }
  }
  return { histories, unavailable }
}
