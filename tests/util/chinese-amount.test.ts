import { describe, expect, it } from 'vitest'
import { moneyToChinese } from '~/lib/util/chinese-amount'

describe('moneyToChinese', () => {
  it.each([
    [0.5, '零元伍角'],
    [0.05, '零元伍分'],
    [0.51, '零元伍角壹分'],
  ])('小于一元时保留“零元”：%s', (amount, expected) => {
    expect(moneyToChinese(amount)).toBe(expected)
  })

  it.each([
    [10_001, '壹万零壹元整'],
    [100_000_001, '壹亿零壹元整'],
    [100_010_001, '壹亿零壹万零壹元整'],
  ])('跨四位分组时补齐组间零：%s', (amount, expected) => {
    expect(moneyToChinese(amount)).toBe(expected)
  })
})
