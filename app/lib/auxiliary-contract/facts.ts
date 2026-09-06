import type { MoneyDTO } from '../../types/read-model'
import type { AuxiliaryContractFact } from './contract'
import { coreMigrationCentsToMoney, coreMigrationMoneyToCents } from '../migration/core-contract'

export function sumAuxiliaryMoney(values: Array<MoneyDTO | null>): MoneyDTO | null {
  return values.includes(null) ? null : coreMigrationCentsToMoney(values.reduce<bigint>((sum, value) => sum + coreMigrationMoneyToCents(value!), BigInt(0)))
}
export function subtractAuxiliaryMoney(left: MoneyDTO | null, right: MoneyDTO | null): MoneyDTO | null {
  return left === null || right === null ? null : coreMigrationCentsToMoney(coreMigrationMoneyToCents(left) - coreMigrationMoneyToCents(right))
}
export function auxiliaryTaxExclusive(amount: MoneyDTO | null, taxRate: number | null): MoneyDTO | null {
  if (amount === null || taxRate === null)
    return null
  const denominator = BigInt(10000 + Math.round(taxRate * 100))
  const numerator = coreMigrationMoneyToCents(amount) * BigInt(10000)
  return coreMigrationCentsToMoney((numerator + denominator / BigInt(2)) / denominator)
}
export function sumAuxiliaryFacts(facts: AuxiliaryContractFact[], kind: AuxiliaryContractFact['kind']) {
  return sumAuxiliaryMoney(facts.filter(row => row.kind === kind && row.effective).map(row => row.amount))
}
