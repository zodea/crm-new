import { describe, expect, it } from 'vitest'
import { payrollAAmount } from '../../app/lib/payroll/central-a-calculation'
import { calculatePayrollHollowTotals } from '../../app/lib/payroll/central-hollow-deduction-calculation'

const known = (value: number) => payrollAAmount([value])

describe('人工空鼓扣款的本次核算', () => {
  it('按比例形成的请款合计后才扣450，先列示时金额不变', () => {
    expect(calculatePayrollHollowTotals({ formatFamily: 'A', claimSubtotal: known(800), previousProcessed: known(0), currentDeduction: known(0) }).grossAmount.value).toBe(800)
    expect(calculatePayrollHollowTotals({ formatFamily: 'A', claimSubtotal: known(800), previousProcessed: known(0), currentDeduction: known(450) }).grossAmount.value).toBe(350)
  })

  it('a累计1000现金550并已完整处理450，后月无新增不把扣款重新发出', () => {
    expect(calculatePayrollHollowTotals({ formatFamily: 'A', claimSubtotal: known(1000 - 550), previousProcessed: known(450), currentDeduction: known(0) }).grossAmount.value).toBe(0)
    expect(calculatePayrollHollowTotals({ formatFamily: 'A', claimSubtotal: known(1200 - 550), previousProcessed: known(450), currentDeduction: known(0) }).grossAmount.value).toBe(200)
  })

  it('原扣450经P4改为300且真实补发150后，700现金和300有效扣款守恒', () => {
    expect(calculatePayrollHollowTotals({ formatFamily: 'A', claimSubtotal: known(1000 - 700), previousProcessed: known(300), currentDeduction: known(0) }).grossAmount.value).toBe(0)
  })

  it('c1/C2当月新工资不按A累计口径再次减去上月已处理扣款', () => {
    for (const formatFamily of ['C1', 'C2'] as const)
      expect(calculatePayrollHollowTotals({ formatFamily, claimSubtotal: known(1000), previousProcessed: known(450), currentDeduction: known(0) }).grossAmount.value).toBe(1000)
  })

  it('当前扣款超过可用请款时不按余额反推已处理处数', () => {
    const totals = calculatePayrollHollowTotals({ formatFamily: 'A', claimSubtotal: known(200), previousProcessed: known(0), currentDeduction: known(450) })
    expect(totals.grossAmount.value).toBeNull()
    expect(totals.reasons.join(' ')).toContain('部分处理')
    expect(totals.currentDeduction.value).toBe(450)
  })

  it('完整扣款恰好覆盖本次请款时保留真实零，未知来源不当零', () => {
    expect(calculatePayrollHollowTotals({ formatFamily: 'A', claimSubtotal: known(450), previousProcessed: known(0), currentDeduction: known(450) }).grossAmount.value).toBe(0)
    const unknown = payrollAAmount([null], ['原扣款处理依据无法证明'])
    expect(calculatePayrollHollowTotals({ formatFamily: 'A', claimSubtotal: known(450), previousProcessed: unknown, currentDeduction: known(0) }).grossAmount.value).toBeNull()
    expect(calculatePayrollHollowTotals({ formatFamily: 'C2', claimSubtotal: known(450), previousProcessed: known(0), currentDeduction: unknown }).grossAmount.value).toBeNull()
  })
})
