import { describe, expect, it } from 'vitest'
import { resolveMoneyLink } from '~/lib/kit/money-link'

describe('moneyLink 解析（specs §07：¥#,##0.00 + 0/空/无目标退化）', () => {
  it('正数 + 有目标 → 可穿透，¥ 两位小数完整展示', () => {
    expect(resolveMoneyLink({ value: 1234.5, hasTarget: true }))
      .toEqual({ linkable: true, text: '¥1,234.50' })
  })

  it.each([
    { case: '{ value: 0, hasTarget: true }', input: { value: 0, hasTarget: true }, expected: { linkable: false, text: '¥0.00' } },
    { case: '{ value: null, hasTarget: true }', input: { value: null, hasTarget: true }, expected: { linkable: false, text: '—' } },
    { case: '{ value: undefined, hasTarget: true }', input: { value: undefined, hasTarget: true }, expected: { linkable: false, text: '—' } },
  ])('0 / 空值退化普通文本，即使给了目标 / resolveMoneyLink：$case', ({ input, expected }) => {
    expect(resolveMoneyLink(input)).toEqual(expected)
  })

  it.each([
    { case: '{ value: 88, hasTarget: false }', input: { value: 88, hasTarget: false }, expected: { linkable: false, text: '¥88.00' } },
    { case: '{ value: -500, hasTarget: true }', input: { value: -500, hasTarget: true }, expected: { linkable: true, text: '¥-500.00' } },
  ])('未给目标退化普通文本；负数金额可穿透（红字冲销也要能查来源） / resolveMoneyLink：$case', ({ input, expected }) => {
    expect(resolveMoneyLink(input)).toEqual(expected)
  })
})
