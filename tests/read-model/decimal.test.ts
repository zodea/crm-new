import { describe, expect, it } from 'vitest'
import { decimalNumber, isDecimalString } from '../../app/lib/read-model/decimal'

describe('公共十进制数值', () => {
  it.each([[0, '0'], [-0, '0'], [0.1000001, '0.1000001'], [1e-7, '0.0000001'], [-1.23e-7, '-0.000000123'], [1.23e21, '1230000000000000000000'], [100.001, '100.001']])('已知 %s 精度展开为 %s，不应用展示舍入', (value, expected) => {
    expect(decimalNumber(value as number)).toBe(expected)
    expect(isDecimalString(expected)).toBe(true)
  })
  it.each([null, undefined, 0, '', 'unknown', 'NaN', 'Infinity', '1e-7', '01.2', '.2', '1,000.00', ' 0 ', '1.2.3', `0.${'0'.repeat(350)}1`, '9'.repeat(400)])('非法值 %s 不生成已知金额', (value) => {
    expect(isDecimalString(value)).toBe(false)
  })
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('未知数 %s 不序列化成零', (value) => {
    expect(() => decimalNumber(value)).toThrow('未知数值')
  })
  it('真实已知零可有明确小数位，负值格式本身不改变领域正负规则', () => {
    expect(isDecimalString('0.00')).toBe(true)
    expect(isDecimalString('-1.234567')).toBe(true)
  })
})
