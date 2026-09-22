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
  /** 服务端按项目、负责人、格式及普通/管理簿归属生成；不是正式工资序号。 */
  bookKey: string
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
  /** 整单优先后的初分：按权重向下到配置档位或分；基础不完整时为 null。 */
  exactSuggestedAmountFen: number | null
  /** 自动补齐比例尾差后的金额；资金不足的整单及无份额项为 0，保持暂缓。 */
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
