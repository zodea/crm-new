import type { PayrollAAdjustmentCoverage, PayrollAAdjustmentDimension } from './central-a-adjustment-contract'
import type { PayrollAAdjustmentBasis } from './central-adjustment-contract'

export function payrollAAdjustmentRatio(basis: PayrollAAdjustmentBasis, kind: 'item' | 'fee' | 'negative', id: string): number | null {
  if (!basis.ratioPlan)
    return basis.payRatio
  if (kind === 'item')
    return basis.ratioPlan.itemRatios.find(row => row.itemId === id)?.ratio ?? null
  return basis.ratioPlan.feeRatios.find(row => row.kind === kind && row.id === id)?.ratio ?? basis.payRatio
}

function setRatio(basis: PayrollAAdjustmentBasis, kind: 'item' | 'fee' | 'negative', id: string, value: number | null): boolean {
  if (!basis.ratioPlan) {
    basis.payRatio = value
    return true
  }
  if (kind === 'item') {
    const row = basis.ratioPlan.itemRatios.find(row => row.itemId === id)
    if (!row)
      return false
    row.ratio = value
    return true
  }
  if (value === null)
    return false
  basis.ratioPlan.feeRatios = basis.ratioPlan.feeRatios.filter(row => row.kind !== kind || row.id !== id)
  basis.ratioPlan.feeRatios.push({ kind, id, ratio: value })
  return true
}

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
      return setRatio(basis, 'fee', component.feeId, value)
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
      return setRatio(basis, 'negative', line.lineId, value)
    else return false
    return true
  }
  const component = basis.components.find(c => c.ownershipKey === row.ownershipKey)
  if (!component)
    return false
  if (dimension.dimension === 'quantity') {
    component.quantity = value
  }
  else if (dimension.dimension === 'unit-price') {
    component.unitPrice = value
  }
  else if (dimension.dimension === 'pay-ratio') {
    const fact = basis.source.facts.find(fact => fact.ownershipKey === row.ownershipKey)
    return !!fact && setRatio(basis, 'item', fact.itemId, value)
  }
  else {
    return false
  }
  return true
}
