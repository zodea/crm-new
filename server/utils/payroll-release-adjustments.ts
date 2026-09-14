import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollAAdjustmentReconciliation } from '../../app/lib/payroll/central-a-adjustment-contract'
import type { PayrollReleaseAdjustmentApplication, PayrollReleaseAdjustmentCandidate } from '../../app/lib/payroll/central-release-adjustment-contract'
import { payrollCorrectionAmount } from '../../app/lib/payroll/central-adjustment-calculation'
import { payrollCanonical, payrollWriteRow } from '../../app/lib/payroll/central-command-shared'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { isPayrollReleaseApplications } from '../../app/lib/payroll/central-release-adjustment-wire'
import { amountInCents } from '../../app/lib/payroll/statements'
import { generateId } from '../../app/lib/util/id'
import { payrollAdjustmentChainHeads } from './payroll-adjustment-chain'
import { payrollAdjustmentHash as hash, loadPayrollAdjustmentOriginal } from './payroll-adjustment-facts'
import { loadPayrollAdjustmentBalance, loadPayrollAdjustmentRows, readPayrollAdjustmentRecord } from './payroll-adjustment-records'

interface Statement { id: string, project_id: string, crew_id: string | null, leader_worker_id: string, month: string, format_family: string, status: string, gross_amount: number | null }
export interface PayrollReleaseApplicationPlan extends PayrollReleaseAdjustmentApplication { rootAdjustmentId: string, originalStatementId: string }
function includedAmount(reconciliation: PayrollAAdjustmentReconciliation | undefined, rootAdjustmentId: string, remainingAmount: number | null) {
  if (!reconciliation || reconciliation.reasons.length || reconciliation.effectiveCumulative.value === null || remainingAmount === null)
    return 0
  const without = structuredClone(reconciliation.effectiveBasis)
  for (const row of reconciliation.coverage.filter(c => c.rootAdjustmentId === rootAdjustmentId)) {
    const component = without.components.find(c => c.ownershipKey === row.ownershipKey)
    for (const d of row.dimensions) {
      if (component && d.dimension === 'quantity')
        component.quantity = d.before
      else if (component && d.dimension === 'unit-price')
        component.unitPrice = d.before
      else if (d.dimension === 'pay-ratio')
        without.payRatio = d.before
    }
  }
  const amount = payrollCorrectionAmount(without).value
  if (amount === null)
    return 0
  const effect = (amountInCents(reconciliation.effectiveCumulative.value) - amountInCents(amount)) / 100
  return effect * remainingAmount <= 0 ? 0 : Math.min(Math.abs(remainingAmount), Math.abs(effect))
}
export async function readPayrollReleaseAdjustments(tx: TransactionDb, statementId: string, reconciliation?: PayrollAAdjustmentReconciliation) {
  const [statement] = await tx.select<Statement>('SELECT id,project_id,crew_id,leader_worker_id,month,format_family,status,gross_amount FROM wage_statements WHERE id=?', [statementId])
  if (!statement)
    throw payrollProblem('not-found', '后续工资不存在')
  const records = await loadPayrollAdjustmentRows(tx)
  const confirmed = records.filter(r => r.status === 'confirmed' && r.project_id === statement.project_id && r.original_statement_id !== statementId).map(readPayrollAdjustmentRecord)
  const heads = payrollAdjustmentChainHeads(confirmed)
  const candidates: PayrollReleaseAdjustmentCandidate[] = []
  for (const row of heads) {
    const { original } = await loadPayrollAdjustmentOriginal(tx, row.originalStatementId)
    if (original.leaderWorkerId !== statement.leader_worker_id || original.crewId !== statement.crew_id || original.month > statement.month)
      continue
    const balance = await loadPayrollAdjustmentBalance(tx, row.id)
    const remainingAmount = balance.remainingDelta.value
    if (remainingAmount === 0)
      continue
    const embeddedInCalculation = includedAmount(reconciliation, row.rootAdjustmentId, remainingAmount)
    const reasons = [...(remainingAmount === null ? ['原更正剩余无法证明'] : remainingAmount > 0 && !embeddedInCalculation ? ['该核增需通过独立实际补发处理'] : []), ...(original.formatFamily !== statement.format_family ? ['后续处理不能借另一工资格式转移原余额'] : []), ...(statement.format_family === 'A' ? reconciliation?.reasons ?? ['A 类须完成逐来源更正包含核验'] : []), ...(!['draft', 'checked'].includes(statement.status) ? ['后续工资已发或状态不可用'] : [])]
    candidates.push({ adjustmentId: row.id, rootAdjustmentId: row.rootAdjustmentId, originalStatementId: original.statementId, originalMonth: original.month, remainingAmount, embeddedInCalculation, additionalWithholding: remainingAmount === null ? null : remainingAmount < 0 ? Math.max(0, -remainingAmount - embeddedInCalculation) : 0, balanceVersion: balance.balanceVersion, coverageVersion: hash({ statement, original, balance, ...(reconciliation ? { reconciliation } : {}) }), eligible: reasons.length === 0, reasons })
  }
  return { statement, candidates, reasons: [] as string[] }
}
export async function preparePayrollReleaseAdjustments(tx: TransactionDb, statementId: string, actualAmount: number | null, applications?: PayrollReleaseAdjustmentApplication[], reconciliation?: PayrollAAdjustmentReconciliation): Promise<PayrollReleaseApplicationPlan[] | undefined> {
  if (applications === undefined && !reconciliation)
    return undefined
  if (applications !== undefined && !isPayrollReleaseApplications(applications))
    throw payrollProblem('validation-failed', '后续工资处理引用无效')
  const preview = await readPayrollReleaseAdjustments(tx, statementId, reconciliation)
  for (const candidate of preview.candidates.filter(c => c.eligible && c.embeddedInCalculation > 0)) {
    const application = applications?.find(a => a.adjustmentId === candidate.adjustmentId)
    const needed = candidate.remainingAmount! < 0 ? candidate.embeddedInCalculation : Math.min(candidate.embeddedInCalculation, Math.max(0, (actualAmount ?? 0) - Math.max(0, (preview.statement.gross_amount ?? 0) - candidate.embeddedInCalculation)))
    if (needed > 0 && (!application || Math.abs(application.amount) < needed))
      throw payrollProblem('validation-failed', '本次 A 发放已经包含原更正，须明确关联其处理金额，不能保留可再次补退的余额')
  }
  const plans = (applications ?? []).map((application) => {
    const candidate = preview.candidates.find(c => c.adjustmentId === application.adjustmentId)
    if (!candidate || !candidate.eligible || candidate.balanceVersion !== application.balanceVersion || candidate.coverageVersion !== application.coverageVersion)
      throw payrollProblem('stale-source', '后续处理的原余额或核算依据已变化，请重新核对')
    if (candidate.remainingAmount === null || application.amount * candidate.remainingAmount <= 0 || Math.abs(application.amount) > Math.abs(candidate.remainingAmount) || (application.amount > 0 && (application.amount > candidate.embeddedInCalculation || application.amount > (actualAmount ?? 0))))
      throw payrollProblem('validation-failed', '本次发放处理须方向一致、不超过原剩余，核增只能关联本次真实已发部分')
    return { ...application, rootAdjustmentId: candidate.rootAdjustmentId, originalStatementId: candidate.originalStatementId }
  })
  if (new Set(plans.map(p => p.rootAdjustmentId)).size !== plans.length)
    throw payrollProblem('validation-failed', '同一更正余额不能重复计为本次处理')
  const withholdingFen = plans.reduce((sum, p) => sum + (p.amount < 0 ? Math.max(0, -amountInCents(p.amount) - amountInCents(preview.candidates.find(c => c.adjustmentId === p.adjustmentId)!.embeddedInCalculation)) : 0), 0)
  if (!Number.isSafeInteger(withholdingFen) || actualAmount === null || preview.statement.gross_amount === null || amountInCents(actualAmount) + withholdingFen > amountInCents(preview.statement.gross_amount))
    throw payrollProblem('validation-failed', '本次处理金额未体现在真实少发中，不能提前结清原更正')
  return applications === undefined ? undefined : plans
}
export async function persistPayrollReleaseAdjustments(tx: TransactionDb, statementId: string, commandId: string, plans: PayrollReleaseApplicationPlan[], actorId: string): Promise<string[]> {
  const ids: string[] = []
  for (const plan of plans) {
    const id = generateId('payroll-application')
    await payrollWriteRow(tx, 'payroll_adjustment_applications', id, { adjustment_id: plan.adjustmentId, root_adjustment_id: plan.rootAdjustmentId, kind: 'later-release', signed_applied_fen: amountInCents(plan.amount), actual_event_id: null, released_statement_id: statementId, balance_version: plan.balanceVersion, proof_json: payrollCanonical({ commandId, ...plan }) }, actorId)
    ids.push(id)
  }
  return ids
}
