import { describe, expect, it } from 'vitest'
import { payrollAAmount } from '../../app/lib/payroll/central-a-calculation'
import { calculatePayrollHollowTotals } from '../../app/lib/payroll/central-hollow-deduction-calculation'

const known = (value: number) => payrollAAmount([value])

describe('人工空鼓扣款的本次核算', () => {
  it.each([
    { label: '仅列示未启动扣款', input: { formatFamily: 'A' as const, claimSubtotal: known(800), previousProcessed: known(0), currentDeduction: known(0) }, expected: 800 },
    { label: '启动扣款 450', input: { formatFamily: 'A' as const, claimSubtotal: known(800), previousProcessed: known(0), currentDeduction: known(450) }, expected: 350 },
  ])('按比例形成的请款合计 800 后才扣款：$label', ({ input, expected }) => {
    expect(calculatePayrollHollowTotals(input).grossAmount.value).toBe(expected)
  })

  it.each([
    { label: '后月累计仍为 1000', input: { formatFamily: 'A' as const, claimSubtotal: known(1000 - 550), previousProcessed: known(450), currentDeduction: known(0) }, expected: 0 },
    { label: '后月累计增至 1200', input: { formatFamily: 'A' as const, claimSubtotal: known(1200 - 550), previousProcessed: known(450), currentDeduction: known(0) }, expected: 200 },
  ])('a 累计 1000、现金 550 并已完整处理 450，不把扣款重新发出：$label', ({ input, expected }) => {
    expect(calculatePayrollHollowTotals(input).grossAmount.value).toBe(expected)
  })

  it('原扣450经P4改为300且真实补发150后，700现金和300有效扣款守恒', () => {
    expect(calculatePayrollHollowTotals({ formatFamily: 'A', claimSubtotal: known(1000 - 700), previousProcessed: known(300), currentDeduction: known(0) }).grossAmount.value).toBe(0)
  })

  it.each(['C1', 'C2'] as const)('%s 当月新工资不按 A 累计口径再次减去上月已处理扣款', (formatFamily) => {
    expect(calculatePayrollHollowTotals({ formatFamily, claimSubtotal: known(1000), previousProcessed: known(450), currentDeduction: known(0) }).grossAmount.value).toBe(1000)
  })

  it('当前扣款超过可用请款 0.01 时不按余额反推已处理处数', () => {
    expect(calculatePayrollHollowTotals({ formatFamily: 'A', claimSubtotal: known(450), previousProcessed: known(0), currentDeduction: known(450.01) }).grossAmount.value).toBeNull()
  })

  it('当前扣款远超可用请款时保留原扣款金额，不按余额反推已处理处数', () => {
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

  // 负数分支：任一参与核算的扣款为负时整体未知，不按负扣款反向加发。
  it.each([
    { label: 'A 本次扣款为负', input: { formatFamily: 'A' as const, previousProcessed: known(0), currentDeduction: known(-0.01) } },
    { label: 'A 此前已处理为负', input: { formatFamily: 'A' as const, previousProcessed: known(-450), currentDeduction: known(0) } },
    { label: 'C2 本次扣款为负', input: { formatFamily: 'C2' as const, previousProcessed: known(0), currentDeduction: known(-450) } },
  ])('$label 时应发未知并说明原因', ({ input }) => {
    const totals = calculatePayrollHollowTotals({ ...input, claimSubtotal: known(800) })
    expect(totals.grossAmount.value).toBeNull()
    expect(totals.availableBeforeDeduction.value).toBeNull()
    expect(totals.reasons).toContain('空鼓扣款与已处理金额不得为负数')
  })

  it('c1 不消费此前已处理金额，其为负数时不影响当月应发', () => {
    expect(calculatePayrollHollowTotals({ formatFamily: 'C1', claimSubtotal: known(800), previousProcessed: known(-450), currentDeduction: known(0) }).grossAmount.value).toBe(800)
  })
})
