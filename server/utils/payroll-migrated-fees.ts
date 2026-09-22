import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollAFeeRevision, PayrollAManagementBook, PayrollAManagementBookRevision, PayrollAManagementOwnership, PayrollANegativeLineRevision } from '../../app/lib/payroll/central-a-fees-contract'
import type { PayrollIdentityMapping } from '../../app/lib/payroll/central-contract'
import { createHash } from 'node:crypto'
import { parsePayrollProjectGraph } from '../../app/lib/migration/payroll-source'
import { loadPayrollAFeeRevisions, loadPayrollAManagementBooks, loadPayrollAManagementRevisions, loadPayrollANegativeLines } from './payroll-a-fees-data'
import { createPayrollMigratedMapper } from './payroll-migrated-mapping'
import { loadPayrollMigratedProof, withPayrollMigratedSource } from './payroll-migrated-proof'

interface OriginalFees { feeRevisions: PayrollAFeeRevision[], managementBooks: PayrollAManagementBook[], managementRevisions: PayrollAManagementBookRevision[], negativeLines: PayrollANegativeLineRevision[], managementOwnership: PayrollAManagementOwnership[] }
const originals = new Map<string, Promise<OriginalFees>>()

/** A 配置消费端只取已映射 DTO；源缓存绑定整图 hash，每次读取先验证当前原物理集合。 */
export async function loadPayrollMigratedFees(tx: TransactionDb, projectId: string) {
  const result = { feeRevisions: new Map<string, PayrollAFeeRevision>(), managementBooks: new Map<string, PayrollAManagementBook>(), managementRevisions: new Map<string, PayrollAManagementBookRevision>(), negativeLines: new Map<string, PayrollANegativeLineRevision>(), managementOwnership: new Map<string, PayrollAManagementOwnership>(), unavailableIds: new Set<string>() }
  if (!(await tx.select('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'payroll_migration_evidence\'')).length)
    return result
  const evidences = await tx.select<{ source_graph_json: string, mapping_json: string }>('SELECT source_graph_json,mapping_json FROM payroll_migration_evidence WHERE project_id=?', [projectId])
  if (!evidences.length)
    return result
  await loadPayrollMigratedProof(tx, projectId)
  for (const evidence of evidences) {
    const graph = parsePayrollProjectGraph(JSON.parse(evidence.source_graph_json))
    if (!graph.fees)
      continue
    const mappings: PayrollIdentityMapping[] = JSON.parse(evidence.mapping_json)
    const mapper = createPayrollMigratedMapper(mappings)
    const hash = createHash('sha256').update(evidence.source_graph_json).digest('hex')
    let promise = originals.get(hash)
    if (!promise) {
      promise = withPayrollMigratedSource(graph, async source => ({ feeRevisions: await loadPayrollAFeeRevisions(source, graph.projectId), managementBooks: await loadPayrollAManagementBooks(source, graph.projectId), managementRevisions: await loadPayrollAManagementRevisions(source, graph.projectId), negativeLines: (await Promise.all([...new Set(graph.fees!.tables.payroll_a_negative_lines.map(row => String(row.statement_id)))].map(id => loadPayrollANegativeLines(source, id)))).flat(), managementOwnership: graph.fees!.tables.payroll_a_management_ownership.map(row => ({ id: String(row.id), projectId: String(row.project_id), ownershipKey: String(row.ownership_key), managementBookId: String(row.management_book_id), firstStatementId: String(row.first_statement_id), proof: JSON.parse(String(row.proof_json)) })) }))
      if (originals.size >= 8)
        originals.delete(originals.keys().next().value!)
      originals.set(hash, promise)
      void promise.catch(() => originals.delete(hash))
    }
    const original = await promise
    function collect<T extends { id: string }>(table: string, values: T[], map: (value: T) => T, target: Map<string, T>) {
      for (const value of values) {
        const centralId = mappings.find(row => row.tableName === table && row.legacyId === value.id)?.centralId
        try {
          const mapped = map(value)
          target.set(mapped.id, mapped)
        }
        catch {
          if (centralId)
            result.unavailableIds.add(centralId)
        }
      }
    }
    collect('payroll_a_fee_revisions', original.feeRevisions, mapper.aFeeRevision, result.feeRevisions)
    collect('payroll_a_management_books', original.managementBooks, mapper.aManagementBook, result.managementBooks)
    collect('payroll_a_management_book_revisions', original.managementRevisions, mapper.aManagementRevision, result.managementRevisions)
    collect('payroll_a_negative_lines', original.negativeLines, mapper.aNegativeLine, result.negativeLines)
    collect('payroll_a_management_ownership', original.managementOwnership, mapper.aManagementOwnership, result.managementOwnership)
  }
  // 软删除只控制当前配置资格，不回写已发冻结正文。
  for (const [id, book] of result.managementBooks) {
    const [row] = await tx.select<{ deleted_at: string | null }>('SELECT deleted_at FROM payroll_a_management_books WHERE id=?', [id])
    if (row)
      result.managementBooks.set(id, { ...book, deletedAt: row.deleted_at })
  }
  return result
}
