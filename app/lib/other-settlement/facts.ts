import type { OtherSettlementFact } from './contract'

export function isEffectiveSettlementFact(fact: OtherSettlementFact): boolean {
  if (!fact.effective)
    return false
  if (fact.kind === 'application')
    return ['submitted', 'approved', 'paying', 'paid'].includes(fact.status)
  if (fact.kind === 'payment')
    return fact.status === 'confirmed'
  return ['executed', 'confirmed', '已执行'].includes(fact.status)
}
