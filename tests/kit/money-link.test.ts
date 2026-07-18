import { describe, expect, it } from 'vitest'
import { resolveMoneyLink } from '~/lib/kit/money-link'

describe('moneyLink 解析（specs §07：¥#,##0.00 + 0/空/无目标退化）', () => {
  it('正数 + 有目标 → 可穿透，¥ 两位小数完整展示', () => {
    expect(resolveMoneyLink({ value: 1234.5, hasTarget: true }))
      .toEqual({ linkable: true, text: '¥1,234.50' })
  })

  it('0 / 空值退化普通文本，即使给了目标', () => {
    expect(resolveMoneyLink({ value: 0, hasTarget: true })).toEqual({ linkable: false, text: '¥0.00' })
    expect(resolveMoneyLink({ value: null, hasTarget: true })).toEqual({ linkable: false, text: '—' })
    expect(resolveMoneyLink({ value: undefined, hasTarget: true })).toEqual({ linkable: false, text: '—' })
  })

  it('未给目标退化普通文本；负数金额可穿透（红字冲销也要能查来源）', () => {
    expect(resolveMoneyLink({ value: 88, hasTarget: false })).toEqual({ linkable: false, text: '¥88.00' })
    expect(resolveMoneyLink({ value: -500, hasTarget: true })).toEqual({ linkable: true, text: '¥-500.00' })
  })
})
