import type { PayrollAAmount, PayrollALine, PayrollAPriceRevision, PayrollAQuantityFact, PayrollASubjectScope } from './central-a-contract'
import { rounded } from './statements'

export function payrollACanonical(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(payrollACanonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${payrollACanonical(entry)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
export const payrollAMoney = rounded
export function payrollAAmount(values: Array<number | null>, reasons: string[] = []): PayrollAAmount {
  const known = values.filter((value): value is number => value !== null)
  const complete = known.length === values.length && reasons.length === 0
  const knownValue = known.length || complete ? payrollAMoney(known.reduce((sum, value) => sum + value, 0)) : null
  return { value: complete ? knownValue : null, knownValue, state: complete ? 'known' : known.length ? 'partial' : 'unknown', reasons: [...new Set(reasons)] }
}
export function payrollAFactInSubject(fact: PayrollAQuantityFact, scope: PayrollASubjectScope) {
  return fact.workerId ? scope.memberWorkerIds.includes(fact.workerId) : fact.crewId !== null && fact.crewId === scope.crewId
}
export function payrollAPriceApplies(price: PayrollAPriceRevision, fact: PayrollAQuantityFact, scope: PayrollASubjectScope, month: string) {
  return price.projectId === scope.projectId && price.crewId === scope.crewId && price.leaderWorkerId === scope.leaderWorkerId
    && price.itemId === fact.itemId && price.unit === fact.unit && price.effectiveMonth <= month
    && (price.mode === 'baseline' || price.workerId === (fact.workerId ?? scope.leaderWorkerId))
    && (price.scope.kind === 'project' || price.scope.cells.some(cell => cell.unitId === fact.unitId && cell.roomId === fact.roomId && cell.itemId === fact.itemId))
}
/** 同一稳定价格先选月份适用修订，再判断范围，不能在新范围以外复活旧版。 */
export function payrollAEffectivePrices(prices: PayrollAPriceRevision[], month: string): PayrollAPriceRevision[] {
  const effective = new Map<string, PayrollAPriceRevision>()
  for (const price of prices) {
    if (price.effectiveMonth > month)
      continue
    const old = effective.get(price.priceId)
    if (!old || old.effectiveMonth < price.effectiveMonth || (old.effectiveMonth === price.effectiveMonth && old.revision < price.revision))
      effective.set(price.priceId, price)
  }
  return [...effective.values()]
}
export function payrollALines(facts: PayrollAQuantityFact[], prices: PayrollAPriceRevision[], scope: PayrollASubjectScope, month: string): PayrollALine[] {
  const grouped = new Map<string, PayrollALine>()
  const effective = payrollAEffectivePrices(prices, month)
  for (const fact of facts) {
    const matching = effective.filter(price => payrollAPriceApplies(price, fact, scope, month))
      .sort((a, b) => Number(b.mode === 'worker-exception') - Number(a.mode === 'worker-exception') || b.effectiveMonth.localeCompare(a.effectiveMonth) || b.revision - a.revision)
    const price = matching[0]
    const workerId = fact.workerId ?? scope.leaderWorkerId
    const key = payrollACanonical([workerId, fact.buildingId, fact.templateId, fact.itemId, fact.unit, price?.id ?? null])
    let line = grouped.get(key)
    if (!line) {
      line = { id: key, workerId, workerName: fact.workerName, itemId: fact.itemId, itemName: [fact.buildingName, fact.templateName, fact.itemName].filter(Boolean).join(' · '), unit: fact.unit, quantity: null, knownQuantity: null, unitPrice: price?.unitPrice ?? null, amount: null, priceRevisionIds: price ? [price.id] : [], facts: [], sources: [], blockers: [] }
      grouped.set(key, line)
    }
    line.facts.push(fact)
  }
  return [...grouped.values()].map((line) => {
    const quantities = line.facts.map(fact => fact.fieldQty)
    const known = quantities.filter((value): value is number => value !== null)
    line.knownQuantity = known.length ? known.reduce((sum, value) => sum + value, 0) : null
    line.quantity = known.length === quantities.length ? line.knownQuantity : null
    line.amount = line.quantity !== null && line.unitPrice !== null ? payrollAMoney(line.quantity * line.unitPrice) : null
    return line
  })
}
