import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollProjectGraph } from '../../app/lib/migration/payroll-source'
import type { PayrollHollowAdoption, PayrollHollowCommand, PayrollHollowCommandResult, PayrollHollowPolicyRevision, PayrollHollowSnapshot, PayrollHollowStart } from '../../app/lib/payroll/central-hollow-deduction-contract'
import type { PayrollHollowProcessedVersionEntry } from '../../app/lib/payroll/central-hollow-deduction-projection'
import type { QuantityHollowFact } from '../../app/lib/quantity/central-hollow-contract'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { isPayrollHollowSnapshot } from '../../app/lib/payroll/central-hollow-deduction-snapshot'
import { hollowEqual } from '../../app/lib/quantity/central-hollow-primitives'
import { quantityHollowFrozenFact } from '../../app/lib/quantity/central-hollow-proof'
import { proveQuantityHollowMigrationGraph } from '../../app/lib/quantity/hollow-migration-proof'
import { loadPayrollHollowPolicyRevisions, payrollHollowHash, payrollHollowJson, readPayrollHollowReceipt } from './payroll-hollow-data'
import { loadPayrollHollowAdoptions, loadPayrollHollowStarts } from './payroll-hollow-starts'
import { loadPayrollMigratedHollow } from './payroll-migrated-hollow'
import { loadPayrollMigratedProof } from './payroll-migrated-proof'

export interface PayrollHollowSourceProof {
  processedVersions: Map<string, PayrollHollowProcessedVersionEntry[]>
  policyRevisions: Map<string, PayrollHollowPolicyRevision>
  policyVersions: Map<string, string[]>
  starts: Map<string, PayrollHollowStart>
  adoptions: Map<string, PayrollHollowAdoption>
  receipts: Map<string, { command: PayrollHollowCommand, result: PayrollHollowCommandResult }>
}
export const emptyPayrollHollowSourceProof = (): PayrollHollowSourceProof => ({ processedVersions: new Map(), policyRevisions: new Map(), policyVersions: new Map(), starts: new Map(), adoptions: new Map(), receipts: new Map() })

/** 原生工资原图在原身份内回放；其每个冻结户级端点必须属于携带的数量原件闭包。 */
export async function provePayrollHollowMigrationSource(tx: TransactionDb, graph: PayrollProjectGraph): Promise<PayrollHollowSourceProof> {
  const result = emptyPayrollHollowSourceProof()
  if (!graph.deductions)
    return result
  const quantity = await proveQuantityHollowMigrationGraph(graph.deductions.quantity, graph.projectId)
  const ancestors = graph.deductions.proof ? await loadPayrollMigratedProof(tx, graph.projectId) : null
  const provider = ancestors ? loadPayrollMigratedHollow : undefined
  for (const [version, entries] of ancestors?.hollow.processedVersions ?? [])
    result.processedVersions.set(version, structuredClone(entries))
  function fact(value: QuantityHollowFact) {
    const history = quantity.histories.get(value.recordId)
    const original = history ? quantityHollowFrozenFact(history, value.proof) : null
    if (!original || !hollowEqual(original, value))
      throw payrollProblem('unavailable', '工资扣款的原检查前缀不属于所携带的数量原件，不能用当前余量补齐')
  }
  function snapshot(value: unknown) {
    if (!isPayrollHollowSnapshot(value))
      throw payrollProblem('unavailable', '工资扣款快照缺少完整原数量与金额证据')
    const original: PayrollHollowSnapshot = value
    original.facts.forEach(fact)
    original.start?.lines.forEach(line => fact(line.fact))
    original.adoptions.forEach(row => fact(row.line.fact))
    original.previousProcessed.forEach(row => fact(row.adoption.line.fact))
  }
  for (const policy of await loadPayrollHollowPolicyRevisions(tx, graph.projectId, provider)) {
    result.policyRevisions.set(policy.id, policy)
    result.policyVersions.set(policy.id, [...new Set([...(ancestors?.hollow.policyVersions.get(policy.id) ?? []), payrollHollowHash(policy)])])
  }
  const starts = await loadPayrollHollowStarts(tx, graph.projectId, provider)
  for (const start of starts) {
    start.lines.forEach(line => fact(line.fact))
    result.starts.set(start.id, start)
  }
  for (const adoption of await loadPayrollHollowAdoptions(tx, graph.projectId, starts, provider)) {
    fact(adoption.line.fact)
    result.adoptions.set(adoption.id, adoption)
  }
  for (const receipt of graph.central?.tables.payroll_command_receipts.filter(row => ['save-hollow-policies', 'start-hollow-deduction'].includes(String(row.action))) ?? []) result.receipts.set(String(receipt.command_id), ancestors?.hollow.receipts.get(String(receipt.command_id)) ?? readPayrollHollowReceipt(receipt))
  for (const table of ['payroll_a_statement_sources', 'payroll_c1_statement_sources', 'payroll_c2_statement_sources'] as const) {
    for (const row of graph.central?.tables[table] ?? []) {
      if (ancestors?.originals.has(String(row.statement_id)))
        continue
      const source = payrollHollowJson(row.source_json)
      if (source && typeof source === 'object' && Object.hasOwn(source, 'hollow'))
        snapshot((source as Record<string, unknown>).hollow)
    }
  }
  for (const head of graph.statements.filter(row => row.status === 'released' && row.snapshot_json)) {
    if (ancestors?.originals.has(String(head.id)))
      continue
    const raw = payrollHollowJson(head.snapshot_json) as Record<string, unknown>
    const document = raw[`${String(head.format_family).toLowerCase()}Document`]
    if (document && typeof document === 'object' && Object.hasOwn(document, 'hollow'))
      snapshot((document as Record<string, unknown>).hollow)
  }
  return result
}
