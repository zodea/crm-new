import { describe, expect, it } from 'vitest'
import { computeCombinations, type Factor } from '~/lib/finance/factor-combination'

const frozenClock = () => 0

function f(id: number, unitPrice: number, upperLimit: number): Factor {
  return { id, name: `F${id}`, unit: '', unitPrice, upperLimit }
}

describe('computeCombinations：命中与排序', () => {
  it('存在精确匹配时 diff=0 且排在最前', () => {
    // 2*100 + 2*30 = 260
    const r = computeCombinations([f(1, 100, 5), f(2, 30, 5)], 260, { now: frozenClock })
    expect(r.found).toBeGreaterThan(0)
    expect(r.combinations[0].diff).toBe(0)
    expect(r.combinations[0].total).toBe(260)
  })

  it('按 diff 升序返回', () => {
    const r = computeCombinations([f(1, 100, 5), f(2, 30, 5)], 265, { now: frozenClock })
    for (let i = 1; i < r.combinations.length; i++)
      expect(r.combinations[i].diff).toBeGreaterThanOrEqual(r.combinations[i - 1].diff)
  })
})

describe('computeCombinations：边界', () => {
  it('无因子 → 无方案', () => {
    const r = computeCombinations([], 100, { now: frozenClock })
    expect(r.found).toBe(0)
    expect(r.combinations).toEqual([])
  })

  it('剪枝：不返回超过 target*1.01 的组合', () => {
    const r = computeCombinations([f(1, 100, 5)], 100, { now: frozenClock })
    // 上限 101，故 200/300/... 全被剪掉，只剩 1*100=100
    expect(r.combinations.every(c => c.total <= 101)).toBe(true)
    expect(r.combinations[0].total).toBe(100)
  })

  it('keep 截断返回数，found 记截断前总数', () => {
    // 小搜索空间：全部命中(found<maxResults)，存在精确匹配 total=4
    const r = computeCombinations([f(1, 1, 3), f(2, 1, 3)], 4, { keep: 3, now: frozenClock })
    expect(r.combinations).toHaveLength(3)
    expect(r.found).toBeGreaterThan(3)
    expect(r.combinations[0].diff).toBe(0)
  })

  it('maxResults 封顶 DFS 命中数', () => {
    const r = computeCombinations([f(1, 1, 50), f(2, 1, 50)], 100, { maxResults: 5, now: frozenClock })
    expect(r.found).toBe(5)
  })

  it('超时立即中止（注入跳变时钟）', () => {
    let calls = 0
    const now = () => (calls++ === 0 ? 0 : 5000) // 首次取起点 0，之后恒 5000 > 2000
    const r = computeCombinations([f(1, 100, 5), f(2, 30, 5)], 260, { now })
    expect(r.found).toBe(0)
    expect(r.elapsedMs).toBe(5000)
  })
})
