import type { PayrollActualLedgerRead, PayrollActualPaymentDetailRead, PayrollActualPaymentFormRead, PayrollActualReversalFormRead } from './central-actual-contract'
import type { PayrollAdjustmentApplicationHistory, PayrollAdjustmentBalance, PayrollAdjustmentDetailRead, PayrollAdjustmentFormRead, PayrollAdjustmentHistoryRead, PayrollAdjustmentPreview, PayrollAdjustmentRecord } from './central-adjustment-contract'
import type { PayrollQuery } from './central-contract'
import type { PayrollReleaseAdjustmentPreview } from './central-release-adjustment-contract'
import { isPayrollActualFact, isPayrollActualSnapshot, isPayrollProofRef, isPayrollSignedAmount, isPayrollSourceDiagnostics, payrollUniqueIds } from './central-actual-codec'
import { assertPayrollActualDraft, assertPayrollActualTarget } from './central-actual-validation'
import { isPayrollAdjustmentConfirmedSnapshot, isPayrollOriginalWageRef } from './central-adjustment-codec'
import { assertPayrollAdjustmentDraft, assertPayrollAdjustmentTarget } from './central-adjustment-validation'
import { decodePayrollAdjustmentWire, parsePayrollActualScope } from './central-adjustment-wire'
import { payrollCanonical } from './central-command-shared'
import { payrollProblem } from './central-contract'
import { wireCent, wireContext, wireExact, wireId, wireObject, wireStrings, wireText } from './central-payroll-wire'
import { assertPayrollReversalDraft, assertPayrollReversalTarget } from './central-reversal-validation'
import { isPayrollSourceIdentity } from './migration-identity'
import { amountInCents } from './statements'

export type PayrollAdjustmentRead = PayrollAdjustmentFormRead | PayrollAdjustmentDetailRead | PayrollAdjustmentHistoryRead | PayrollActualLedgerRead | PayrollActualPaymentFormRead | PayrollActualPaymentDetailRead | PayrollActualReversalFormRead | PayrollReleaseAdjustmentPreview
export type PayrollAdjustmentReadKind = 'adjustment-form' | 'adjustment-detail' | 'adjustment-history' | 'actual-ledger' | 'actual-payment-form' | 'actual-payment-detail' | 'actual-reversal-form' | 'release-adjustments'
const same = (a: unknown, b: unknown) => payrollCanonical(a) === payrollCanonical(b)
function fail(): never {
  throw payrollProblem('unavailable', '工资更正读取与原目标、金额或确认依据不一致，请保留输入重新核对')
}
export function isPayrollAdjustmentBalance(v: unknown): v is PayrollAdjustmentBalance {
  try {
    wireExact(v, ['adjustmentId', 'rootAdjustmentId', 'confirmedDelta', 'appliedDelta', 'remainingDelta', 'balanceVersion', 'applicationIds'])
    if (![v.adjustmentId, v.rootAdjustmentId].every(id => isPayrollSourceIdentity(id, 'payroll_adjustments')) || ![v.confirmedDelta, v.appliedDelta, v.remainingDelta].every(isPayrollSignedAmount) || !wireText(v.balanceVersion) || !v.balanceVersion || !payrollUniqueIds(v.applicationIds, 'payroll_adjustment_applications'))
      return false
    const balance = v as unknown as PayrollAdjustmentBalance
    return balance.remainingDelta.value === null ? balance.confirmedDelta.value === null || balance.appliedDelta.value === null : balance.confirmedDelta.value !== null && balance.appliedDelta.value !== null && amountInCents(balance.confirmedDelta.value) - amountInCents(balance.appliedDelta.value) === amountInCents(balance.remainingDelta.value)
  }
  catch { return false }
}
function preview(v: unknown): v is PayrollAdjustmentPreview {
  try {
    wireExact(v, ['before', 'after', 'beforeAmount', 'afterAmount', 'delta', 'proofRefs', 'reasons'])
    for (const basis of [v.before, v.after]) assertPayrollAdjustmentDraft({ reason: '', evidenceNote: '', correctsAdjustmentId: null, basis })
    if (![v.beforeAmount, v.afterAmount, v.delta].every(isPayrollSignedAmount) || !Array.isArray(v.proofRefs) || !v.proofRefs.every(isPayrollProofRef) || !wireStrings(v.reasons))
      return false
    const p = v as unknown as PayrollAdjustmentPreview
    return p.delta.value === null ? p.beforeAmount.value === null || p.afterAmount.value === null : p.beforeAmount.value !== null && p.afterAmount.value !== null && amountInCents(p.afterAmount.value) - amountInCents(p.beforeAmount.value) === amountInCents(p.delta.value)
  }
  catch { return false }
}
function record(v: unknown): v is PayrollAdjustmentRecord {
  try {
    wireExact(v, ['id', 'rootAdjustmentId', 'originalStatementId', 'projectId', 'status', 'draft', 'delta', 'snapshot'])
    if (![v.id, v.rootAdjustmentId].every(id => isPayrollSourceIdentity(id, 'payroll_adjustments')) || !isPayrollSourceIdentity(v.originalStatementId, 'wage_statements') || !wireId(v.projectId) || !['draft', 'confirmed'].includes(String(v.status)))
      return false
    assertPayrollAdjustmentDraft(v.draft)
    if (v.status === 'draft')
      return v.delta === null && v.snapshot === null
    return isPayrollAdjustmentConfirmedSnapshot(v.snapshot) && v.snapshot.id === v.id && v.snapshot.rootAdjustmentId === v.rootAdjustmentId && v.snapshot.original.statementId === v.originalStatementId && v.snapshot.original.projectId === v.projectId && v.snapshot.preview.delta.value === v.delta && same(v.draft, { reason: v.snapshot.reason, evidenceNote: v.snapshot.evidenceNote, correctsAdjustmentId: v.snapshot.correctsAdjustmentId, basis: v.snapshot.preview.after })
  }
  catch { return false }
}
function eligibility(v: unknown, keys: string[], readonly: boolean) {
  if (!wireObject(v) || !wireStrings(v.reasons))
    return false
  wireExact(v, [...keys, 'reasons'])
  return keys.every(k => typeof v[k] === 'boolean' && (!readonly || !v[k]))
}
function applicationHistory(v: unknown, projectId: string, balances: PayrollAdjustmentBalance[]): v is PayrollAdjustmentApplicationHistory[] {
  if (!Array.isArray(v))
    return false
  const ids = new Set<string>()
  for (const a of v) {
    wireExact(a, ['id', 'adjustmentId', 'rootAdjustmentId', 'kind', 'appliedDelta', 'fact', 'reversesApplicationId', 'reasons'])
    if (!isPayrollSourceIdentity(a.id, 'payroll_adjustment_applications') || ![a.adjustmentId, a.rootAdjustmentId].every(id => isPayrollSourceIdentity(id, 'payroll_adjustments')) || ids.has(a.id) || !['actual-payment', 'later-release', 'recording-reversal'].includes(String(a.kind)) || !isPayrollSignedAmount(a.appliedDelta) || !wireStrings(a.reasons) || !(a.reversesApplicationId === null || isPayrollSourceIdentity(a.reversesApplicationId, 'payroll_adjustment_applications')))
      return false
    ids.add(a.id)
    const id = a.id
    if (!balances.some(b => b.rootAdjustmentId === a.rootAdjustmentId && b.applicationIds.includes(id)))
      return false
    if (a.fact === null) {
      if (a.appliedDelta.value !== null || !a.reasons.length)
        return false
    }
    else if (!isPayrollActualFact(a.fact) || a.fact.projectId !== projectId || (a.kind === 'later-release' ? a.fact.ref.kind !== 'released-statement' : a.fact.ref.kind !== 'actual-event' || !a.fact.applicationIds.includes(a.id)) || (a.kind === 'recording-reversal') !== (a.fact.kind === 'recording-reversal') || (a.kind !== 'recording-reversal' && a.reversesApplicationId !== null)) {
      return false
    }
  }
  if (![...new Set(balances.flatMap(b => b.applicationIds))].every(id => ids.has(id)))
    return false
  const history = v as PayrollAdjustmentApplicationHistory[]
  return balances.every((balance) => {
    const applications = history.filter(a => a.rootAdjustmentId === balance.rootAdjustmentId)
    return balance.appliedDelta.value === null || (applications.every(a => a.appliedDelta.value !== null) && applications.reduce((sum, a) => sum + amountInCents(a.appliedDelta.value!), 0) === amountInCents(balance.appliedDelta.value))
  })
}
export function decodePayrollAdjustmentRead<T extends PayrollAdjustmentRead>(raw: unknown, kind: PayrollAdjustmentReadKind, query: PayrollQuery, target: unknown): T {
  const v = decodePayrollAdjustmentWire(raw)
  if (!wireObject(v) || !wireContext(v.context, query.origin) || !wireObject(v.context))
    fail()
  const readonly = v.context.readonly === true
  if (kind === 'adjustment-form') {
    wireExact(v, ['context', 'target', 'original', 'status', 'draft', 'preview', 'eligibility'])
    assertPayrollAdjustmentTarget(v.target)
    assertPayrollAdjustmentDraft(v.draft)
    if (!wireObject(target) || !same(v.target, target.target) || !isPayrollOriginalWageRef(v.original) || !['new', 'draft', 'confirmed'].includes(String(v.status)) || !preview(v.preview) || !eligibility(v.eligibility, ['canSaveDraft', 'canConfirmAdjustment'], readonly) || (v.target.adjustmentId === null && v.target.originalStatementId !== v.original.statementId) || (query.projectId && v.original.projectId !== query.projectId))
      fail()
  }
  else if (kind === 'adjustment-detail') {
    wireExact(v, ['context', 'original', 'adjustment', 'balance', 'applications'])
    if (!isPayrollOriginalWageRef(v.original) || !record(v.adjustment) || v.adjustment.id !== target || v.adjustment.originalStatementId !== v.original.statementId || !isPayrollAdjustmentBalance(v.balance) || v.balance.adjustmentId !== target || v.balance.rootAdjustmentId !== v.adjustment.rootAdjustmentId || (query.projectId && v.original.projectId !== query.projectId))
      fail()
    if (!applicationHistory(v.applications, v.original.projectId, [v.balance]))
      fail()
  }
  else if (kind === 'adjustment-history') {
    wireExact(v, ['context', 'original', 'adjustments', 'applications'])
    if (!isPayrollOriginalWageRef(v.original) || v.original.statementId !== target || (query.projectId && v.original.projectId !== query.projectId) || !Array.isArray(v.adjustments))
      fail()
    const balances: PayrollAdjustmentBalance[] = []
    const ids = new Set<string>()
    for (const entry of v.adjustments) {
      wireExact(entry, ['adjustment', 'balance'])
      if (!record(entry.adjustment) || entry.adjustment.originalStatementId !== target || entry.adjustment.projectId !== v.original.projectId || ids.has(entry.adjustment.id) || !isPayrollAdjustmentBalance(entry.balance) || entry.balance.adjustmentId !== entry.adjustment.id || entry.balance.rootAdjustmentId !== entry.adjustment.rootAdjustmentId)
        fail()
      ids.add(entry.adjustment.id)
      balances.push(entry.balance)
    }
    if (!applicationHistory(v.applications, v.original.projectId, balances))
      fail()
  }
  else if (kind === 'actual-ledger') {
    wireExact(v, ['context', 'scope', 'sourceVersion', 'status', 'rows', 'netAmount', 'diagnostics'])
    const scope = parsePayrollActualScope(v.scope)
    if (!same(scope, target) || !wireText(v.sourceVersion) || !['complete', 'partial', 'forbidden', 'unavailable'].includes(String(v.status)) || !Array.isArray(v.rows) || !v.rows.every(isPayrollActualFact) || !isPayrollSignedAmount(v.netAmount) || !isPayrollSourceDiagnostics(v.diagnostics))
      fail()
    if (new Set(v.rows.map(r => r.identity)).size !== v.rows.length || v.rows.some(r => r.projectId !== scope.projectId || (scope.originalStatementIds && r.originalStatementIds.some(id => !scope.originalStatementIds!.includes(id))) || (r.qualification === 'scoped-amount-proven' && !scope.originalStatementIds)) || (v.netAmount.value !== null && (v.rows.some(r => r.signedAmount.value === null) || v.rows.reduce((sum, r) => sum + amountInCents(r.signedAmount.value!), 0) !== amountInCents(v.netAmount.value))))
      fail()
  }
  else if (kind === 'actual-payment-form') {
    wireExact(v, ['context', 'target', 'originals', 'balances', 'draft', 'eligibility'])
    assertPayrollActualTarget(v.target)
    assertPayrollActualDraft(v.draft)
    if (!wireObject(target) || !same(v.target, target.target) || !Array.isArray(v.originals) || !v.originals.length || !v.originals.every(isPayrollOriginalWageRef) || !Array.isArray(v.balances) || !v.balances.every(isPayrollAdjustmentBalance) || !same(v.balances.map(b => b.adjustmentId).sort(), [...v.target.adjustmentIds].sort()) || !eligibility(v.eligibility, ['canConfirmActual'], readonly) || (query.projectId && v.originals.some(o => o.projectId !== query.projectId)))
      fail()
  }
  else if (kind === 'actual-payment-detail') {
    wireExact(v, ['context', 'fact', 'snapshot'])
    if (!isPayrollActualFact(v.fact) || v.fact.ref.kind !== 'actual-event' || v.fact.ref.eventId !== target || !isPayrollActualSnapshot(v.snapshot) || v.snapshot.id !== target || v.snapshot.projectId !== v.fact.projectId || !same(v.snapshot.applicationIds, v.fact.applicationIds) || (query.projectId && v.fact.projectId !== query.projectId))
      fail()
  }
  else if (kind === 'actual-reversal-form') {
    wireExact(v, ['context', 'target', 'originalFact', 'originals', 'draft', 'reversalAmount', 'applications', 'alreadyReversedBy', 'eligibility'])
    assertPayrollReversalTarget(v.target)
    assertPayrollReversalDraft(v.draft)
    if (!wireObject(target) || !same(v.target, target.target) || !isPayrollActualFact(v.originalFact) || !same(v.target.original, v.originalFact.ref) || !Array.isArray(v.originals) || !v.originals.every(isPayrollOriginalWageRef) || !isPayrollSignedAmount(v.reversalAmount) || v.reversalAmount.value !== (v.originalFact.signedAmount.value === null ? null : -v.originalFact.signedAmount.value) || !Array.isArray(v.applications) || !payrollUniqueIds(v.alreadyReversedBy, 'payroll_actual_events') || !eligibility(v.eligibility, ['canConfirmReversal'], readonly) || (query.projectId && v.originalFact.projectId !== query.projectId))
      fail()
    for (const a of v.applications) {
      wireExact(a, ['originalApplicationId', 'adjustmentId', 'rootAdjustmentId', 'amount', 'balanceVersion'])
      if (!isPayrollSourceIdentity(a.originalApplicationId, 'payroll_adjustment_applications') || ![a.adjustmentId, a.rootAdjustmentId].every(id => isPayrollSourceIdentity(id, 'payroll_adjustments')) || typeof a.amount !== 'number' || !wireCent(Math.abs(a.amount)) || !wireText(a.balanceVersion))
        fail()
    }
  }
  else {
    wireExact(v, ['context', 'statementId', 'candidates', 'reasons'])
    if (!wireObject(target) || v.statementId !== target.statementId || !isPayrollSourceIdentity(v.statementId, 'wage_statements') || !Array.isArray(v.candidates) || !wireStrings(v.reasons))
      fail()
    for (const c of v.candidates) {
      wireExact(c, ['adjustmentId', 'rootAdjustmentId', 'originalStatementId', 'originalMonth', 'remainingAmount', 'embeddedInCalculation', 'additionalWithholding', 'balanceVersion', 'coverageVersion', 'eligible', 'reasons'])
      if (![c.adjustmentId, c.rootAdjustmentId].every(id => isPayrollSourceIdentity(id, 'payroll_adjustments')) || !isPayrollSourceIdentity(c.originalStatementId, 'wage_statements') || ![c.originalMonth, c.balanceVersion, c.coverageVersion].every(wireText) || !(c.remainingAmount === null || (typeof c.remainingAmount === 'number' && wireCent(Math.abs(c.remainingAmount)))) || !wireCent(c.embeddedInCalculation) || !(c.additionalWithholding === null || wireCent(c.additionalWithholding)) || typeof c.eligible !== 'boolean' || !wireStrings(c.reasons) || (c.eligible && c.reasons.length))
        fail()
    }
    if (new Set(v.candidates.map(c => c.rootAdjustmentId)).size !== v.candidates.length)
      fail()
  }
  return v as unknown as T
}
