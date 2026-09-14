import type { PayrollSignedAmount } from './central-actual-contract'
import type { PayrollAAdjustmentBasis } from './central-adjustment-contract'

export interface PayrollAAdjustmentDimension {
  dimension: 'quantity' | 'unit-price' | 'pay-ratio' | 'fee-quantity' | 'fee-unit-price' | 'negative-quantity' | 'negative-unit-price'
  before: number | null
  after: number | null
  current: number | null
  effective: number | null
  state: 'included-in-current-source' | 'needs-independent-effect' | 'unproven'
}
export interface PayrollAAdjustmentCoverage {
  adjustmentId: string
  rootAdjustmentId: string
  originalStatementId: string
  ownershipKey: string
  originalSourceFingerprint: string
  currentSourceFingerprint: string | null
  originalPriceRevisionId: string
  currentPriceRevisionId: string | null
  /** P5 费用/负价专用定位；旧普通量价 coverage 原文不补字段。 */
  feeComponentKey?: string
  negativeLineId?: string
  dimensions: PayrollAAdjustmentDimension[]
  reasons: string[]
}
export interface PayrollAAdjustmentReconciliation {
  sourceVersion: string
  rawBasis: PayrollAAdjustmentBasis
  effectiveBasis: PayrollAAdjustmentBasis
  rawCumulative: PayrollSignedAmount
  effectiveCumulative: PayrollSignedAmount
  actualNet: PayrollSignedAmount
  actualIdentities: string[]
  availableAmount: PayrollSignedAmount
  coverage: PayrollAAdjustmentCoverage[]
  reasons: string[]
}
