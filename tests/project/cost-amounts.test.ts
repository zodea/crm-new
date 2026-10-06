import { expect, it } from 'vitest'
import { costAmount, missingCostAmount, remainingCostAmount, sumCostAmounts, sumCostMetrics } from '../../app/lib/project/cost-amounts'

it('keeps zero and a proven empty set complete, and rejects absence, invalid values and coercible booleans', () => {
  expect(sumCostAmounts([], 'source')).toEqual({ value: 0, knownValue: 0, status: 'complete', missingSources: [] })
  expect(sumCostAmounts([0, '0.00'], 'source')).toEqual({ value: 0, knownValue: 0, status: 'complete', missingSources: [] })
  for (const value of [null, undefined, '', ' ', false, true, 'broken', Infinity, Number.NaN])
    expect(costAmount(value)).toBeNull()
  expect(sumCostAmounts([null, 'broken'], 'source')).toEqual({ value: null, knownValue: null, status: 'pending', missingSources: ['source'] })
  expect(sumCostAmounts([0, 5, null, -2], 'source')).toEqual({ value: null, knownValue: 3, status: 'partial', missingSources: ['source'] })
})

it('combines only independently proven subtotals and never subtracts a partial actual amount into a false balance', () => {
  const target = sumCostAmounts([100], 'budget')
  const partial = sumCostMetrics([sumCostAmounts([20], 'contracts'), missingCostAmount('wages')])
  expect(partial).toEqual({ value: null, knownValue: 20, status: 'partial', missingSources: ['wages'] })
  expect(remainingCostAmount(target, partial)).toEqual({ value: null, knownValue: null, status: 'pending', missingSources: ['wages'] })
  expect(remainingCostAmount(target, sumCostAmounts([120], 'actual'))).toEqual({ value: -20, knownValue: -20, status: 'complete', missingSources: [] })
})
