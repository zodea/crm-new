import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollAdjustmentApplicationHistory } from '../../app/lib/payroll/central-adjustment-contract'
import { payrollAAmount } from '../../app/lib/payroll/central-a-calculation'
import { isPayrollActualSnapshot } from '../../app/lib/payroll/central-actual-codec'
import { loadPayrollActualFacts } from './payroll-actual-facts'
import { loadPayrollMigratedProof } from './payroll-migrated-proof'
import { loadPayrollReleasedApplicationIds } from './payroll-release-application-provenance'

/** 使用与余额相同的原确认资格，损坏的应用仍保留身份和具体缺口。 */
export async function loadPayrollAdjustmentApplicationHistory(tx: TransactionDb, projectId: string, rootIds: string[]): Promise<PayrollAdjustmentApplicationHistory[]> {
  if (!rootIds.length)
    return []
  const rows = await tx.select<{ id: string, adjustment_id: string, root_adjustment_id: string, kind: PayrollAdjustmentApplicationHistory['kind'], signed_applied_fen: number, actual_event_id: string | null, released_statement_id: string | null }>(`SELECT * FROM payroll_adjustment_applications WHERE root_adjustment_id IN (${rootIds.map(() => '?').join(',')}) ORDER BY rowid`, rootIds)
  const facts = await loadPayrollActualFacts(tx, { projectId })
  const imported = await loadPayrollMigratedProof(tx, projectId)
  const history: PayrollAdjustmentApplicationHistory[] = []
  for (const row of rows) {
    const fact = facts.rows.find(f => row.actual_event_id ? f.ref.kind === 'actual-event' && f.ref.eventId === row.actual_event_id && f.applicationIds.includes(row.id) : f.ref.kind === 'released-statement' && f.ref.statementId === row.released_statement_id)
    const valid = fact && (row.actual_event_id ? row.kind === (fact.kind === 'recording-reversal' ? 'recording-reversal' : 'actual-payment') : row.kind === 'later-release' && (await loadPayrollReleasedApplicationIds(tx, row.released_statement_id!)).includes(row.id)) && Number.isSafeInteger(row.signed_applied_fen)
    let reversesApplicationId: string | null = null
    if (valid && row.kind === 'recording-reversal') {
      const [event] = await tx.select<{ confirmed_snapshot_json: string }>('SELECT confirmed_snapshot_json FROM payroll_actual_events WHERE id=?', [row.actual_event_id])
      try {
        const snapshot: unknown = imported.snapshots.get(row.actual_event_id!) ?? JSON.parse(event!.confirmed_snapshot_json)
        if (isPayrollActualSnapshot(snapshot) && 'kind' in snapshot)
          reversesApplicationId = snapshot.applications[snapshot.applicationIds.indexOf(row.id)]?.originalApplicationId ?? null
      }
      catch { /* 原确认无法证明时保留未知；不从现金方向猜处理关系。 */ }
    }
    const reasons = valid ? [] : [`处理 ${row.id} 缺少一致的实际发放或收退款确认`]
    history.push({ id: row.id, adjustmentId: row.adjustment_id, rootAdjustmentId: row.root_adjustment_id, kind: row.kind, appliedDelta: payrollAAmount([valid ? row.signed_applied_fen / 100 : null], reasons), fact: valid ? fact : null, reversesApplicationId, reasons })
  }
  return history
}
