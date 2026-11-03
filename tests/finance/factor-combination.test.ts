import type { FactorInput } from '~/lib/finance/factor-combination'
import { describe, expect, it } from 'vitest'
import { solveFactorCombinations } from '~/lib/finance/factor-combination'

const frozenClock = () => 0

function factor(
  id: number,
  value: number,
  maxQuantity: number | null = null,
  allowDecimal = false,
): FactorInput {
  return { id, value, maxQuantity, allowDecimal }
}

describe('solveFactorCombinations：精确整数组合', () => {
  it('只返回恰好等于目标值的完整解，并统计总解数', () => {
    const result = solveFactorCombinations(
      [factor(1, 2), factor(2, 4, 5)],
      10,
      { now: frozenClock },
    )

    expect(result.totalCount).toBe(3)
    expect(result.solutions).toHaveLength(3)
    expect(result.solutions.every(solution => solution.reduce((sum, item) => sum + item.amount, 0) === 1000)).toBe(true)
    expect(result.solutions[0]).toEqual([
      expect.objectContaining({ factorId: 1, factorValue: 2, quantity: 1, amount: 200 }),
      expect.objectContaining({ factorId: 2, factorValue: 4, quantity: 2, amount: 800 }),
    ])
  })

  it('遵守每个因子的最大数量', () => {
    const result = solveFactorCombinations(
      [factor(1, 2), factor(2, 4, 1)],
      10,
      { now: frozenClock },
    )

    expect(result.totalCount).toBe(2)
    expect(result.solutions.every(solution => solution.every(item => item.factorId !== 2 || item.quantity <= 1))).toBe(true)
  })

  it('目标值无法被有效金额公约数整除时直接无解', () => {
    const result = solveFactorCombinations(
      [factor(1, 2), factor(2, 4)],
      9.99,
      { now: frozenClock },
    )

    expect(result.totalCount).toBe(0)
    expect(result.solutions).toEqual([])
  })
})

describe('solveFactorCombinations：筛选与去重', () => {
  it('必须包含指定因子时，每条解至少使用其最小一步', () => {
    const result = solveFactorCombinations(
      [factor(1, 2), factor(2, 4, 5)],
      10,
      { includeFactor: 4, now: frozenClock },
    )

    expect(result.totalCount).toBe(2)
    expect(result.solutions.every(solution => solution.some(item => item.factorValue === 4))).toBe(true)
  })

  it('排除指定因子后不使用该因子', () => {
    const result = solveFactorCombinations(
      [factor(1, 2), factor(2, 4, 5)],
      10,
      { excludeFactor: 4, now: frozenClock },
    )

    expect(result.totalCount).toBe(1)
    expect(result.solutions[0]).toEqual([
      expect.objectContaining({ factorId: 1, factorValue: 2, quantity: 5 }),
    ])
  })

  it('必须包含的因子不在有效列表时返回说明', () => {
    const result = solveFactorCombinations(
      [factor(1, 2)],
      10,
      { includeFactor: 4, now: frozenClock },
    )

    expect(result.totalCount).toBe(0)
    expect(result.note).toBe('“必须包含”的因子不在因子列表中')
  })

  it('同值因子以后输入项覆盖前输入项', () => {
    const result = solveFactorCombinations(
      [factor(1, 2, 1), factor(2, 2, 5)],
      4,
      { now: frozenClock },
    )

    expect(result.totalCount).toBe(1)
    expect(result.solutions[0]?.[0]).toEqual(expect.objectContaining({ factorId: 2, quantity: 2 }))
  })
})

describe('solveFactorCombinations：小数数量与金额精度', () => {
  it('未勾选小数时数量始终为整数', () => {
    const result = solveFactorCombinations(
      [factor(1, 2.5, 1, false)],
      1.25,
      { now: frozenClock },
    )

    expect(result.totalCount).toBe(0)
  })

  it('勾选小数时只生成单价乘数量为整分的精确组合', () => {
    const result = solveFactorCombinations(
      [factor(1, 2.5, 1, true)],
      1.25,
      { now: frozenClock },
    )

    expect(result.totalCount).toBe(1)
    expect(result.solutions[0]).toEqual([
      expect.objectContaining({
        factorValue: 2.5,
        quantity: 0.5,
        amount: 125,
        allowDecimal: true,
      }),
    ])
  })

  it('最大数量可为小数且不会越界', () => {
    const result = solveFactorCombinations(
      [factor(1, 2, 0.49, true)],
      1,
      { now: frozenClock },
    )

    expect(result.totalCount).toBe(0)
  })
})

describe('solveFactorCombinations：上限与时限', () => {
  it('请求超过硬上限时最多返回 5000 个结果', () => {
    const result = solveFactorCombinations([factor(1, 1), factor(2, 2)], 10000, { maxResults: 6000, now: frozenClock })
    expect(result.totalCount).toBe(5001)
    expect(result.solutions).toHaveLength(5000)
    expect(result.truncated).toBe(true)
  })
  it('达到返回上限后截断展示，但保留可统计的总解数', () => {
    const result = solveFactorCombinations(
      [factor(1, 1), factor(2, 2)],
      20,
      { maxResults: 3, now: frozenClock },
    )

    expect(result.totalCount).toBe(11)
    expect(result.solutions).toHaveLength(3)
    expect(result.truncated).toBe(true)
  })

  it('超出时限时停止并标记结果可能不完整', () => {
    let calls = 0
    const now = () => (calls++ < 2 ? 0 : 20_000)
    const result = solveFactorCombinations(
      [factor(1, 1), factor(2, 2)],
      100,
      { timeLimitMs: 10_000, now },
    )

    expect(result.timeUp).toBe(true)
    expect(result.elapsedMs).toBe(20_000)
  })

  it('计数阶段超时后仍保留已能枚举的部分解', () => {
    let calls = 0
    const now = () => (calls++ < 5 ? 0 : 20_000)
    const result = solveFactorCombinations(
      [factor(1, 1), factor(2, 2)],
      20,
      { timeLimitMs: 10_000, now },
    )

    expect(result.timeUp).toBe(true)
    expect(result.totalCount).toBeNull()
    expect(result.solutions.length).toBeGreaterThan(0)
    expect(result.solutions.every(solution => solution.reduce((sum, item) => sum + item.amount, 0) === 2_000)).toBe(true)
  })
})
