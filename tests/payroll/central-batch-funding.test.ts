import type { PayrollBatchFundingItemInput, PayrollBatchRounding } from '../../app/lib/payroll/central-batch-contract'
import { describe, expect, it } from 'vitest'
import { parsePayrollBatchFundingFen, suggestPayrollBatchFunding } from '../../app/lib/payroll/central-batch-calculation'

const hundred: PayrollBatchRounding = { state: 'configured', rule: { kind: 'floor', stepFen: 10_000 }, revisionId: 'round', revision: 1, effectiveMonth: '2026-08', sourceVersion: 'round:1' }
function item(itemId: string, eligibleAmountFen: number | null, overrides: Partial<PayrollBatchFundingItemInput> = {}): PayrollBatchFundingItemInput {
  return { itemId, bookKey: `book-${itemId}`, formatFamily: 'C1', eligibleAmountFen, rounding: { state: 'not-applicable' }, requiresFullAmount: false, ...overrides }
}
function suggestions(items: PayrollBatchFundingItemInput[], fundingAmountFen: number) {
  return suggestPayrollBatchFunding({ fundingAmountFen, items })
}

describe('central payroll batch funding', () => {
  it('suggests 300/200 from proven 600/400 without re-deducting earlier payments', () => {
    const result = suggestions([item('a', 60_000, { formatFamily: 'A', rounding: { ...hundred, state: 'configured', rule: { kind: 'off' } } }), item('c1', 40_000)], 50_000)
    expect(result).toMatchObject({ state: 'ready', eligibleTotalFen: 100_000, distributableFen: 50_000, suggestedTotalFen: 50_000, unallocatedFen: 0, overAllocatedFen: 0 })
    expect(result.items.map(row => row.suggestedAmountFen)).toEqual([30_000, 20_000])
  })

  it('uses the full 1000 proportionally after the initial hundred-yuan rounding', () => {
    const result = suggestions(['a', 'b', 'c'].map(id => item(id, 100_000, { formatFamily: 'A', rounding: hundred })), 100_000)
    expect(result.items.map(row => row.exactSuggestedAmountFen)).toEqual([30_000, 30_000, 30_000])
    expect(result.items.map(row => row.suggestedAmountFen)).toEqual([33_334, 33_333, 33_333])
    expect(result).toMatchObject({ state: 'ready', suggestedTotalFen: 100_000, unallocatedFen: 0, overAllocatedFen: 0 })
  })

  it.each([
    { order: 'original', reverse: false },
    { order: 'reversed', reverse: true },
  ])('uses stable book identity then original ID for ties in $order selection order', ({ reverse }) => {
    const items = [item('z-original', 1, { bookKey: 'first-book' }), item('a-original', 1, { bookKey: 'later-book' }), item('a-same-book', 1, { bookKey: 'first-book' })]
    const selected = reverse ? items.reverse() : items
    const result = Object.fromEntries(suggestions(selected, 2).items.map(row => [row.itemId, row.suggestedAmountFen]))
    expect(result).toEqual({ 'z-original': 1, 'a-original': 0, 'a-same-book': 1 })
  })

  it('resolves a one-cent C1/C2 tie without overspending', () => {
    const result = suggestions([item('c1', 1), item('c2', 1, { formatFamily: 'C2' })], 1)
    expect(result.items.map(row => row.suggestedAmountFen)).toEqual([1, 0])
    expect(result).toMatchObject({ state: 'ready', suggestedTotalFen: 1, unallocatedFen: 0, overAllocatedFen: 0 })
  })

  it('gives the next cent to the largest proportional remainder before identity order', () => {
    const result = suggestions([item('a', 1), item('b', 2), item('c', 4)], 5)
    expect(result.items.map(row => row.suggestedAmountFen)).toEqual([1, 1, 3])
    expect(result.unallocatedFen).toBe(0)
  })

  it('keeps A hundred-yuan initial rounding separate from C while using the final cents', () => {
    const result = suggestions([item('a', 10_000, { formatFamily: 'A', rounding: hundred }), item('c1', 10_000)], 10_001)
    expect(result.items.map(row => row.exactSuggestedAmountFen)).toEqual([0, 5000])
    expect(result.items.map(row => row.suggestedAmountFen)).toEqual([5001, 5000])
  })

  it('pays a required whole 600 first and allocates the remaining 100 to flexible wages', () => {
    const result = suggestions([item('full', 60_000, { requiresFullAmount: true }), item('flex', 40_000)], 70_000)
    expect(result.items.map(row => row.suggestedAmountFen)).toEqual([60_000, 10_000])
    expect(result).toMatchObject({ state: 'ready', suggestedTotalFen: 70_000, unallocatedFen: 0 })
  })

  it('skips unaffordable whole wages and continues in stable identity order before flexible shares', () => {
    const rows = [item('a', 70_000, { requiresFullAmount: true }), item('b', 50_000, { requiresFullAmount: true }), item('c', 20_000, { requiresFullAmount: true }), item('d', 5000, { requiresFullAmount: true }), item('flex', 40_000)]
    const result = suggestions([...rows].reverse(), 60_000)
    expect(Object.fromEntries(result.items.map(row => [row.itemId, row.suggestedAmountFen]))).toEqual({ a: 0, b: 50_000, c: 0, d: 5000, flex: 5000 })
    expect(result).toMatchObject({ state: 'ready', suggestedTotalFen: 60_000, unallocatedFen: 0 })
    expect(result.items.flatMap(row => row.blockers)).toEqual([])
  })

  it('retains a genuine surplus when full wages cannot fit and ordinary capacity is exhausted', () => {
    const result = suggestions([item('full', 60_000, { requiresFullAmount: true }), item('flex', 40_000)], 50_000)
    expect(result.items.map(row => row.suggestedAmountFen)).toEqual([0, 40_000])
    expect(result).toMatchObject({ state: 'ready', suggestedTotalFen: 40_000, unallocatedFen: 10_000 })
    expect(result.diagnostics.join(' ')).toContain('整单')
    expect(result.diagnostics.join(' ')).toContain('10000')
    expect(result.items.flatMap(row => row.blockers)).toEqual([])
  })

  it('caps suggestions at balances and never invents advance payment', () => {
    const result = suggestions([item('c1', 60_000), item('c2', 40_000)], 150_000)
    expect(result.items.map(row => row.suggestedAmountFen)).toEqual([60_000, 40_000])
    expect(result).toMatchObject({ state: 'ready', distributableFen: 100_000, suggestedTotalFen: 100_000, unallocatedFen: 50_000 })
    expect(result.diagnostics.join(' ')).toContain('上限')
  })

  it('keeps unknown balances and missing A rules unknown', () => {
    const unknown = suggestions([item('unknown', null)], 50_000)
    expect(unknown).toMatchObject({ state: 'incomplete', eligibleTotalFen: null, distributableFen: null, suggestedTotalFen: null, unallocatedFen: null })
    expect(unknown.items[0]).toMatchObject({ suggestedAmountFen: null, blockers: ['当前未付应领仍未知'] })
    const missing = suggestions([item('a', 60_000, { formatFamily: 'A', rounding: { state: 'missing' } })], 50_000)
    expect(missing.state).toBe('incomplete')
    expect(missing.items[0]).toMatchObject({ suggestedAmountFen: null, blockers: ['A 工资尚未明确取整规则'] })
  })

  it('preserves true zero and zero funding without generating a payment', () => {
    const zero = suggestions([item('zero', 0, { requiresFullAmount: true })], 500)
    expect(zero).toMatchObject({ state: 'ready', suggestedTotalFen: 0, unallocatedFen: 500 })
    expect(zero.items[0]!.suggestedAmountFen).toBe(0)
    expect(suggestions([item('full', 10, { requiresFullAmount: true }), item('flex', 10)], 0).items.map(row => row.suggestedAmountFen)).toEqual([0, 0])
  })

  it('uses integer intermediates at the safe-number boundary', () => {
    const maximum = Number.MAX_SAFE_INTEGER
    const result = suggestions([item('left', maximum - 1), item('right', 1)], maximum)
    expect(result).toMatchObject({ state: 'ready', suggestedTotalFen: maximum, unallocatedFen: 0 })
    expect(result.items.map(row => row.suggestedAmountFen)).toEqual([maximum - 1, 1])
  })

  it.each([
    { weights: [0, 1, 2], capacity: 3 },
    { weights: [1, 1, 1], capacity: 3 },
    { weights: [3, 7, 11], capacity: 21 },
    { weights: [0, 0, 0], capacity: 0 },
  ].flatMap(({ weights, capacity }) => Array.from({ length: 26 }, (_, funding) => ({ weights, funding, expectedTotal: Math.min(funding, capacity) }))))('flexible weights $weights with budget $funding use $expectedTotal cents', ({ weights, funding, expectedTotal }) => {
    const result = suggestions(weights.map((weight, index) => item(String(index), weight)), funding)
    expect(result.suggestedTotalFen).toBe(expectedTotal)
    expect(result.overAllocatedFen).toBe(0)
    result.items.forEach((row, index) => {
      expect(Number.isSafeInteger(row.suggestedAmountFen)).toBe(true)
      expect(row.suggestedAmountFen).toBeGreaterThanOrEqual(0)
      expect(row.suggestedAmountFen).toBeLessThanOrEqual(weights[index]!)
    })
  })

  it('rejects missing stable identity rather than using the current row position', () => {
    expect(() => suggestions([item('a', 1, { bookKey: '' })], 1)).toThrow('稳定簿')
  })

  it.each((['', ' ', '-1', '1.001', 'NaN', '90071992547409.92']).map(input => ({ input })))('parses explicit yuan without coercing blank, negative or over-precision input：输入案例 %#', ({ input: value }) => {
    expect(parsePayrollBatchFundingFen('500')).toBe(50_000)
    expect(parsePayrollBatchFundingFen('500.0')).toBe(50_000)
    expect(parsePayrollBatchFundingFen('500.01')).toBe(50_001)
    expect(() => parsePayrollBatchFundingFen(value)).toThrow('资金金额')
  })
})
