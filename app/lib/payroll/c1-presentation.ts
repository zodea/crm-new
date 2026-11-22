import type { PayrollC1Draft } from './central-c1-contract'

export { payrollInputNumber as c1InputNumber } from './release-presentation'

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
export function c1MonthDays(month: string): string[] {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month))
    return []
  const [year, number] = month.split('-').map(Number)
  return Array.from({ length: new Date(year!, number!, 0).getDate() }, (_, day) => `${month}-${String(day + 1).padStart(2, '0')}`)
}
