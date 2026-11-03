import type { PayrollAdjustmentBasisDraft } from './central-adjustment-contract'
import { payrollAAmount } from './central-a-calculation'
import { payrollAFeeCorrectionAmount, payrollAFeeCorrectionLines } from './central-a-fee-adjustment'
import { calculatePayrollAItemRatios } from './central-a-item-ratio'
import { payrollCanonical } from './central-command-shared'
import { payrollHollowCorrectionAmount } from './central-hollow-deduction-adjustment'
import { rounded } from './statements'

/** 沿原格式每人每类结算到分，费率与工数不提前舍入。 */
export function payrollCorrectionAmount(basis: PayrollAdjustmentBasisDraft, reasons: string[] = []) {
  if (basis.formatFamily === 'A') {
    const groups = new Map<string, { itemId: string, quantity: number | null, unitPrice: number | null }>()
    for (const component of basis.components) {
      const fact = basis.source.facts.find(f => f.ownershipKey === component.ownershipKey)
      if (!fact)
        return payrollAAmount([null], [...reasons, '更正组件缺少原施工责任'])
      const key = payrollCanonical([fact.workerId ?? basis.source.subject.leaderWorkerId, fact.buildingId, fact.templateId, fact.itemId, fact.unit, component.priceRevisionId, component.unitPrice])
      const old = groups.get(key)
      groups.set(key, { itemId: fact.itemId, quantity: component.quantity === null || old?.quantity === null ? null : component.quantity + (old?.quantity ?? 0), unitPrice: component.unitPrice })
    }
    if (basis.ratioPlan) {
      const fees = payrollAFeeCorrectionLines(basis)
      if (!fees)
        return payrollAAmount([null], [...reasons, '费用更正缺少同簿或原责任依据'])
      const workLines = [...groups.values()].map(group => ({ itemId: group.itemId, amount: group.quantity === null || group.unitPrice === null ? null : rounded(group.quantity * group.unitPrice) }))
      const result = calculatePayrollAItemRatios({ periodKind: basis.periodKind, defaultRatio: basis.payRatio, ...basis.ratioPlan, workLines, feeLines: fees.positive, negativeLines: fees.negative })
      const subtotal = reasons.length ? payrollAAmount([result.cumulativeAmount.value], [...reasons, ...result.cumulativeAmount.reasons]) : result.cumulativeAmount
      return payrollHollowCorrectionAmount(subtotal, basis.hollow)
    }
    const work = payrollAAmount([...groups.values()].map(g => g.quantity === null || g.unitPrice === null ? null : rounded(g.quantity * g.unitPrice)), reasons)
    const fees = payrollAFeeCorrectionAmount(basis, reasons)
    const list = payrollAAmount([work.value, fees.value], [...reasons, ...fees.reasons])
    return payrollHollowCorrectionAmount(list.value === null || basis.payRatio === null ? payrollAAmount([null], list.reasons) : payrollAAmount([rounded(list.value * basis.payRatio)], list.reasons), basis.hollow)
  }
  if (basis.formatFamily === 'C1') {
    return payrollHollowCorrectionAmount(payrollAAmount(basis.rates.flatMap((rate) => {
      const rows = basis.records.filter(r => r.workerId === rate.workerId)
      const normal = rows.reduce((sum, r) => sum + (r.hours ?? 0), 0)
      const overtime = rows.reduce((sum, r) => sum + (r.overtimeHours ?? 0), 0)
      const overtimeRate = rate.overtimeRule === 'daily-divided-eight' ? rate.dailyWage === null ? null : rate.dailyWage / 8 : rate.overtimeRate
      return [rate.dailyWage === null || rows.some(r => r.hours === null) ? null : rounded(normal * rate.dailyWage / 8), overtimeRate === null || rows.some(r => r.overtimeHours === null) ? null : rounded(overtime * overtimeRate)]
    }), reasons), basis.hollow)
  }
  const workers = [...new Set(basis.records.map(r => r.workerId))]
  return payrollHollowCorrectionAmount(payrollAAmount(workers.map(workerId => basis.unitRate === null || basis.records.some(r => r.workerId === workerId && r.laborUnits === null) ? null : rounded(basis.records.filter(r => r.workerId === workerId).reduce((sum, r) => sum + r.laborUnits!, 0) * basis.unitRate)), reasons), basis.hollow)
}
