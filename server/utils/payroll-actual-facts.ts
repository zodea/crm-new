import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollActualFact, PayrollActualFacts, PayrollActualScope } from '../../app/lib/payroll/central-actual-contract'
import { payrollAAmount } from '../../app/lib/payroll/central-a-calculation'
import { loadPayrollGraph } from '../../app/lib/payroll/central-read'
import { loadPayrollAReleasedWithMigration } from './payroll-a-released-with-migration'
import { loadPayrollHistoricalActual } from './payroll-actual-history'
import { loadPayrollConfirmedActualEvents } from './payroll-actual-provenance'
import { payrollAdjustmentHash, payrollKnownAmount } from './payroll-adjustment-facts'
import { loadPayrollC1ReleasedWithMigration, loadPayrollC2ReleasedWithMigration } from './payroll-c-released-with-migration'
import { loadPayrollMigratedProof } from './payroll-migrated-proof'
import { loadPayrollConfirmedReversals } from './payroll-reversal-provenance'

/** 只读调用方已有事务，原发放直接使用其物理身份，不复制工资付款。 */
export async function loadPayrollActualFacts(tx: TransactionDb, scope: PayrollActualScope): Promise<PayrollActualFacts> {
  const imported = await loadPayrollMigratedProof(tx, scope.projectId)
  const heads = await tx.select<{ id: string, project_id: string, crew_id: string | null, actual_amount: number | null }>('SELECT id,project_id,crew_id,actual_amount FROM wage_statements WHERE project_id=? AND status=\'released\' AND format_family IN (\'A\',\'C1\',\'C2\') ORDER BY id', [scope.projectId])
  const documents = [...(await loadPayrollAReleasedWithMigration(tx)).values(), ...(await loadPayrollC1ReleasedWithMigration(tx)).values(), ...(await loadPayrollC2ReleasedWithMigration(tx)).values()]
  const rows: PayrollActualFact[] = []
  const reasons: string[] = []
  let historicalGraph: Awaited<ReturnType<typeof loadPayrollGraph>> | undefined
  for (const head of heads) {
    if (scope.originalStatementIds && !scope.originalStatementIds.includes(head.id))
      continue
    const migrated = imported.facts.get(`real:payroll:released:${head.id}`)
    if (migrated) {
      rows.push(migrated)
      continue
    }
    const document = documents.find(d => d.id === head.id && d.projectId === head.project_id)
    if (!document || head.actual_amount !== document.actualAmount) {
      historicalGraph ??= await loadPayrollGraph(tx)
      const historical = await loadPayrollHistoricalActual(tx, head.id, historicalGraph)
      rows.push(historical)
      reasons.push(...historical.signedAmount.reasons)
      continue
    }
    const sourceVersion = payrollAdjustmentHash(document)
    const proofRefs = [{ kind: 'frozen-source' as const, id: head.id, sourceFingerprint: sourceVersion }]
    rows.push({ identity: `real:payroll:released:${head.id}`, ref: { kind: 'released-statement', statementId: head.id }, kind: 'initial-release', projectId: document.projectId, originalStatementIds: [head.id], adjustmentIds: [], applicationIds: [], reverses: null, occurredOn: document.releasedAt.slice(0, 10), recordedAt: document.releasedAt, signedAmount: payrollKnownAmount(document.actualAmount), allocations: document.allocations.map(a => ({ workerId: a.workerId, workerName: a.workerName, crewId: head.crew_id, amount: a.amount, proofRefs })), allocationState: 'complete', historicalMembers: document.members.map(m => ({ workerId: m.workerId, crewId: head.crew_id, name: m.workerName })), qualification: 'proven', sourceVersion, diagnostics: [] })
  }
  const actual = await loadPayrollConfirmedActualEvents(tx, scope)
  rows.push(...actual.rows)
  reasons.push(...actual.reasons)
  const reversals = await loadPayrollConfirmedReversals(tx, scope, rows)
  rows.push(...reversals.rows)
  reasons.push(...reversals.reasons)
  return { sourceVersion: payrollAdjustmentHash({ heads, rows, reasons }), status: reasons.length || rows.some(r => r.allocationState !== 'complete') ? 'partial' : 'complete', rows, netAmount: payrollAAmount(rows.map(r => r.signedAmount.value), reasons), diagnostics: rows.flatMap(r => r.diagnostics) }
}
