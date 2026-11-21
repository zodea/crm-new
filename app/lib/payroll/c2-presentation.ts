import type { PayrollC2Draft } from './central-c2-contract'
import type { PayrollDayworkRecordDraft } from './central-daywork-contract'

export { payrollInputNumber as c2InputNumber } from './release-presentation'

export function c2Draft(value: Partial<PayrollC2Draft>): PayrollC2Draft {
  return { projectId: value.projectId || '', crewId: value.crewId ?? null, month: value.month || '', leaderWorkerId: value.leaderWorkerId || '', memberWorkerIds: [...value.memberWorkerIds || []], note: value.note || '' }
}
export function dayworkDraft(value: Partial<PayrollDayworkRecordDraft>): PayrollDayworkRecordDraft {
  return { projectId: value.projectId || '', crewId: value.crewId ?? null, workerId: value.workerId || '', workDate: value.workDate || '', workContent: value.workContent ?? '', startTime: value.startTime ?? '', endTime: value.endTime ?? '', laborUnits: value.laborUnits ?? null, witness: value.witness ?? '', confirmedOn: value.confirmedOn ?? null, status: value.status ?? 'draft', note: value.note ?? '' }
}
export function c2Number(value: number | null | undefined): string {
  return value == null ? '未记录' : String(value)
}
export function dayworkState(value: string | null): string {
  return value === 'confirmed' ? '已确认' : value === 'draft' ? '待确认' : value == null ? '状态未记录' : `原状态：${value}`
}
export function payrollC2Lookup(rows: { id: string, name: string | null }[]) {
  return async (keyword: string) => rows.filter(row => `${row.name || ''} ${row.id}`.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase())).map(row => ({ id: row.id, label: row.name || '名称未记录' }))
}
