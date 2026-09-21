import type { PayrollAAdjustmentCoverage, PayrollAAdjustmentDimension } from '../../app/lib/payroll/central-a-adjustment-contract'
import type { PayrollAAdjustmentBasis } from '../../app/lib/payroll/central-adjustment-contract'
import { applyPayrollAAdjustmentDimension } from '../../app/lib/payroll/central-a-adjustment-coverage'
import { payrollAAdjustmentDimension as dimension, payrollAAdjustmentOwnership as ownership } from './payroll-a-reconciliation-shared'
import { payrollAdjustmentHash as hash } from './payroll-adjustment-facts'

interface Reference { id: string, rootAdjustmentId: string, originalStatementId: string }

/** 费用归属和负价沿革逐行证明；不能只凭总金额相等认为已含更正。 */
export function reconcilePayrollAFeeAdjustments(raw: PayrollAAdjustmentBasis, effective: PayrollAAdjustmentBasis, before: PayrollAAdjustmentBasis, after: PayrollAAdjustmentBasis, head: Reference, changed: Map<string, string>): PayrollAAdjustmentCoverage[] {
  if (before.source.schemaVersion === 1 || after.source.schemaVersion === 1 || !before.fees || !after.fees)
    return []
  const source = raw.source.schemaVersion !== 1 ? raw.source.fees : null
  const originalSource = before.source.fees
  const sameBook = raw.source.schemaVersion !== 1 && hash(raw.source.book) === hash(before.source.book)
  const coverage: PayrollAAdjustmentCoverage[] = []
  function push(row: PayrollAAdjustmentCoverage) {
    for (const d of row.dimensions) {
      const key = d.dimension === 'pay-ratio' ? 'pay-ratio' : `${row.feeComponentKey ?? row.negativeLineId}:${d.dimension}`
      if (changed.has(key) && changed.get(key) !== head.rootAdjustmentId)
        row.reasons.push('同一费用维度涉及不同原单更正，须核实前后引用')
      changed.set(key, head.rootAdjustmentId)
      if (d.state === 'unproven')
        row.reasons.push(`费用 ${row.feeComponentKey ?? row.negativeLineId} 的 ${d.dimension} 来源已变，尚不能证明已包含或可沿用原更正`)
    }
    if (!row.reasons.length) {
      for (const d of row.dimensions) {
        if (!applyPayrollAAdjustmentDimension(effective, row, d, d.effective))
          row.reasons.push('费用更正缺少当前同一责任行')
      }
    }
    coverage.push(row)
  }
  for (const component of after.fees.components) {
    const old = before.fees.components.find(c => c.componentKey === component.componentKey)
    if (!old || (old.quantity === component.quantity && old.unitPrice === component.unitPrice && before.payRatio === after.payRatio))
      continue
    const current = raw.fees?.components.find(c => c.componentKey === component.componentKey)
    const oldFact = originalSource.lines.flatMap(l => l.components).find(c => c.componentKey === component.componentKey)?.fact
    const currentFact = source?.lines.flatMap(l => l.components).find(c => c.componentKey === component.componentKey)?.fact
    const oldFee = originalSource.feeRevisions.find(f => f.id === old.feeRevisionId)
    const currentFee = source?.feeRevisions.find(f => f.id === current?.feeRevisionId)
    const sameOwnership = sameBook && !!oldFact && !!currentFact && hash(ownership(oldFact)) === hash(ownership(currentFact))
    const sameFee = !!oldFee && !!currentFee && oldFee.feeId === currentFee.feeId && oldFee.projectId === currentFee.projectId && oldFee.leaderWorkerId === currentFee.leaderWorkerId && oldFee.crewId === currentFee.crewId && oldFee.kind === currentFee.kind && oldFee.bookPurpose === currentFee.bookPurpose && oldFee.managementBookId === currentFee.managementBookId && oldFee.unit === currentFee.unit && hash(oldFee.basis) === hash(currentFee.basis) && currentFee.revision >= oldFee.revision && currentFee.enabled && !currentFee.removed
    const dimensions: PayrollAAdjustmentDimension[] = []
    if (old.quantity !== component.quantity)
      dimensions.push(dimension('fee-quantity', old.quantity, component.quantity, current?.quantity ?? null, sameOwnership && sameFee))
    if (old.unitPrice !== component.unitPrice)
      dimensions.push(dimension('fee-unit-price', old.unitPrice, component.unitPrice, current?.unitPrice ?? null, sameOwnership && sameFee))
    if (before.payRatio !== after.payRatio)
      dimensions.push(dimension('pay-ratio', before.payRatio, after.payRatio, raw.payRatio, sameOwnership && sameFee))
    push({ adjustmentId: head.id, rootAdjustmentId: head.rootAdjustmentId, originalStatementId: head.originalStatementId, ownershipKey: component.ownershipKey, feeComponentKey: component.componentKey, originalSourceFingerprint: oldFact?.sourceFingerprint ?? '', currentSourceFingerprint: currentFact?.sourceFingerprint ?? null, originalPriceRevisionId: old.feeRevisionId, currentPriceRevisionId: current?.feeRevisionId ?? null, dimensions, reasons: sameOwnership && sameFee ? [] : ['费用的原责任、同簿用途或采用修订沿革不能核实'] })
  }
  for (const line of after.fees.negativeLines) {
    const old = before.fees.negativeLines.find(n => n.lineId === line.lineId)
    if (!old || (old.quantity === line.quantity && old.unitPrice === line.unitPrice && before.payRatio === after.payRatio))
      continue
    const current = raw.fees?.negativeLines.find(n => n.lineId === line.lineId)
    const oldRevision = originalSource.negativeLines.find(n => n.id === old.originalNegativeRevisionId)
    const currentRevision = source?.negativeLines.find(n => n.id === current?.originalNegativeRevisionId)
    const related = sameBook && !!oldRevision && !!currentRevision && oldRevision.lineId === currentRevision.lineId && oldRevision.statementId === currentRevision.statementId && oldRevision.projectId === currentRevision.projectId && oldRevision.managementBookId === currentRevision.managementBookId && oldRevision.managementRevisionId === currentRevision.managementRevisionId && oldRevision.unit === currentRevision.unit && hash(oldRevision.scope) === hash(currentRevision.scope) && hash(oldRevision.actualRef) === hash(currentRevision.actualRef) && currentRevision.revision >= oldRevision.revision && !currentRevision.removed
    const dimensions: PayrollAAdjustmentDimension[] = []
    if (old.quantity !== line.quantity)
      dimensions.push(dimension('negative-quantity', old.quantity, line.quantity, current?.quantity ?? null, related))
    if (old.unitPrice !== line.unitPrice)
      dimensions.push(dimension('negative-unit-price', old.unitPrice, line.unitPrice, current?.unitPrice ?? null, related))
    if (before.payRatio !== after.payRatio)
      dimensions.push(dimension('pay-ratio', before.payRatio, after.payRatio, raw.payRatio, related))
    push({ adjustmentId: head.id, rootAdjustmentId: head.rootAdjustmentId, originalStatementId: head.originalStatementId, ownershipKey: line.lineId, negativeLineId: line.lineId, originalSourceFingerprint: hash(oldRevision ?? null), currentSourceFingerprint: currentRevision ? hash(currentRevision) : null, originalPriceRevisionId: old.originalNegativeRevisionId, currentPriceRevisionId: current?.originalNegativeRevisionId ?? null, dimensions, reasons: related ? [] : ['负价原行的管理簿、责任范围及原依据沿革不能核实'] })
  }
  return coverage
}
