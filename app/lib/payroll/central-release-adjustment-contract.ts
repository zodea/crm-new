import type { PayrollWritableContext } from './central-contract'

export interface PayrollReleaseAdjustmentApplication { adjustmentId: string, amount: number, balanceVersion: string, coverageVersion: string }
export interface PayrollReleaseAdjustmentCandidate {
  adjustmentId: string
  rootAdjustmentId: string
  originalStatementId: string
  originalMonth: string
  remainingAmount: number | null
  embeddedInCalculation: number
  additionalWithholding: number | null
  balanceVersion: string
  coverageVersion: string
  eligible: boolean
  reasons: string[]
}
export interface PayrollReleaseAdjustmentPreview {
  context: PayrollWritableContext
  statementId: string
  candidates: PayrollReleaseAdjustmentCandidate[]
  reasons: string[]
}
