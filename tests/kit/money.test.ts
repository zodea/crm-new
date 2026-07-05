import { describe, expect, it } from 'vitest'
import { formatMoney, yuan } from '~/lib/util/money'

describe('金额格式化：formatMoney', () => {
  it('强制两位小数 + 千分位分组', () => {
    expect(formatMoney(1234)).toBe('1,234.00')
    expect(formatMoney(1234.5)).toBe('1,234.50')
    expect(formatMoney(1234567.89)).toBe('1,234,567.89')
    expect(formatMoney(0)).toBe('0.00')
  })

  it('四舍五入到两位（不截断、不省略）', () => {
    expect(formatMoney(1234.567)).toBe('1,234.57')
    expect(formatMoney(0.1)).toBe('0.10')
  })

  it('负数保留符号', () => {
    expect(formatMoney(-1234.5)).toBe('-1,234.50')
  })

  it('接受数字字符串', () => {
    expect(formatMoney('1234.5')).toBe('1,234.50')
    expect(formatMoney('0')).toBe('0.00')
  })

  it('currency: true 加 ¥ 前缀', () => {
    expect(formatMoney(1234.5, { currency: true })).toBe('¥1,234.50')
  })

  it('非数值返回占位符（默认 —，可配）', () => {
    expect(formatMoney(null)).toBe('—')
    expect(formatMoney(undefined)).toBe('—')
    expect(formatMoney('')).toBe('—')
    expect(formatMoney('abc')).toBe('—')
    expect(formatMoney(Number.NaN)).toBe('—')
    expect(formatMoney(null, { blank: '0.00' })).toBe('0.00')
  })
})

describe('yuan 便捷封装（对齐设计源码）', () => {
  it('等价于 formatMoney(v, { currency: true })', () => {
    expect(yuan(1234.5)).toBe('¥1,234.50')
    expect(yuan(0)).toBe('¥0.00')
  })

  it('非数值返回占位符', () => {
    expect(yuan(null)).toBe('—')
    expect(yuan(undefined, '未填')).toBe('未填')
  })
})
