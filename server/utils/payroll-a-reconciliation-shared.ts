import type { PayrollAAdjustmentDimension } from '../../app/lib/payroll/central-a-adjustment-contract'
import type { PayrollAQuantityFact } from '../../app/lib/payroll/central-a-contract'

export function payrollAAdjustmentOwnership(fact: PayrollAQuantityFact) {
  return [fact.ownershipKey, fact.completionId, fact.assignmentId, fact.stageId, fact.stageItemId, fact.unitId, fact.floorId, fact.buildingId, fact.templateId, fact.templateLineId, fact.roomId, fact.itemId, fact.completedAt, fact.workerId, fact.crewId, fact.assignmentScopeIds, fact.scopeKind, fact.scopeRows, fact.unit]
}
export function payrollAAdjustmentDimension(dimension: PayrollAAdjustmentDimension['dimension'], before: number | null, after: number | null, current: number | null, related: boolean): PayrollAAdjustmentDimension {
  const state = !related || current === null || after === null ? 'unproven' : current === after ? 'included-in-current-source' : current === before ? 'needs-independent-effect' : 'unproven'
  return { dimension, before, after, current, effective: state === 'unproven' ? null : after, state }
}
