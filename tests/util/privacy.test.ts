import { describe, expect, it } from 'vitest'
import {
  maskBankAccount,
  maskIdentifier,
  maskMiddle,
  maskPhone,
} from '~/lib/util/privacy'

describe('敏感信息展示脱敏', () => {
  it('保留必要的首尾识别位，不暴露完整税号、手机号和银行账号', () => {
    expect(maskIdentifier('91440101MA5CBX1234')).toBe('9144 **** 1234')
    expect(maskPhone('13800138000')).toBe('138 **** 8000')
    expect(maskBankAccount('440000000000000001')).toBe('4400 **** 0001')
  })

  it('空值保持为空，短值也至少隐藏一位', () => {
    expect(maskPhone('1234567')).toBe('123 **** 567')
  })

  it.each([
    { case: '\'\'', input: '', expected: '' },
    { case: 'null', input: null, expected: '' },
    { case: '\'12\'', input: '12', expected: '**' },
  ])('空值保持为空，短值也至少隐藏一位 / maskMiddle：$case', ({ input, expected }) => {
    expect(maskMiddle(input)).toBe(expected)
  })
})
