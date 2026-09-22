import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollActualFact, PayrollActualScope } from '../../app/lib/payroll/central-actual-contract'
import { amountInCents } from '../../app/lib/payroll/statements'
import { payrollAdjustmentHash as hash, payrollKnownAmount as known } from './payroll-adjustment-facts'

interface ApplicationAmount { id: string, adjustment_id: string, original_statement_id: string, project_id: string, signed_applied_fen: number }

/** 先验证完整收付与冲销，再投影原工资范围；范围金额不能反过来充当整笔冲销依据。 */
export async function scopePayrollActualFacts(tx: TransactionDb, scope: PayrollActualScope, facts: PayrollActualFact[]): Promise<{ rows: PayrollActualFact[], reasons: string[] }> {
  if (!scope.originalStatementIds)
    return { rows: facts, reasons: [] }
  const selectedIds = new Set(scope.originalStatementIds)
  const rows: PayrollActualFact[] = []
  const reasons: string[] = []
  for (const fact of facts) {
    const originals = fact.originalStatementIds.filter(id => selectedIds.has(id))
    if (!originals.length)
      continue
    if (originals.length === fact.originalStatementIds.length) {
      rows.push(fact)
      continue
    }
    const applications = fact.ref.kind === 'actual-event'
      ? await tx.select<ApplicationAmount>('SELECT a.id,a.adjustment_id,a.signed_applied_fen,c.original_statement_id,c.project_id FROM payroll_adjustment_applications a JOIN payroll_adjustments c ON c.id=a.adjustment_id WHERE a.actual_event_id=? ORDER BY a.id', [fact.ref.eventId])
      : []
    if (fact.signedAmount.value === null || !applications.length || applications.length !== fact.applicationIds.length
      || applications.some(a => !fact.applicationIds.includes(a.id) || !fact.adjustmentIds.includes(a.adjustment_id) || a.project_id !== fact.projectId || !fact.originalStatementIds.includes(a.original_statement_id) || !Number.isSafeInteger(a.signed_applied_fen))
      || applications.reduce((sum, a) => sum + a.signed_applied_fen, 0) !== amountInCents(fact.signedAmount.value)) {
      reasons.push(`工资收付 ${fact.identity} 缺少可核对的原工资处理金额，当前范围实额不可判定`)
      continue
    }
    const selected = applications.filter(a => selectedIds.has(a.original_statement_id))
    if (!selected.length) {
      reasons.push(`工资收付 ${fact.identity} 的所选原工资没有处理金额，不能按零忽略`)
      continue
    }
    const value = selected.reduce((sum, a) => sum + a.signed_applied_fen, 0) / 100
    const nonzero = fact.allocations.filter(a => a.amount !== null && a.amount !== 0)
    const singleRecipient = fact.allocationState === 'complete' && nonzero.length === 1
    const sourceVersion = hash({ original: fact.sourceVersion, applications: selected, originalStatementIds: originals })
    rows.push({
      ...fact,
      originalStatementIds: originals,
      adjustmentIds: [...new Set(selected.map(a => a.adjustment_id))],
      applicationIds: selected.map(a => a.id),
      signedAmount: known(value),
      allocations: fact.allocations.map(a => ({ ...a, amount: a.amount === 0 ? 0 : singleRecipient ? value : null })),
      allocationState: singleRecipient ? 'complete' : 'partial',
      qualification: 'scoped-amount-proven',
      sourceVersion,
      diagnostics: [...fact.diagnostics, { code: 'original-statement-scope', message: `本范围按原更正处理额计入 ${value} 元；整笔收付为 ${fact.signedAmount.value} 元。${singleRecipient ? '' : '原记录未说明各人各原工资的交叉分配，个人范围金额保持未知。'}`, recordId: fact.ref.kind === 'actual-event' ? fact.ref.eventId : fact.ref.statementId, workerId: null, field: null, tableName: 'payroll_actual_events', entityId: null, legacyRecordId: null }],
    })
  }
  return { rows, reasons }
}
