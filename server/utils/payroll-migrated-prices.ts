import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollAPriceRevision } from '../../app/lib/payroll/central-a-contract'
import type { PayrollAPriceProjectionLoader } from '../../app/lib/payroll/central-a-prices'
import type { PayrollIdentityMapping } from '../../app/lib/payroll/central-contract'
import { createHash } from 'node:crypto'
import { parsePayrollProjectGraph } from '../../app/lib/migration/payroll-source'
import { loadPayrollAPrices } from '../../app/lib/payroll/central-a-prices'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { createPayrollMigratedMapper } from './payroll-migrated-mapping'
import { loadPayrollMigratedProof, withPayrollMigratedSource } from './payroll-migrated-proof'

const originals = new Map<string, Promise<PayrollAPriceRevision[]>>()

/** 缓存只含不可变原图；当前物理行每次重验，原范围 JSON 始终不回写。 */
export const loadPayrollMigratedPrices: PayrollAPriceProjectionLoader = async (tx: TransactionDb, projectId: string) => {
  const result = new Map<string, PayrollAPriceRevision>()
  if (!(await tx.select('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'payroll_migration_evidence\'')).length)
    return result
  const evidences = await tx.select<{ source_graph_json: string, mapping_json: string }>('SELECT source_graph_json,mapping_json FROM payroll_migration_evidence WHERE project_id=?', [projectId])
  if (!evidences.length)
    return result
  await loadPayrollMigratedProof(tx, projectId)
  for (const evidence of evidences) {
    const graph = parsePayrollProjectGraph(JSON.parse(evidence.source_graph_json))
    const mappings: PayrollIdentityMapping[] = JSON.parse(evidence.mapping_json)
    const mapper = createPayrollMigratedMapper(mappings)
    const hash = createHash('sha256').update(evidence.source_graph_json).digest('hex')
    let promise = originals.get(hash)
    if (!promise) {
      // 原图内只装载已验证的祖先 DAG；先投影祖先范围，再进入本次映射，不能直接解释最初原 JSON。
      promise = withPayrollMigratedSource(graph, source => loadPayrollAPrices(source, graph.projectId, loadPayrollMigratedPrices))
      if (originals.size >= 8)
        originals.delete(originals.keys().next().value!)
      originals.set(hash, promise)
      void promise.catch(() => originals.delete(hash))
    }
    for (const original of await promise) {
      const mapped = mapper.aPriceRevision(original)
      if (mapped.projectId !== projectId || result.has(mapped.id))
        throw payrollProblem('unavailable', '迁入工资价格归属或身份映射无法唯一核实')
      result.set(mapped.id, mapped)
    }
  }
  return result
}
