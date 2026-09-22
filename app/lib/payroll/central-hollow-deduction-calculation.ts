import type { PayrollAAmount } from './central-a-contract'
import { payrollAAmount } from './central-a-calculation'
import { amountInCents } from './statements'

export interface PayrollHollowCalculationInput {
  formatFamily: 'A' | 'C1' | 'C2'
  /** 原格式已形成的本次请款合计，含原比例及真实已领，不含空鼓扣款。 */
  claimSubtotal: PayrollAAmount
  /** 同簿此前已完整处理的有效扣款，独立于实际现金；只有A累计核算消费。 */
  previousProcessed: PayrollAAmount
  /** 本单明确启动、服务端完整核实的当前扣款；未启动明确为0。 */
  currentDeduction: PayrollAAmount
}

export interface PayrollHollowTotals extends Omit<PayrollHollowCalculationInput, 'formatFamily'> {
  availableBeforeDeduction: PayrollAAmount
  grossAmount: PayrollAAmount
  reasons: string[]
}

/** 不决定处数分配或是否采用。只组合已经独立证明的金额，部分处理不猜规则。 */
export function calculatePayrollHollowTotals(input: PayrollHollowCalculationInput): PayrollHollowTotals {
  const base = { claimSubtotal: input.claimSubtotal, previousProcessed: input.previousProcessed, currentDeduction: input.currentDeduction }
  const amounts = [input.claimSubtotal, input.currentDeduction, ...(input.formatFamily === 'A' ? [input.previousProcessed] : [])]
  const reasons = [...new Set(amounts.flatMap(amount => amount.reasons))]
  if (amounts.some(amount => amount.state !== 'known' || amount.value === null || !Number.isFinite(amount.value))) {
    reasons.push('本次请款或空鼓处理依据未完整核实')
    const unknown = payrollAAmount([null], reasons)
    return { ...base, availableBeforeDeduction: unknown, grossAmount: unknown, reasons }
  }
  const previousFen = input.formatFamily === 'A' ? amountInCents(input.previousProcessed.value!) : 0
  const deductionFen = amountInCents(input.currentDeduction.value!)
  if (previousFen < 0 || deductionFen < 0) {
    reasons.push('空鼓扣款与已处理金额不得为负数')
    const unknown = payrollAAmount([null], reasons)
    return { ...base, availableBeforeDeduction: unknown, grossAmount: unknown, reasons }
  }
  const availableFen = Math.max(0, amountInCents(input.claimSubtotal.value!) - previousFen)
  const availableBeforeDeduction = payrollAAmount([availableFen / 100])
  if (deductionFen > availableFen) {
    reasons.push('本次请款不足以完整处理这些空鼓；部分处理规则尚待明确，请保留原来源')
    return { ...base, availableBeforeDeduction, grossAmount: payrollAAmount([null], reasons), reasons }
  }
  return { ...base, availableBeforeDeduction, grossAmount: payrollAAmount([(availableFen - deductionFen) / 100]), reasons }
}
