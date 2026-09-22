import type { PayrollAAdjustmentCoverage, PayrollAAdjustmentDimension } from './central-a-adjustment-contract'
import type { PayrollAAdjustmentBasis } from './central-adjustment-contract'

/** 冻结校验、后续核算和包含金额反算共用同一维度写入规则。 */
export function applyPayrollAAdjustmentDimension(basis: PayrollAAdjustmentBasis, row: PayrollAAdjustmentCoverage, dimension: PayrollAAdjustmentDimension, value: number | null): boolean {
  if (row.feeComponentKey !== undefined) {
    const component = basis.fees?.components.find(c => c.componentKey === row.feeComponentKey && c.ownershipKey === row.ownershipKey)
    if (!component || row.negativeLineId !== undefined)
      return false
    if (dimension.dimension === 'fee-quantity')
      component.quantity = value
    else if (dimension.dimension === 'fee-unit-price')
      component.unitPrice = value
    else if (dimension.dimension === 'pay-ratio')
      basis.payRatio = value
    else return false
    return true
  }
  if (row.negativeLineId !== undefined) {
    const line = basis.fees?.negativeLines.find(n => n.lineId === row.negativeLineId)
    if (!line)
      return false
    if (dimension.dimension === 'negative-quantity')
      line.quantity = value
    else if (dimension.dimension === 'negative-unit-price')
      line.unitPrice = value
    else if (dimension.dimension === 'pay-ratio')
      basis.payRatio = value
    else return false
    return true
  }
  const component = basis.components.find(c => c.ownershipKey === row.ownershipKey)
  if (!component)
    return false
  if (dimension.dimension === 'quantity')
    component.quantity = value
  else if (dimension.dimension === 'unit-price')
    component.unitPrice = value
  else if (dimension.dimension === 'pay-ratio')
    basis.payRatio = value
  else return false
  return true
}
