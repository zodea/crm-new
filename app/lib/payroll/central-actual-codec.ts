import type { PayrollActualFact, PayrollActualPaymentSnapshot, PayrollActualRef, PayrollActualReversalSnapshot, PayrollProofRef, PayrollSignedAmount } from './central-actual-contract'
import type { PayrollSourceIdentityTable } from './migration-identity'
import { assertPayrollActualDraft } from './central-actual-validation'
import { isPayrollOriginalWageRef } from './central-adjustment-codec'
import { wireCent, wireExact, wireId, wireNullableNumber, wireObject, wireStrings, wireText } from './central-payroll-wire'
import { assertPayrollReversalDraft } from './central-reversal-validation'
import { isPayrollSourceIdentity } from './migration-identity'
import { amountInCents } from './statements'

export const payrollUniqueIds = (v: unknown, table?: PayrollSourceIdentityTable): v is string[] => Array.isArray(v) && v.every(id => table ? isPayrollSourceIdentity(id, table) : wireId(id)) && new Set(v).size === v.length
export function isPayrollSignedAmount(v: unknown): v is PayrollSignedAmount {
  try {
    wireExact(v, ['value', 'knownValue', 'state', 'reasons'])
    if (![v.value, v.knownValue].every(n => n === null || (typeof n === 'number' && wireCent(Math.abs(n)))) || !wireStrings(v.reasons))
      return false
    return v.state === 'known' ? v.value !== null && v.value === v.knownValue && !v.reasons.length : v.value === null && (v.state === 'partial' ? v.knownValue !== null : v.state === 'unknown' && v.knownValue === null)
  }
  catch { return false }
}
export function isPayrollProofRef(v: unknown): v is PayrollProofRef {
  try {
    wireExact(v, ['kind', 'id', 'sourceFingerprint'])
    return (v.kind === 'frozen-source' ? isPayrollSourceIdentity(v.id, 'wage_statements') : v.kind === 'adjustment-confirmation' ? isPayrollSourceIdentity(v.id, 'payroll_adjustments') : v.kind === 'actual-confirmation' && isPayrollSourceIdentity(v.id, 'payroll_actual_events')) && wireText(v.sourceFingerprint) && !!v.sourceFingerprint
  }
  catch { return false }
}
export function isPayrollActualRef(v: unknown): v is PayrollActualRef {
  try {
    if (!wireObject(v))
      return false
    wireExact(v, v.kind === 'released-statement' ? ['kind', 'statementId'] : ['kind', 'eventId'])
    return v.kind === 'released-statement' ? isPayrollSourceIdentity(v.statementId, 'wage_statements') : v.kind === 'actual-event' && isPayrollSourceIdentity(v.eventId, 'payroll_actual_events')
  }
  catch { return false }
}
export function isPayrollSourceDiagnostics(v: unknown) {
  return Array.isArray(v) && v.every(d => wireObject(d) && wireText(d.code) && wireText(d.message) && ['recordId', 'workerId', 'field', 'tableName', 'entityId', 'legacyRecordId'].every(k => d[k] === null || wireText(d[k])))
}
export function isPayrollActualFact(v: unknown): v is PayrollActualFact {
  try {
    wireExact(v, ['identity', 'ref', 'kind', 'projectId', 'originalStatementIds', 'adjustmentIds', 'applicationIds', 'reverses', 'occurredOn', 'recordedAt', 'signedAmount', 'allocations', 'allocationState', 'historicalMembers', 'qualification', 'sourceVersion', 'diagnostics'])
    if (!isPayrollActualRef(v.ref) || !wireId(v.projectId) || !payrollUniqueIds(v.originalStatementIds, 'wage_statements') || !v.originalStatementIds.length || !payrollUniqueIds(v.adjustmentIds, 'payroll_adjustments') || !payrollUniqueIds(v.applicationIds, 'payroll_adjustment_applications') || !(v.reverses === null || isPayrollActualRef(v.reverses)) || ![v.occurredOn, v.recordedAt].every(t => t === null || wireText(t)) || !isPayrollSignedAmount(v.signedAmount) || !Array.isArray(v.allocations) || !Array.isArray(v.historicalMembers) || !['complete', 'partial', 'unknown'].includes(String(v.allocationState)) || !['proven', 'historical-amount-proven', 'unproven'].includes(String(v.qualification)) || !wireText(v.sourceVersion) || !v.sourceVersion || !isPayrollSourceDiagnostics(v.diagnostics))
      return false
    if (v.ref.kind === 'released-statement' ? v.identity !== `real:payroll:released:${v.ref.statementId}` || v.kind !== 'initial-release' || v.reverses !== null || v.originalStatementIds.length !== 1 || v.originalStatementIds[0] !== v.ref.statementId : v.identity !== `real:payroll:actual:${v.ref.eventId}` || !['supplement', 'refund', 'recording-reversal'].includes(String(v.kind)))
      return false
    if (v.kind === 'recording-reversal' ? v.reverses === null : v.reverses !== null)
      return false
    if (v.kind === 'refund' && (v.signedAmount.value === null || v.signedAmount.value >= 0))
      return false
    if (v.kind === 'supplement' && (v.signedAmount.value === null || v.signedAmount.value <= 0))
      return false
    for (const member of v.historicalMembers) {
      wireExact(member, ['workerId', 'crewId', 'name'])
      if (!wireId(member.workerId) || !(member.crewId === null || wireId(member.crewId)) || !(member.name === null || wireText(member.name)))
        return false
    }
    for (const allocation of v.allocations) {
      wireExact(allocation, ['workerId', 'workerName', 'crewId', 'amount', 'proofRefs'])
      if (!wireId(allocation.workerId) || !(allocation.workerName === null || wireText(allocation.workerName)) || !(allocation.crewId === null || wireId(allocation.crewId)) || !wireNullableNumber(allocation.amount) || (allocation.amount !== null && !wireCent(Math.abs(Number(allocation.amount)))) || !Array.isArray(allocation.proofRefs) || !allocation.proofRefs.length || !allocation.proofRefs.every(isPayrollProofRef))
        return false
    }
    const fact = v as unknown as PayrollActualFact
    if (new Set(fact.allocations.map(a => a.workerId)).size !== fact.allocations.length)
      return false
    if (fact.qualification === 'proven' && (fact.signedAmount.value === null || fact.allocationState !== 'complete'))
      return false
    return fact.allocationState !== 'complete' || (fact.signedAmount.value !== null && fact.allocations.every(a => a.amount !== null) && fact.allocations.reduce((sum, a) => sum + amountInCents(a.amount!), 0) === amountInCents(fact.signedAmount.value))
  }
  catch { return false }
}
export function isPayrollActualSnapshot(v: unknown): v is PayrollActualPaymentSnapshot | PayrollActualReversalSnapshot {
  try {
    if (!wireObject(v))
      return false
    const reversal = v.kind === 'recording-reversal'
    wireExact(v, reversal ? ['schemaVersion', 'kind', 'id', 'commandId', 'projectId', 'originalFact', 'originals', 'draft', 'applications', 'applicationIds', 'confirmedBy', 'confirmedAt'] : ['schemaVersion', 'id', 'commandId', 'projectId', 'originals', 'draft', 'applicationIds', 'confirmedBy', 'confirmedAt'])
    if (v.schemaVersion !== 1 || !isPayrollSourceIdentity(v.id, 'payroll_actual_events') || !isPayrollSourceIdentity(v.commandId, 'payroll_command_receipts') || ![v.projectId, v.confirmedBy].every(wireId) || !wireText(v.confirmedAt) || !Array.isArray(v.originals) || !v.originals.length || !v.originals.every(isPayrollOriginalWageRef) || v.originals.some(o => o.projectId !== v.projectId) || !payrollUniqueIds(v.applicationIds, 'payroll_adjustment_applications'))
      return false
    if (v.originals.some(o => o.book !== undefined) && new Set(v.originals.map(o => JSON.stringify([o.crewId, o.leaderWorkerId, o.formatFamily, o.book?.bookPurpose ?? 'ordinary', o.book?.managementBookId ?? null]))).size !== 1)
      return false
    if (reversal) {
      assertPayrollReversalDraft(v.draft)
      if (!v.draft.confirmedNotOccurred || !v.draft.evidenceNote.trim() || !isPayrollActualFact(v.originalFact) || v.originalFact.projectId !== v.projectId || !Array.isArray(v.applications) || v.applications.length !== v.applicationIds.length)
        return false
      for (const application of v.applications) {
        wireExact(application, ['originalApplicationId', 'adjustmentId', 'rootAdjustmentId', 'amount', 'balanceVersion'])
        if (!isPayrollSourceIdentity(application.originalApplicationId, 'payroll_adjustment_applications') || ![application.adjustmentId, application.rootAdjustmentId].every(id => isPayrollSourceIdentity(id, 'payroll_adjustments')) || typeof application.amount !== 'number' || !wireCent(Math.abs(application.amount)) || !wireText(application.balanceVersion))
          return false
      }
    }
    else {
      assertPayrollActualDraft(v.draft)
      if (v.draft.amount === null || !wireCent(Math.abs(v.draft.amount)) || v.draft.amount * (v.draft.kind === 'refund' ? -1 : 1) <= 0 || v.draft.applications.length !== v.applicationIds.length || v.draft.allocations.some(a => a.amount === null) || v.draft.applications.some(a => a.amount === null))
        return false
      if (v.draft.allocations.reduce((sum, a) => sum + amountInCents(a.amount!), 0) !== amountInCents(v.draft.amount) || v.draft.applications.reduce((sum, a) => sum + amountInCents(a.amount!), 0) !== amountInCents(v.draft.amount))
        return false
    }
    return true
  }
  catch { return false }
}
