import { describe, expect, it } from 'vitest'
import { evaluateQuantityFormula } from '~/lib/quantity/formula'

describe('现场量算式', () => {
  it.each([
    ['2 + 3 * 4', 14],
    ['（2＋3）×4', 20],
    ['２．５×４－１', 9],
    ['客厅（3.2×4）＋厨房（2×1.5）㎡', 15.8],
    ['5×2（主卧）＋3×2（次卧）', 16],
    ['墙面：-2×（3＋1）', -8],
  ])('不用 eval 解析数字、全角符号、括号和中文备注：%s', (formula, expected) => {
    const result = evaluateQuantityFormula(formula)

    expect(result.ok).toBe(true)
    if (result.ok)
      expect(result.value).toBeCloseTo(expected)
  })

  it('空白表示清空现场量', () => {
    expect(evaluateQuantityFormula('  ')).toEqual({
      ok: true,
      normalized: '',
      value: null,
    })
  })

  it.each([
    ['2÷0', '不能除以 0'],
    ['2＋', '算式不完整'],
    ['2（3＋4）', '数字与括号之间缺少运算符'],
    ['长2宽3', '数字之间缺少运算符'],
    ['Math.max(2, 3)', '包含不支持的字符'],
    ['2^3', '包含不支持的字符'],
    ['只有备注', '算式中没有数字'],
  ])('非法表达式返回可展示错误：%s', (formula, message) => {
    const result = evaluateQuantityFormula(formula)

    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error).toContain(message)
  })

  it('限制过深或过长输入，避免递归和大输入拖垮界面', () => {
    const tooDeep = `${'('.repeat(65)}1${')'.repeat(65)}`
    const tooLong = `1+${'1'.repeat(4096)}`

    expect(evaluateQuantityFormula(tooDeep)).toMatchObject({ ok: false, error: expect.stringContaining('过于复杂') })
    expect(evaluateQuantityFormula(tooLong)).toMatchObject({ ok: false, error: expect.stringContaining('过长') })
  })
})
