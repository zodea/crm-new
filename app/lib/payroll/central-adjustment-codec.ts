import type { PayrollAdjustmentCommand, PayrollAdjustmentCommandResult, PayrollAdjustmentConfirmedSnapshot, PayrollOriginalWageRef } from './central-adjustment-contract'
import type { PayrollSourceIdentityTable } from './migration-identity'
import { isPayrollABook } from './central-a-fees-validation'
import { payrollCorrectionAmount } from './central-adjustment-calculation'
import { assertPayrollAdjustmentDraft, payrollCorrectionReasons } from './central-adjustment-validation'
import { payrollCanonical } from './central-command-shared'
import { payrollProblem } from './central-contract'
import { wireCent, wireDate, wireExact, wireId, wireMonth, wireObject, wireStrings, wireText } from './central-payroll-wire'
import { isPayrollSourceIdentity } from './migration-identity'
import { amountInCents } from './statements'

const uniqueIds = (value: unknown, table?: PayrollSourceIdentityTable): value is string[] => Array.isArray(value) && value.every(id => table ? isPayrollSourceIdentity(id, table) : wireId(id)) && new Set(value).size === value.length
const knownAmount = (v: unknown) => wireObject(v) && typeof v.value === 'number' && wireCent(Math.abs(v.value)) && v.knownValue === v.value && v.state === 'known' && Array.isArray(v.reasons) && !v.reasons.length
export function isPayrollOriginalWageRef(v: unknown): v is PayrollOriginalWageRef {
  try {
    wireExact(v, ['statementId', 'formatFamily', 'projectId', 'projectName', 'crewId', 'leaderWorkerId', 'month', 'memberWorkerIds', 'members', 'originalSignatureAmount', 'originalGrossAmount', 'provenanceVersion', 'book'])
    if (Object.hasOwn(v, 'book') && (v.formatFamily !== 'A' || !isPayrollABook(v.book)))
      return false
    if (!isPayrollSourceIdentity(v.statementId, 'wage_statements') || ![v.projectId, v.leaderWorkerId].every(wireId) || !['A', 'C1', 'C2'].includes(String(v.formatFamily)) || !(v.projectName === null || wireText(v.projectName)) || !(v.crewId === null || wireId(v.crewId)) || !wireMonth(v.month) || !uniqueIds(v.memberWorkerIds) || !v.memberWorkerIds.includes(String(v.leaderWorkerId)) || !wireText(v.provenanceVersion) || !v.provenanceVersion || !knownAmount(v.originalSignatureAmount) || !knownAmount(v.originalGrossAmount) || !Array.isArray(v.members))
      return false
    for (const m of v.members) {
      wireExact(m, ['workerId', 'workerName', 'crewId'])
      if (!wireId(m.workerId) || !(m.workerName === null || wireText(m.workerName)) || m.crewId !== v.crewId)
        return false
    }
    return v.members.length === v.memberWorkerIds.length && uniqueIds(v.members.map(m => m.workerId)) && v.members.every(m => (v.memberWorkerIds as string[]).includes(m.workerId))
  }
  catch { return false }
}
export function isPayrollAdjustmentConfirmedSnapshot(v: unknown): v is PayrollAdjustmentConfirmedSnapshot {
  try {
    wireExact(v, ['schemaVersion', 'id', 'rootAdjustmentId', 'correctsAdjustmentId', 'original', 'reason', 'evidenceNote', 'preview', 'confirmedBy', 'confirmedAt', 'commandId'])
    if (v.schemaVersion !== 1 || ![v.id, v.rootAdjustmentId].every(id => isPayrollSourceIdentity(id, 'payroll_adjustments')) || !wireId(v.confirmedBy) || !isPayrollSourceIdentity(v.commandId, 'payroll_command_receipts') || !(v.correctsAdjustmentId === null || isPayrollSourceIdentity(v.correctsAdjustmentId, 'payroll_adjustments')) || !isPayrollOriginalWageRef(v.original) || !wireText(v.reason) || !v.reason.trim() || !wireText(v.evidenceNote) || !v.evidenceNote.trim() || !wireText(v.confirmedAt) || !wireDate(v.confirmedAt.slice(0, 10)))
      return false
    wireExact(v.preview, ['before', 'after', 'beforeAmount', 'afterAmount', 'delta', 'proofRefs', 'reasons'])
    const p = v.preview
    for (const basis of [p.before, p.after]) {
      assertPayrollAdjustmentDraft({ reason: v.reason, evidenceNote: v.evidenceNote, correctsAdjustmentId: v.correctsAdjustmentId, basis })
      if (!wireObject(basis) || basis.formatFamily !== v.original.formatFamily)
        return false
    }
    if (![p.beforeAmount, p.afterAmount, p.delta].every(knownAmount) || !wireStrings(p.reasons) || p.reasons.length || !Array.isArray(p.proofRefs) || p.proofRefs.length !== 1)
      return false
    const snapshot = v as unknown as PayrollAdjustmentConfirmedSnapshot
    const before = snapshot.preview.before
    const after = snapshot.preview.after
    if (before?.formatFamily === 'A' && after?.formatFamily === 'A' && (before.source.schemaVersion !== 1 || after.source.schemaVersion !== 1)) {
      if (before.source.schemaVersion === 1 || after.source.schemaVersion === 1 || payrollCanonical(snapshot.original.book) !== payrollCanonical(before.source.book) || payrollCorrectionReasons(after, before).length)
        return false
    }
    if (!before || !after || payrollCorrectionReasons(after, before).length)
      return false
    return payrollCorrectionAmount(snapshot.preview.before!).value === snapshot.preview.beforeAmount.value && payrollCorrectionAmount(snapshot.preview.after!).value === snapshot.preview.afterAmount.value && amountInCents(snapshot.preview.afterAmount.value!) - amountInCents(snapshot.preview.beforeAmount.value!) === amountInCents(snapshot.preview.delta.value!) && payrollCanonical(p.proofRefs) === payrollCanonical([{ kind: 'frozen-source', id: v.original.statementId, sourceFingerprint: v.original.provenanceVersion }])
  }
  catch { return false }
}
export function decodePayrollAdjustmentResult(value: unknown, command: PayrollAdjustmentCommand): PayrollAdjustmentCommandResult {
  wireExact(value, ['commandId', 'projectId', 'originalStatementId', 'adjustmentId', 'actualEventId', 'applicationIds', 'outcome', 'sourceVersion', 'logIds'])
  const fail = () => {
    throw payrollProblem('unavailable', '工资更正回执与原提交身份或动作不一致')
  }
  if (value.commandId !== command.commandId || value.projectId !== command.projectId || !isPayrollSourceIdentity(value.originalStatementId, 'wage_statements') || !wireText(value.sourceVersion) || !value.sourceVersion || !uniqueIds(value.applicationIds, 'payroll_adjustment_applications') || !uniqueIds(value.logIds, 'operation_logs') || !value.logIds.length)
    fail()
  if (command.action.kind === 'confirm-actual-payment') {
    if (!isPayrollSourceIdentity(value.actualEventId, 'payroll_actual_events') || value.adjustmentId !== null || value.outcome !== 'confirmed' || (value.applicationIds as string[]).length !== command.action.payment.applications.length)
      fail()
  }
  else if (command.action.kind === 'confirm-recording-reversal') {
    if (!isPayrollSourceIdentity(value.actualEventId, 'payroll_actual_events') || value.adjustmentId !== null || value.outcome !== 'confirmed')
      fail()
  }
  else {
    if (!isPayrollSourceIdentity(value.adjustmentId, 'payroll_adjustments') || value.actualEventId !== null || (value.applicationIds as string[]).length || value.outcome !== (command.action.kind === 'save-adjustment-draft' ? 'saved' : 'confirmed'))
      fail()
    if ('adjustmentId' in command.target && (command.target.adjustmentId === null ? value.originalStatementId !== command.target.originalStatementId : value.adjustmentId !== command.target.adjustmentId))
      fail()
  }
  return value as unknown as PayrollAdjustmentCommandResult
}
