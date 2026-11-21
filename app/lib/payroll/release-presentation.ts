import type { PayrollC1FormRead, PayrollC1ReleaseDraft } from './central-c1-contract'
import type { PayrollC2FormRead, PayrollC2ReleaseDraft } from './central-c2-contract'
import { payrollHollowAllowsZeroRelease } from './central-hollow-deduction-release'
import { amountInCents } from './statements'

export type PayrollTierReleaseRead = PayrollC1FormRead | PayrollC2FormRead
export type PayrollTierReleaseDraft = PayrollC1ReleaseDraft | PayrollC2ReleaseDraft

export function payrollInputNumber(value: string): number | null {
  return value.trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value)
}

export function payrollReleaseDefault(read: PayrollTierReleaseRead): PayrollTierReleaseDraft {
  const actualAmount = read.totals.grossAmount.value
  return { actualAmount, allocations: read.members.map(member => ({ workerId: member.id, amount: member.id === read.draft.leaderWorkerId ? actualAmount : 0 })) }
}
export function payrollReleaseError(read: PayrollTierReleaseRead, draft: PayrollTierReleaseDraft): string {
  const valid = (value: number | null): value is number => value !== null && Number.isFinite(value) && value >= 0 && Math.abs(value * 100 - amountInCents(value)) < 0.000001
  const zeroAllowed = read.eligibility.canRelease && payrollHollowAllowsZeroRelease(read.hollow?.snapshot)
  if (!valid(draft.actualAmount) || (draft.actualAmount === 0 && !zeroAllowed))
    return '请填写大于零、精确到分的实际发放金额。'
  if (read.members.length !== draft.allocations.length || new Set(draft.allocations.map(row => row.workerId)).size !== read.members.length || draft.allocations.some(row => !read.members.some(member => member.id === row.workerId)))
    return '请保留本次全部成员，包含零金额成员。'
  if (draft.allocations.some(row => !valid(row.amount)))
    return '请填写每位成员的收款金额，零收款请明确填 0。'
  const difference = amountInCents(draft.actualAmount) - draft.allocations.reduce((sum, row) => sum + amountInCents(row.amount!), 0)
  return difference ? `成员分配与实际总额相差 ${(Math.abs(difference) / 100).toFixed(2)} 元。` : ''
}
