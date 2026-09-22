import type { PayrollC2Draft, PayrollC2FormRead, PayrollC2ReleaseDraft } from './central-c2-contract'
import type { PayrollDayworkRecordDraft } from './central-daywork-contract'
import { payrollHollowAllowsZeroRelease } from './central-hollow-deduction-release'
import { amountInCents } from './statements'

export function c2Draft(value: Partial<PayrollC2Draft>): PayrollC2Draft {
  return { projectId: value.projectId || '', crewId: value.crewId ?? null, month: value.month || '', leaderWorkerId: value.leaderWorkerId || '', memberWorkerIds: [...value.memberWorkerIds || []], note: value.note || '' }
}
export function dayworkDraft(value: Partial<PayrollDayworkRecordDraft>): PayrollDayworkRecordDraft {
  return { projectId: value.projectId || '', crewId: value.crewId ?? null, workerId: value.workerId || '', workDate: value.workDate || '', workContent: value.workContent ?? '', startTime: value.startTime ?? '', endTime: value.endTime ?? '', laborUnits: value.laborUnits ?? null, witness: value.witness ?? '', confirmedOn: value.confirmedOn ?? null, status: value.status ?? 'draft', note: value.note ?? '' }
}
export function c2Number(value: number | null | undefined): string {
  return value == null ? '未记录' : String(value)
}
export function c2InputNumber(value: string): number | null {
  return value.trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value)
}
export function dayworkState(value: string | null): string {
  return value === 'confirmed' ? '已确认' : value === 'draft' ? '待确认' : value == null ? '状态未记录' : `原状态：${value}`
}
export function payrollC2Lookup(rows: { id: string, name: string | null }[]) {
  return async (keyword: string) => rows.filter(row => `${row.name || ''} ${row.id}`.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase())).map(row => ({ id: row.id, label: row.name || '名称未记录' }))
}
export function c2ReleaseDefault(read: PayrollC2FormRead): PayrollC2ReleaseDraft {
  const actualAmount = read.totals.grossAmount.value
  return { actualAmount, allocations: read.members.map(member => ({ workerId: member.id, amount: member.id === read.draft.leaderWorkerId ? actualAmount : 0 })) }
}
export function c2ReleaseError(read: PayrollC2FormRead, draft: PayrollC2ReleaseDraft): string {
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
