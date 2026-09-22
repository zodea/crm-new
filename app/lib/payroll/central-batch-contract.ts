export type PayrollBatchFormat = 'A' | 'C1' | 'C2'

export type PayrollARoundingRule
  = | { kind: 'off' }
    | { kind: 'floor', stepFen: 10_000 }

export type PayrollBatchRounding
  = | { state: 'missing' }
    | {
      state: 'configured'
      rule: PayrollARoundingRule
      revisionId: string
      revision: number
      effectiveMonth: string
      sourceVersion: string
    }
    | { state: 'not-applicable' }

export interface PayrollBatchFundingItemInput {
  itemId: string
  formatFamily: PayrollBatchFormat
  eligibleAmountFen: number | null
  rounding: PayrollBatchRounding
  /** P6 已启动空鼓扣款的工资只能按核准净额整单发放。 */
  requiresFullAmount: boolean
}

export interface PayrollBatchFundingInput {
  fundingAmountFen: number
  items: PayrollBatchFundingItemInput[]
}

export interface PayrollBatchFundingItemSuggestion extends PayrollBatchFundingItemInput {
  /** 按权重及取整规则得到的建议；基础不完整时为 null。 */
  exactSuggestedAmountFen: number | null
  /** 可直接带入批次草稿的值；整单发放受阻时明确为 0。 */
  suggestedAmountFen: number | null
  blockers: string[]
}

export interface PayrollBatchFundingSuggestion {
  state: 'ready' | 'incomplete' | 'blocked'
  fundingAmountFen: number
  eligibleTotalFen: number | null
  distributableFen: number | null
  suggestedTotalFen: number | null
  unallocatedFen: number | null
  overAllocatedFen: number
  items: PayrollBatchFundingItemSuggestion[]
  diagnostics: string[]
}
