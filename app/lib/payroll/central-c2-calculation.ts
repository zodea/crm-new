import type { PayrollC2Amount, PayrollC2ConfigFact, PayrollC2Line } from './central-c2-contract'
import type { PayrollDayworkFact } from './central-daywork-contract'
import { rounded } from './statements'

/** C2 逐人合计真实整工/半工，金额按分；没有累计或前月抵扣。 */
export function payrollC2Lines(facts: PayrollDayworkFact[], config: PayrollC2ConfigFact | null, members: Array<{ workerId: string, workerName: string | null }>): PayrollC2Line[] {
  return members.flatMap((member) => {
    const rows = facts.filter(f => f.workerId === member.workerId).sort((a, b) => a.id.localeCompare(b.id))
    if (!rows.length)
      return []
    const quantity = rows.reduce((sum, row) => sum + (row.laborUnits ?? 0), 0)
    const unitPrice = config?.unitRate ?? null
    return [{ id: `${member.workerId}:daywork`, workerId: member.workerId, workerName: member.workerName, kind: 'daywork' as const, itemName: '零星签工', quantity, unit: '工' as const, unitPrice, amount: unitPrice === null ? null : rounded(quantity * unitPrice), dayworkIds: rows.map(r => r.id) }]
  })
}
export function payrollC2Amount(lines: PayrollC2Line[], reasons: string[] = []): PayrollC2Amount {
  const known = lines.filter(l => l.amount !== null)
  const complete = known.length === lines.length && reasons.length === 0 && lines.length > 0
  const knownValue = known.length ? rounded(known.reduce((sum, l) => sum + l.amount!, 0)) : null
  return { value: complete ? knownValue : null, knownValue, state: complete ? 'known' : known.length ? 'partial' : 'unknown', reasons: [...new Set(reasons)] }
}
