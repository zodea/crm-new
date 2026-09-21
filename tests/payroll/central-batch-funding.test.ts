import { describe, expect, it } from 'vitest'
import { parsePayrollBatchFundingFen, suggestPayrollBatchFunding } from '../../app/lib/payroll/central-batch-calculation'

describe('central payroll batch funding', () => {
  it('suggests 300/200 from proven 600/400 balances without re-deducting earlier payments', () => {
    const result = suggestPayrollBatchFunding({
      fundingAmountFen: 50_000,
      items: [
        { itemId: 'a', formatFamily: 'A', eligibleAmountFen: 60_000, rounding: { state: 'configured', rule: { kind: 'off' }, revisionId: 'round-a', revision: 1, effectiveMonth: '2026-08', sourceVersion: 'round:1' }, requiresFullAmount: false },
        { itemId: 'c1', formatFamily: 'C1', eligibleAmountFen: 40_000, rounding: { state: 'not-applicable' }, requiresFullAmount: false },
      ],
    })

    expect(result).toMatchObject({ state: 'ready', eligibleTotalFen: 100_000, distributableFen: 50_000, suggestedTotalFen: 50_000, unallocatedFen: 0, overAllocatedFen: 0 })
    expect(result.items.map(item => [item.itemId, item.suggestedAmountFen])).toEqual([['a', 30_000], ['c1', 20_000]])
  })

  it('leaves the undecided hundred-yuan remainder visible', () => {
    const rounding = { state: 'configured' as const, rule: { kind: 'floor' as const, stepFen: 10_000 as const }, revisionId: 'round', revision: 1, effectiveMonth: '2026-08', sourceVersion: 'round:1' }
    const result = suggestPayrollBatchFunding({
      fundingAmountFen: 100_000,
      items: ['a', 'b', 'c'].map(itemId => ({ itemId, formatFamily: 'A' as const, eligibleAmountFen: 100_000, rounding, requiresFullAmount: false })),
    })

    expect(result.items.map(item => item.suggestedAmountFen)).toEqual([30_000, 30_000, 30_000])
    expect(result).toMatchObject({ state: 'ready', suggestedTotalFen: 90_000, unallocatedFen: 10_000, overAllocatedFen: 0 })
    expect(result.diagnostics).toContain('仍有 10000 分未自动分配，请经办人明确调整')
  })

  it('rounds non-A shares to cents and blocks a one-cent tie instead of selecting a winner', () => {
    const result = suggestPayrollBatchFunding({
      fundingAmountFen: 1,
      items: ['c1', 'c2'].map((itemId, index) => ({ itemId, formatFamily: index ? 'C2' as const : 'C1' as const, eligibleAmountFen: 1, rounding: { state: 'not-applicable' as const }, requiresFullAmount: false })),
    })

    expect(result.items.map(item => item.suggestedAmountFen)).toEqual([1, 1])
    expect(result).toMatchObject({ state: 'blocked', suggestedTotalFen: 2, unallocatedFen: null, overAllocatedFen: 1 })
    expect(result.diagnostics).toContain('按分取整后的建议合计超过资金 1 分，请经办人明确分配尾差')
  })

  it('caps suggestions at proven balances and preserves surplus funding', () => {
    const result = suggestPayrollBatchFunding({
      fundingAmountFen: 150_000,
      items: [
        { itemId: 'c1', formatFamily: 'C1', eligibleAmountFen: 60_000, rounding: { state: 'not-applicable' }, requiresFullAmount: false },
        { itemId: 'c2', formatFamily: 'C2', eligibleAmountFen: 40_000, rounding: { state: 'not-applicable' }, requiresFullAmount: false },
      ],
    })

    expect(result.items.map(item => item.suggestedAmountFen)).toEqual([60_000, 40_000])
    expect(result).toMatchObject({ state: 'ready', distributableFen: 100_000, suggestedTotalFen: 100_000, unallocatedFen: 50_000 })
  })

  it('does not turn unknown balances or a missing A rounding decision into zero', () => {
    const unknown = suggestPayrollBatchFunding({
      fundingAmountFen: 50_000,
      items: [{ itemId: 'unknown', formatFamily: 'C1', eligibleAmountFen: null, rounding: { state: 'not-applicable' }, requiresFullAmount: false }],
    })
    expect(unknown).toMatchObject({ state: 'incomplete', eligibleTotalFen: null, distributableFen: null, suggestedTotalFen: null, unallocatedFen: null })
    expect(unknown.items[0]).toMatchObject({ suggestedAmountFen: null, blockers: ['当前未付应领仍未知'] })

    const missingRounding = suggestPayrollBatchFunding({
      fundingAmountFen: 50_000,
      items: [{ itemId: 'a', formatFamily: 'A', eligibleAmountFen: 60_000, rounding: { state: 'missing' }, requiresFullAmount: false }],
    })
    expect(missingRounding.state).toBe('incomplete')
    expect(missingRounding.items[0]).toMatchObject({ suggestedAmountFen: null, blockers: ['A 工资尚未明确取整规则'] })
  })

  it('defers a P6 full-release item when its weighted suggestion is partial', () => {
    const result = suggestPayrollBatchFunding({
      fundingAmountFen: 50_000,
      items: [
        { itemId: 'hollow', formatFamily: 'A', eligibleAmountFen: 60_000, rounding: { state: 'configured', rule: { kind: 'off' }, revisionId: 'round-a', revision: 1, effectiveMonth: '2026-08', sourceVersion: 'round:1' }, requiresFullAmount: true },
        { itemId: 'c1', formatFamily: 'C1', eligibleAmountFen: 40_000, rounding: { state: 'not-applicable' }, requiresFullAmount: false },
      ],
    })

    expect(result.state).toBe('blocked')
    expect(result.items[0]).toMatchObject({ suggestedAmountFen: 0, exactSuggestedAmountFen: 30_000, blockers: ['本单已启动空鼓扣款，只能明确整单发放 60000 分或暂不支付'] })
    expect(result.items[1].suggestedAmountFen).toBe(20_000)
    expect(result.unallocatedFen).toBe(30_000)
  })

  it('uses bigint intermediates at the safe-integer boundary', () => {
    const maximum = Number.MAX_SAFE_INTEGER
    const result = suggestPayrollBatchFunding({
      fundingAmountFen: maximum,
      items: [
        { itemId: 'left', formatFamily: 'C1', eligibleAmountFen: maximum - 1, rounding: { state: 'not-applicable' }, requiresFullAmount: false },
        { itemId: 'right', formatFamily: 'C2', eligibleAmountFen: 1, rounding: { state: 'not-applicable' }, requiresFullAmount: false },
      ],
    })
    expect(result.state).toBe('ready')
    expect(result.suggestedTotalFen).toBe(maximum)
    expect(result.items.map(item => item.suggestedAmountFen)).toEqual([maximum - 1, 1])
  })

  it('parses explicit yuan input without coercing blank, negative or over-precision values', () => {
    expect(parsePayrollBatchFundingFen('500')).toBe(50_000)
    expect(parsePayrollBatchFundingFen('500.0')).toBe(50_000)
    expect(parsePayrollBatchFundingFen('500.01')).toBe(50_001)
    for (const value of ['', ' ', '-1', '1.001', 'NaN', '90071992547409.92'])
      expect(() => parsePayrollBatchFundingFen(value)).toThrow('资金金额')
  })
})
