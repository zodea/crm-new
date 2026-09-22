import type { PayrollAAmount, PayrollAQuantityFact } from './central-a-contract'
import type { PayrollAFeeBasis, PayrollAFeeLine, PayrollAFeeRevision, PayrollAManagementScope } from './central-a-fees-contract'
import { payrollAAmount, payrollACanonical, payrollAMoney } from './central-a-calculation'

export function payrollAManagementContains(scope: PayrollAManagementScope, fact: Pick<PayrollAQuantityFact, 'assignmentId' | 'unitId' | 'roomId' | 'itemId'>) {
  return scope.assignments.some(a => a.assignmentId === fact.assignmentId && a.cells.some(c => c.unitId === fact.unitId && c.roomId === fact.roomId && c.itemId === fact.itemId))
}
export function payrollAFeeContains(basis: PayrollAFeeBasis, fact: PayrollAQuantityFact) {
  return basis.itemIds.includes(fact.itemId) && (basis.scope.kind === 'project' || basis.scope.cells.some(c => c.unitId === fact.unitId && c.roomId === fact.roomId && c.itemId === fact.itemId))
}
/** 与原 A 相同：同费率/楼栋/分项/单位先聚合量再到分，组件参考分不参与二次求和。 */
export function payrollAFeeLines(facts: PayrollAQuantityFact[], revisions: PayrollAFeeRevision[], month: string): PayrollAFeeLine[] {
  // 移除生效后，旧修订预排的未来月份也失效；只有其后的明确新修订可重开。
  const removedThrough = new Map<string, number>()
  for (const r of revisions) {
    if (r.removed && r.effectiveMonth <= month)
      removedThrough.set(r.feeId, Math.max(removedThrough.get(r.feeId) ?? 0, r.revision))
  }
  const selected = new Map<string, PayrollAFeeRevision>()
  for (const r of revisions) {
    if (r.revision <= (removedThrough.get(r.feeId) ?? 0))
      continue
    const old = selected.get(r.feeId)
    if (r.effectiveMonth <= month && (!old || r.effectiveMonth > old.effectiveMonth || (r.effectiveMonth === old.effectiveMonth && r.revision > old.revision)))
      selected.set(r.feeId, r)
  }
  const lines: PayrollAFeeLine[] = []
  for (const fee of selected.values()) {
    if (!fee.enabled || fee.removed)
      continue
    const groups = new Map<string, PayrollAQuantityFact[]>()
    for (const fact of facts.filter(f => payrollAFeeContains(fee.basis, f))) {
      const key = payrollACanonical([fee.feeId, fee.id, fact.buildingId, fact.itemId, fact.unit])
      groups.set(key, [...groups.get(key) ?? [], fact])
    }
    for (const [id, rows] of groups) {
      const first = rows[0]!
      const known = rows.filter(r => r.fieldQty !== null)
      const knownQuantity = known.length ? known.reduce((sum, r) => sum + r.fieldQty!, 0) : null
      const quantity = rows.length === known.length ? knownQuantity : null
      const reasons = [quantity === null ? '费用现场量未完整提供' : '', !fee.unit || rows.some(r => r.unit !== fee.unit) ? '费用分项与计量单位不一致' : '', fee.unitPrice === null ? '费用单价尚未配置' : ''].filter(Boolean)
      const amount = payrollAAmount([!reasons.length && quantity !== null && fee.unitPrice !== null ? payrollAMoney(quantity * fee.unitPrice) : null], reasons)
      lines.push({ id, kind: fee.kind, feeId: fee.feeId, feeRevisionIds: [fee.id], name: fee.name, buildingId: first.buildingId, buildingName: first.buildingName, itemId: first.itemId, itemName: first.itemName, unit: first.unit, quantity, knownQuantity, amount, components: rows.map(fact => ({ componentKey: payrollACanonical([fee.feeId, fact.ownershipKey]), feeId: fee.feeId, feeRevisionId: fee.id, ownershipKey: fact.ownershipKey, managementOwnership: fee.kind === 'management' ? { purpose: 'management-fee', projectId: fee.projectId, ownershipKey: fact.ownershipKey } : null, fact, quantity: fact.fieldQty, unitPrice: fee.unitPrice, amountFen: fact.fieldQty === null || fee.unitPrice === null ? null : Math.round(payrollAMoney(fact.fieldQty * fee.unitPrice) * 100) })), sources: [], blockers: [] })
    }
  }
  return lines
}
export function payrollAFeeTotal(values: PayrollAAmount[]): PayrollAAmount {
  return payrollAAmount(values.map(v => v.value), values.flatMap(v => v.reasons))
}
