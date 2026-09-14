import type { PayrollAttendanceFact } from './central-attendance-contract'
import type { PayrollC1Amount, PayrollC1Line, PayrollC1Rate } from './central-c1-contract'
import { rounded } from './statements'

export { payrollCanonical as payrollC1Canonical } from './central-command-shared'

/** 工时和 daily/8 保完整精度，只有最终每人每类金额到分。 */
export function payrollC1Lines(facts: PayrollAttendanceFact[], rates: PayrollC1Rate[]): PayrollC1Line[] {
  return rates.flatMap((rate) => {
    const rows = facts.filter(f => f.workerId === rate.workerId)
    return (['normal', 'overtime'] as const).map((kind) => {
      const quantity = rows.reduce((sum, row) => sum + (kind === 'normal' ? row.hours ?? 0 : row.overtimeHours ?? 0), 0)
      const price = kind === 'normal' ? rate.dailyWage === null ? null : rate.dailyWage / 8 : rate.overtimeRate
      return { id: `${rate.workerId}:${kind}`, workerId: rate.workerId, workerName: rate.workerName, kind, itemName: kind === 'normal' ? '正常工时' : '加班工时', quantity, unit: '小时' as const, unitPrice: price, amount: price === null ? null : rounded(quantity * price), attendanceIds: rows.map(r => r.id) }
    })
  })
}
export function payrollC1Amount(lines: PayrollC1Line[], reasons: string[] = []): PayrollC1Amount {
  const known = lines.filter(line => line.amount !== null)
  const complete = known.length === lines.length && reasons.length === 0
  const knownValue = known.length || complete ? rounded(known.reduce((sum, line) => sum + line.amount!, 0)) : null
  return { value: complete ? knownValue : null, knownValue, state: complete ? 'known' : known.length ? 'partial' : 'unknown', reasons: [...new Set(reasons)] }
}
