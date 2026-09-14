import type { PayrollAdjustmentBalance, PayrollOriginalWageRef } from './central-adjustment-contract'
import type { PayrollQuery, PayrollSourceDiagnostic, PayrollWritableContext } from './central-contract'

export interface PayrollSignedAmount {
  value: number | null
  knownValue: number | null
  state: 'known' | 'partial' | 'unknown'
  reasons: string[]
}
export type PayrollActualRef = { kind: 'released-statement', statementId: string } | { kind: 'actual-event', eventId: string }
export interface PayrollProofRef { kind: 'frozen-source' | 'adjustment-confirmation' | 'actual-confirmation', id: string, sourceFingerprint: string }
export interface PayrollActualAllocation {
  workerId: string
  workerName: string | null
  crewId: string | null
  amount: number | null
  proofRefs: PayrollProofRef[]
}
export interface PayrollActualFact {
  identity: string
  ref: PayrollActualRef
  kind: 'initial-release' | 'supplement' | 'refund' | 'recording-reversal'
  projectId: string
  originalStatementIds: string[]
  adjustmentIds: string[]
  applicationIds: string[]
  reverses: PayrollActualRef | null
  occurredOn: string | null
  recordedAt: string | null
  signedAmount: PayrollSignedAmount
  allocations: PayrollActualAllocation[]
  allocationState: 'complete' | 'partial' | 'unknown'
  historicalMembers: Array<{ workerId: string, crewId: string | null, name: string | null }>
  qualification: 'proven' | 'historical-amount-proven' | 'unproven'
  sourceVersion: string
  diagnostics: PayrollSourceDiagnostic[]
}
export interface PayrollActualFacts {
  sourceVersion: string
  status: 'complete' | 'partial' | 'forbidden' | 'unavailable'
  rows: PayrollActualFact[]
  netAmount: PayrollSignedAmount
  diagnostics: PayrollSourceDiagnostic[]
}
export interface PayrollActualScope { projectId: string, originalStatementIds?: string[] }
export interface PayrollActualLedgerRead extends PayrollActualFacts { context: PayrollWritableContext, scope: PayrollActualScope }
export interface PayrollActualRepository {
  actualLedger: (query: PayrollQuery, scope: PayrollActualScope) => Promise<PayrollActualLedgerRead>
  actualPaymentForm: (query: PayrollQuery, input: PayrollActualPaymentFormInput) => Promise<PayrollActualPaymentFormRead>
  actualPaymentDetail: (query: PayrollQuery, eventId: string) => Promise<PayrollActualPaymentDetailRead>
  actualReversalForm: (query: PayrollQuery, input: PayrollActualReversalFormInput) => Promise<PayrollActualReversalFormRead>
}

export interface PayrollActualPaymentTarget { kind: 'actual-payment', draftKey: string, adjustmentIds: readonly string[] }
export interface PayrollActualPaymentDraft {
  kind: 'supplement' | 'refund'
  occurredOn: string
  amount: number | null
  evidenceNote: string
  allocations: Array<{ workerId: string, amount: number | null }>
  applications: Array<{ adjustmentId: string, amount: number | null, balanceVersion: string }>
}
export interface PayrollActualPaymentFormInput { target: PayrollActualPaymentTarget, draft?: PayrollActualPaymentDraft }
export interface PayrollActualPaymentFormRead {
  context: PayrollWritableContext
  target: PayrollActualPaymentTarget
  originals: PayrollOriginalWageRef[]
  balances: PayrollAdjustmentBalance[]
  draft: PayrollActualPaymentDraft
  eligibility: { canConfirmActual: boolean, reasons: string[] }
}
export interface PayrollActualPaymentSnapshot {
  schemaVersion: 1
  id: string
  commandId: string
  projectId: string
  originals: PayrollOriginalWageRef[]
  draft: PayrollActualPaymentDraft
  applicationIds: string[]
  confirmedBy: string
  confirmedAt: string
}
export interface PayrollActualPaymentDetailRead { context: PayrollWritableContext, fact: PayrollActualFact, snapshot: PayrollActualPaymentSnapshot | PayrollActualReversalSnapshot }
export interface PayrollActualReversalTarget { kind: 'recording-reversal', draftKey: string, original: PayrollActualRef }
export interface PayrollActualReversalDraft { confirmedNotOccurred: boolean, confirmedOn: string, evidenceNote: string }
export interface PayrollReversalApplication { originalApplicationId: string, adjustmentId: string, rootAdjustmentId: string, amount: number, balanceVersion: string }
export interface PayrollActualReversalFormInput { target: PayrollActualReversalTarget, draft?: PayrollActualReversalDraft }
export interface PayrollActualReversalFormRead {
  context: PayrollWritableContext
  target: PayrollActualReversalTarget
  originalFact: PayrollActualFact
  originals: PayrollOriginalWageRef[]
  draft: PayrollActualReversalDraft
  reversalAmount: PayrollSignedAmount
  applications: PayrollReversalApplication[]
  alreadyReversedBy: string[]
  eligibility: { canConfirmReversal: boolean, reasons: string[] }
}
export interface PayrollActualReversalSnapshot {
  schemaVersion: 1
  kind: 'recording-reversal'
  id: string
  commandId: string
  projectId: string
  originalFact: PayrollActualFact
  originals: PayrollOriginalWageRef[]
  draft: PayrollActualReversalDraft
  applications: PayrollReversalApplication[]
  applicationIds: string[]
  confirmedBy: string
  confirmedAt: string
}
