import { describe, expect, it } from 'vitest'
import { formatMoney, yuan } from '~/lib/util/money'

describe('金额格式化：formatMoney', () => {
  it.each([
    { case: '1234', input: 1234, expected: '1,234.00' },
    { case: '1234.5', input: 1234.5, expected: '1,234.50' },
    { case: '1234567.89', input: 1234567.89, expected: '1,234,567.89' },
    { case: '0', input: 0, expected: '0.00' },
  ])('强制两位小数 + 千分位分组 / formatMoney：$case', ({ input, expected }) => {
    expect(formatMoney(input)).toBe(expected)
  })

  it.each([
    { case: '1234.567', input: 1234.567, expected: '1,234.57' },
    { case: '0.1', input: 0.1, expected: '0.10' },
  ])('四舍五入到两位（不截断、不省略） / formatMoney：$case', ({ input, expected }) => {
    expect(formatMoney(input)).toBe(expected)
  })

  it('负数保留符号', () => {
    expect(formatMoney(-1234.5)).toBe('-1,234.50')
  })

  it.each([
    { case: '\'1234.5\'', input: '1234.5', expected: '1,234.50' },
    { case: '\'0\'', input: '0', expected: '0.00' },
  ])('接受数字字符串 / formatMoney：$case', ({ input, expected }) => {
    expect(formatMoney(input)).toBe(expected)
  })

  it('currency: true 加 ¥ 前缀', () => {
    expect(formatMoney(1234.5, { currency: true })).toBe('¥1,234.50')
  })

  it.each([
    { case: 'null', input: null, argument2: undefined, expected: '—' },
    { case: 'undefined', input: undefined, argument2: undefined, expected: '—' },
    { case: '\'\'', input: '', argument2: undefined, expected: '—' },
    { case: '\'abc\'', input: 'abc', argument2: undefined, expected: '—' },
    { case: 'Number.NaN', input: Number.NaN, argument2: undefined, expected: '—' },
    { case: 'null / { blank: \'0.00\' }', input: null, argument2: { blank: '0.00' }, expected: '0.00' },
  ])('非数值返回占位符（默认 —，可配） / formatMoney：$case', ({ input, argument2, expected }) => {
    expect(formatMoney(input, argument2)).toBe(expected)
  })
})

describe('yuan 便捷封装（对齐设计源码）', () => {
  it.each([
    { case: '1234.5', input: 1234.5, expected: '¥1,234.50' },
    { case: '0', input: 0, expected: '¥0.00' },
  ])('等价于 formatMoney(v, { currency: true }) / yuan：$case', ({ input, expected }) => {
    expect(yuan(input)).toBe(expected)
  })

  it.each([
    { case: 'null', input: null, argument2: undefined, expected: '—' },
    { case: 'undefined / \'未填\'', input: undefined, argument2: '未填', expected: '未填' },
  ])('非数值返回占位符 / yuan：$case', ({ input, argument2, expected }) => {
    expect(yuan(input, argument2)).toBe(expected)
  })
})
