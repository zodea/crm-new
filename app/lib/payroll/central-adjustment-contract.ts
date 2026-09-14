import type { PayrollAPeriodKind } from './central-a-contract'
import type { PayrollABookRef, PayrollAFeeAdjustmentBasis, PayrollAStatementSourceVersioned } from './central-a-fees-contract'
import type { PayrollActualFact, PayrollActualPaymentDraft, PayrollActualPaymentTarget, PayrollActualReversalDraft, PayrollActualReversalTarget, PayrollProofRef, PayrollSignedAmount } from './central-actual-contract'
import type { PayrollQuery, PayrollWritableContext } from './central-contract'
import type { PayrollReleaseAdjustmentPreview } from './central-release-adjustment-contract'

export interface PayrollOriginalWageRef {
  statementId: string
  formatFamily: 'A' | 'C1' | 'C2'
  projectId: string
  projectName: string | null
  crewId: string | null
  leaderWorkerId: string
  month: string
  memberWorkerIds: string[]
  members: Array<{ workerId: string, workerName: string | null, crewId: string | null }>
  originalSignatureAmount: PayrollSignedAmount
  originalGrossAmount: PayrollSignedAmount
  provenanceVersion: string
  /** 仅新 A V2 已证来源携带；旧原单引用保留原 JSON。 */
  book?: PayrollABookRef
}
export interface PayrollC2AdjustmentBasis {
  formatFamily: 'C2'
  configId: string
  unitRate: number | null
  records: Array<{ recordId: string, workerId: string, workDate: string, laborUnits: number | null, startTime: string, endTime: string, workContent: string, witness: string, confirmedOn: string }>
}
export interface PayrollC1AdjustmentBasis {
  formatFamily: 'C1'
  rates: Array<{ workerId: string, configId: string | null, dailyWage: number | null, overtimeRate: number | null, overtimeRule: 'daily-divided-eight' | 'explicit' }>
  records: Array<{ recordId: string, workerId: string, workDate: string, hours: number | null, overtimeHours: number | null, workContent: string }>
}
export interface PayrollAAdjustmentBasis {
  formatFamily: 'A'
  periodKind: PayrollAPeriodKind
  source: PayrollAStatementSourceVersioned
  payRatio: number | null
  components: Array<{ ownershipKey: string, priceRevisionId: string, quantity: number | null, unitPrice: number | null }>
  /** source V2 必须有同簿费用依据；V1 不补写此字段。 */
  fees?: PayrollAFeeAdjustmentBasis
}
export type PayrollAdjustmentBasisDraft = PayrollAAdjustmentBasis | PayrollC1AdjustmentBasis | PayrollC2AdjustmentBasis
export interface PayrollAdjustmentDraft {
  reason: string
  evidenceNote: string
  correctsAdjustmentId: string | null
  basis: PayrollAdjustmentBasisDraft | null
}
export type PayrollAdjustmentTarget = { adjustmentId: string } | { adjustmentId: null, draftKey: string, originalStatementId: string }
export interface PayrollAdjustmentFormInput { target: PayrollAdjustmentTarget, draft?: PayrollAdjustmentDraft }
export interface PayrollAdjustmentPreview {
  before: PayrollAdjustmentBasisDraft | null
  after: PayrollAdjustmentBasisDraft | null
  beforeAmount: PayrollSignedAmount
  afterAmount: PayrollSignedAmount
  delta: PayrollSignedAmount
  proofRefs: PayrollProofRef[]
  reasons: string[]
}
export interface PayrollAdjustmentEligibility { canSaveDraft: boolean, canConfirmAdjustment: boolean, reasons: string[] }
export interface PayrollAdjustmentFormRead {
  context: PayrollWritableContext
  target: PayrollAdjustmentTarget
  original: PayrollOriginalWageRef
  status: 'new' | 'draft' | 'confirmed'
  draft: PayrollAdjustmentDraft
  preview: PayrollAdjustmentPreview
  eligibility: PayrollAdjustmentEligibility
}
export interface PayrollAdjustmentConfirmedSnapshot {
  schemaVersion: 1
  id: string
  rootAdjustmentId: string
  correctsAdjustmentId: string | null
  original: PayrollOriginalWageRef
  reason: string
  evidenceNote: string
  preview: PayrollAdjustmentPreview
  confirmedBy: string
  confirmedAt: string
  commandId: string
}
export interface PayrollAdjustmentRecord {
  id: string
  rootAdjustmentId: string
  originalStatementId: string
  projectId: string
  status: 'draft' | 'confirmed'
  draft: PayrollAdjustmentDraft
  delta: number | null
  snapshot: PayrollAdjustmentConfirmedSnapshot | null
}
export interface PayrollAdjustmentBalance {
  adjustmentId: string
  rootAdjustmentId: string
  confirmedDelta: PayrollSignedAmount
  appliedDelta: PayrollSignedAmount
  remainingDelta: PayrollSignedAmount
  balanceVersion: string
  applicationIds: string[]
}
export interface PayrollAdjustmentDetailRead {
  context: PayrollWritableContext
  original: PayrollOriginalWageRef
  adjustment: PayrollAdjustmentRecord
  balance: PayrollAdjustmentBalance
  applications: PayrollAdjustmentApplicationHistory[]
}
/** 处理金额解释余额；fact 是其真实收付来源，不能把两者相加。 */
export interface PayrollAdjustmentApplicationHistory {
  id: string
  adjustmentId: string
  rootAdjustmentId: string
  kind: 'actual-payment' | 'later-release' | 'recording-reversal'
  appliedDelta: PayrollSignedAmount
  fact: PayrollActualFact | null
  reversesApplicationId: string | null
  reasons: string[]
}
export interface PayrollAdjustmentHistoryRead {
  context: PayrollWritableContext
  original: PayrollOriginalWageRef
  adjustments: Array<{ adjustment: PayrollAdjustmentRecord, balance: PayrollAdjustmentBalance }>
  applications: PayrollAdjustmentApplicationHistory[]
}
export type PayrollAdjustmentAction = { kind: 'save-adjustment-draft', draft: PayrollAdjustmentDraft } | { kind: 'confirm-adjustment' }
export interface PayrollCorrectionCommand {
  commandId: string
  workspaceId: string
  actorId: string
  origin: 'real' | 'demo'
  requiredCapability: 'payroll:write'
  sourceVersion: string
  projectId: string
  target: PayrollAdjustmentTarget
  action: PayrollAdjustmentAction
}
export interface PayrollAdjustmentCommandResult {
  commandId: string
  projectId: string
  originalStatementId: string
  adjustmentId: string | null
  actualEventId: string | null
  applicationIds: string[]
  outcome: 'saved' | 'confirmed'
  sourceVersion: string
  logIds: string[]
}
export interface PayrollActualPaymentCommand extends Omit<PayrollCorrectionCommand, 'target' | 'action'> {
  target: PayrollActualPaymentTarget
  action: { kind: 'confirm-actual-payment', payment: PayrollActualPaymentDraft }
}
export interface PayrollActualReversalCommand extends Omit<PayrollCorrectionCommand, 'target' | 'action'> {
  target: PayrollActualReversalTarget
  action: { kind: 'confirm-recording-reversal', reversal: PayrollActualReversalDraft }
}
export type PayrollAdjustmentCommand = PayrollCorrectionCommand | PayrollActualPaymentCommand | PayrollActualReversalCommand
export interface PayrollAdjustmentRepository {
  adjustmentHistory: (query: PayrollQuery, originalStatementId: string) => Promise<PayrollAdjustmentHistoryRead>
  releaseAdjustmentPreview: (query: PayrollQuery, input: { statementId: string }) => Promise<PayrollReleaseAdjustmentPreview>
  adjustmentForm: (query: PayrollQuery, input: PayrollAdjustmentFormInput) => Promise<PayrollAdjustmentFormRead>
  adjustmentDetail: (query: PayrollQuery, adjustmentId: string) => Promise<PayrollAdjustmentDetailRead>
  executeAdjustment: (command: PayrollAdjustmentCommand) => Promise<PayrollAdjustmentCommandResult>
}
