import { describe, expect, it } from 'vitest'
import { payrollAAmount } from '../../app/lib/payroll/central-a-calculation'
import { calculatePayrollHollowTotals } from '../../app/lib/payroll/central-hollow-deduction-calculation'

const known = (value: number) => payrollAAmount([value])

describe('人工空鼓扣款的本次核算', () => {
  it.each([
    { case: '{ formatFamily: \'A\', claimSubtotal: known(800), previousProcessed: known(0), currentDeduction: known(0) }', input: { formatFamily: 'A', claimSubtotal: known(800), previousProcessed: known(0), currentDeduction: known(0) }, expected: 800 },
    { case: '{ formatFamily: \'A\', claimSubtotal: known(800), previousProcessed: known(0), currentDeduction: known(450) }', input: { formatFamily: 'A', claimSubtotal: known(800), previousProcessed: known(0), currentDeduction: known(450) }, expected: 350 },
  ])('按比例形成的请款合计后才扣450，先列示时金额不变 / calculatePayrollHollowTotals：$case', ({ input, expected }) => {
    expect(calculatePayrollHollowTotals(input).grossAmount.value).toBe(expected)
  })

  it.each([
    { case: '{ formatFamily: \'A\', claimSubtotal: known(1000 - 550), previousProcessed: known(450), currentDeduction: known(0) }', input: { formatFamily: 'A', claimSubtotal: known(1000 - 550), previousProcessed: known(450), currentDeduction: known(0) }, expected: 0 },
    { case: '{ formatFamily: \'A\', claimSubtotal: known(1200 - 550), previousProcessed: known(450), currentDeduction: known(0) }', input: { formatFamily: 'A', claimSubtotal: known(1200 - 550), previousProcessed: known(450), currentDeduction: known(0) }, expected: 200 },
  ])('a累计1000现金550并已完整处理450，后月无新增不把扣款重新发出 / calculatePayrollHollowTotals：$case', ({ input, expected }) => {
    expect(calculatePayrollHollowTotals(input).grossAmount.value).toBe(expected)
  })

  it('原扣450经P4改为300且真实补发150后，700现金和300有效扣款守恒', () => {
    expect(calculatePayrollHollowTotals({ formatFamily: 'A', claimSubtotal: known(1000 - 700), previousProcessed: known(300), currentDeduction: known(0) }).grossAmount.value).toBe(0)
  })

  it.each((['C1', 'C2'] as const).map(input => ({ input })))('c1/C2当月新工资不按A累计口径再次减去上月已处理扣款：输入案例 %#', ({ input: formatFamily }) => {
    expect(calculatePayrollHollowTotals({ formatFamily, claimSubtotal: known(1000), previousProcessed: known(450), currentDeduction: known(0) }).grossAmount.value).toBe(1000)
  })

  it('当前扣款超过可用请款时不按余额反推已处理处数', () => {
    const totals = calculatePayrollHollowTotals({ formatFamily: 'A', claimSubtotal: known(200), previousProcessed: known(0), currentDeduction: known(450) })
    expect(totals.grossAmount.value).toBeNull()
    expect(totals.reasons.join(' ')).toContain('部分处理')
    expect(totals.currentDeduction.value).toBe(450)
  })

  it.each([
    { case: '完整扣款恰好覆盖请款', formatFamily: 'A' as const, previous: 0, current: 450, expected: 0 },
    { case: '原已处理来源未知', formatFamily: 'A' as const, previous: null, current: 0, expected: null },
    { case: '本次扣款来源未知', formatFamily: 'C2' as const, previous: 0, current: null, expected: null },
  ])('$case 保留真实零与未知的区别', ({ formatFamily, previous, current, expected }) => {
    const previousProcessed = previous === null ? payrollAAmount([null], ['原扣款处理依据无法证明']) : known(previous)
    const currentDeduction = current === null ? payrollAAmount([null], ['原扣款处理依据无法证明']) : known(current)
    expect(calculatePayrollHollowTotals({ formatFamily, claimSubtotal: known(450), previousProcessed, currentDeduction }).grossAmount.value).toBe(expected)
  })
})
