import type { PayrollC1Draft, PayrollC1FormRead, PayrollC1ReleaseDraft } from './central-c1-contract'
import { payrollHollowAllowsZeroRelease } from './central-hollow-deduction-release'
import { amountInCents } from './statements'

export interface PayrollAttendanceInput {
  hours: number | null
  overtimeHours: number | null
  workContent: string
  note: string
}

export function c1Draft(value: Partial<PayrollC1Draft>): PayrollC1Draft {
  return { projectId: value.projectId || '', crewId: value.crewId ?? null, month: value.month || '', leaderWorkerId: value.leaderWorkerId || '', memberWorkerIds: [...value.memberWorkerIds || []], note: value.note || '' }
}

export function c1Number(value: number | null | undefined): string {
  return value == null ? '未记录' : String(value)
}
export function c1InputNumber(value: string): number | null {
  return value.trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value)
}
export function c1MonthDays(month: string): string[] {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month))
    return []
  const [year, number] = month.split('-').map(Number)
  return Array.from({ length: new Date(year!, number!, 0).getDate() }, (_, day) => `${month}-${String(day + 1).padStart(2, '0')}`)
}
export function c1ReleaseDefault(read: PayrollC1FormRead): PayrollC1ReleaseDraft {
  const actualAmount = read.totals.grossAmount.value
  return { actualAmount, allocations: read.members.map(member => ({ workerId: member.id, amount: member.id === read.draft.leaderWorkerId ? actualAmount : 0 })) }
}
export function c1ReleaseError(read: PayrollC1FormRead, draft: PayrollC1ReleaseDraft): string {
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
