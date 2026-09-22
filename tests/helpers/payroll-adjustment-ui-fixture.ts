import type { PayrollAdjustmentFormRead, PayrollOriginalWageRef } from '~/lib/payroll/central-adjustment-contract'

export const knownPayrollSigned = (value: number) => ({ value, knownValue: value, state: 'known' as const, reasons: [] })
export function payrollAdjustmentOriginal(): PayrollOriginalWageRef {
  return { statementId: 'wage-original', formatFamily: 'C2', projectId: 'project', projectName: '原项目', crewId: 'crew', leaderWorkerId: 'worker', month: '2026-08', memberWorkerIds: ['worker', 'zero'], members: [{ workerId: 'worker', workerName: '原负责人', crewId: 'crew' }, { workerId: 'zero', workerName: '原零收款成员', crewId: 'crew' }], originalSignatureAmount: knownPayrollSigned(1000), originalGrossAmount: knownPayrollSigned(1000), provenanceVersion: 'original-proof' }
}
export function payrollAdjustmentFormRead(version = 'source-1'): PayrollAdjustmentFormRead {
  const basis = { formatFamily: 'C2' as const, configId: 'config', unitRate: 1000, records: [{ recordId: 'daywork', workerId: 'worker', workDate: '2026-08-01', laborUnits: 1, startTime: '08:00', endTime: '17:00', workContent: '原工作', witness: '证明人', confirmedOn: '2026-08-01' }] }
  return { context: { workspaceId: 'workspace', actorId: 'actor', origin: 'real', capabilities: ['payroll:read', 'payroll:write'], readonly: false, sourceVersion: version }, target: { adjustmentId: null, draftKey: 'draft-adjustment', originalStatementId: 'wage-original' }, original: payrollAdjustmentOriginal(), status: 'new', draft: { reason: '', evidenceNote: '', correctsAdjustmentId: null, basis }, preview: { before: basis, after: basis, beforeAmount: knownPayrollSigned(1000), afterAmount: knownPayrollSigned(1000), delta: knownPayrollSigned(0), proofRefs: [], reasons: [] }, eligibility: { canSaveDraft: true, canConfirmAdjustment: false, reasons: [] } }
}
