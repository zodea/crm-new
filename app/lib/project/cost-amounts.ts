import type { TargetCostMetric } from '../target-cost/central-contract'
import { round2 } from '../util/number'

export const COST_AMOUNT_FIELDS = ['targetAmount', 'signedAmount', 'settledAmount', 'paidAmount', 'remainingAmount'] as const
export type CostAmountField = typeof COST_AMOUNT_FIELDS[number]
export type CostAmountMetrics = Record<CostAmountField, TargetCostMetric>

/** SQLite absence and damaged values are unknown; an explicitly stored zero is known. */
export function costAmount(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string')
    return null
  if (typeof value === 'string' && !value.trim())
    return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function missingCostAmount(source: string): TargetCostMetric {
  return { value: null, knownValue: null, status: 'pending', missingSources: [source] }
}

export function sumCostAmounts(values: readonly unknown[], source: string): TargetCostMetric {
  const amounts = values.map(costAmount)
  const known = amounts.filter((value): value is number => value !== null)
  const sum = round2(known.reduce((total, value) => total + value, 0))
  if (known.length === amounts.length)
    return { value: sum, knownValue: sum, status: 'complete', missingSources: [] }
  return { value: null, knownValue: known.length ? sum : null, status: known.length ? 'partial' : 'pending', missingSources: [source] }
}

export function sumCostMetrics(metrics: readonly TargetCostMetric[]): TargetCostMetric {
  const missingSources = [...new Set(metrics.flatMap(metric => metric.missingSources))]
  const known = metrics.flatMap(metric => metric.knownValue === null ? [] : [metric.knownValue])
  const sum = round2(known.reduce((total, value) => total + value, 0))
  if (metrics.every(metric => metric.status === 'complete'))
    return { value: sum, knownValue: sum, status: 'complete', missingSources: [] }
  return { value: null, knownValue: known.length ? sum : null, status: known.length ? 'partial' : 'pending', missingSources }
}

export function remainingCostAmount(target: TargetCostMetric, actual: TargetCostMetric): TargetCostMetric {
  if (target.status === 'complete' && actual.status === 'complete' && target.value !== null && actual.value !== null) {
    const value = round2(target.value - actual.value)
    return { value, knownValue: value, status: 'complete', missingSources: [] }
  }
  return { value: null, knownValue: null, status: 'pending', missingSources: [...new Set([...target.missingSources, ...actual.missingSources])] }
}
