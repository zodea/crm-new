import { isQuantitySourceIdentity } from '../quantity/migration-identity'
import { payrollACanonical } from './central-a-calculation'
import { isPayrollAFeeBlocker, isPayrollAFeeCell, isPayrollAFeeContext, isPayrollAFeeHistory, isPayrollAFeeNavigation, isPayrollAFeeOptions, isPayrollAFeePriceScope } from './central-a-fees-read-primitives'
import { feeAmount, feeArray, feeId, feeKeys, feeMonth, feeNullableId, feeObject, feeText, isPayrollABook, isPayrollAFeeRevision, isPayrollAFeesSourceSnapshot, isPayrollAManagementBookRead, isPayrollANegativeLineRevision, isPayrollANegativeValues, isPayrollCrewFeeDefaults } from './central-a-fees-validation'

const same = (a: unknown, b: unknown) => payrollACanonical(a) === payrollACanonical(b)
export function isPayrollAFeesFormExtension(v: unknown): boolean {
  if (!feeObject(v) || !feeObject(v.draft) || !feeObject(v.bookProof) || !feeObject(v.bookEligibility) || !feeArray(v.managementBooks, isPayrollAManagementBookRead) || !feeArray(v.negativeLineDrafts, n => feeObject(n) && feeKeys(n, ['lineId', 'baseRevisionId', 'label', 'quantity', 'unit', 'unitPrice', 'scope', 'reason', 'evidenceNote', 'actualRef']) && feeNullableId(n.lineId) && feeNullableId(n.baseRevisionId) && isPayrollANegativeValues(n)) || !feeArray(v.negativeLineRevisions, isPayrollANegativeLineRevision) || !feeArray(v.blockers, isPayrollAFeeBlocker) || !feeObject(v.totals) || !feeKeys(v.totals, ['workAmount', 'subsidyAmount', 'managementAmount', 'negativeAmount', 'listAmount', 'cumulativeAmount', 'previouslyPaid', 'grossAmount']) || !Object.values(v.totals).every(feeAmount) || !feeArray(v.previousBookPayments, p => feeObject(p) && feeKeys(p, ['statementId', 'month', 'book', 'amount', 'actualRefs', 'sourceVersion']) && feeId(p.statementId) && feeMonth(p.month) && isPayrollABook(p.book) && feeAmount(p.amount) && feeText(p.sourceVersion) && feeArray(p.actualRefs, r => feeObject(r) && (r.kind === 'released-statement' ? feeKeys(r, ['kind', 'statementId']) && feeId(r.statementId) : r.kind === 'actual-event' && feeKeys(r, ['kind', 'eventId']) && feeId(r.eventId)))))
    return false
  const e = v.bookEligibility
  if (!feeKeys(e, ['canSave', 'canCheck', 'canRelease', 'reasons']) || !['canSave', 'canCheck', 'canRelease'].every(k => typeof e[k] === 'boolean') || !feeArray(e.reasons, feeText))
    return false
  if (v.bookProof.state === 'unproven')
    return feeKeys(v.bookProof, ['state', 'book', 'reasons']) && v.book === null && v.fees === null && v.bookProof.book === null && feeArray(v.bookProof.reasons, feeText) && !e.canSave && !e.canCheck && !e.canRelease
  if (v.bookProof.state !== 'proven' || !feeKeys(v.bookProof, ['state', 'book', 'sourceVersion']) || !feeText(v.bookProof.sourceVersion) || !isPayrollABook(v.book) || !same(v.bookProof.book, v.book) || !same(v.draft.book, v.book) || !isPayrollAFeesSourceSnapshot(v.fees, v.book, !e.canSave && !e.canCheck && !e.canRelease && e.reasons.length > 0))
    return false
  if (!same(v.fees.totals, v.totals) || !v.previousBookPayments.every(p => feeObject(p) && same(p.book, v.book)))
    return false
  return v.status !== 'released' || (v.negativeLineDrafts.length === 0 && !e.canSave && !e.canCheck && !e.canRelease)
}

export function isPayrollAFeeConfigRead(v: unknown, origin: unknown): v is Record<string, unknown> {
  if (!feeObject(v) || !feeKeys(v, ['context', 'scope', 'baseVersion', 'options', 'crewDefaults', 'fees', 'managementBooks', 'cellOptions', 'items', 'responsibilityOptions', 'blockers', 'readonlyReasons', 'eligibility', 'history']) || !isPayrollAFeeContext(v.context, origin) || !feeObject(v.context) || v.baseVersion !== v.context.sourceVersion || !feeObject(v.scope) || !isPayrollABook(v.scope.book) || !isPayrollAFeeOptions(v.options) || (v.crewDefaults !== null && !isPayrollCrewFeeDefaults(v.crewDefaults)) || !isPayrollAFeeConfigEligibility(v.eligibility) || !feeArray(v.readonlyReasons, feeText) || !feeArray(v.blockers, isPayrollAFeeBlocker) || !feeArray(v.history, isPayrollAFeeHistory))
    return false
  const scope = v.scope
  if (!feeArray(v.fees, r => isPayrollAFeeRevision(r) && feeObject(r) && r.projectId === scope.projectId && r.leaderWorkerId === scope.leaderWorkerId && same({ bookPurpose: r.bookPurpose, managementBookId: r.managementBookId }, scope.book)) || !feeArray(v.managementBooks, r => isPayrollAManagementBookRead(r) && feeObject(r) && feeObject(r.book) && r.book.projectId === scope.projectId))
    return false
  if (!feeArray(v.cellOptions, c => feeObject(c) && feeKeys(c, ['unitId', 'roomId', 'itemId', 'locationLabel']) && isPayrollAFeeCell({ unitId: c.unitId, roomId: c.roomId, itemId: c.itemId }) && feeText(c.locationLabel)))
    return false
  if (!feeArray(v.items, i => feeObject(i) && feeKeys(i, ['itemId', 'itemName', 'unit', 'housingClassification', 'sourceVersion', 'scopes']) && isQuantitySourceIdentity(i.itemId, 'items') && (i.itemName === null || feeText(i.itemName)) && (i.unit === null || feeText(i.unit)) && feeText(i.sourceVersion) && feeArray(i.scopes, isPayrollAFeePriceScope) && feeObject(i.housingClassification) && (i.housingClassification.state === 'missing' ? feeKeys(i.housingClassification, ['state']) : feeKeys(i.housingClassification, ['state', 'value']) && (i.housingClassification.state === 'null' ? i.housingClassification.value === null : i.housingClassification.state === 'value' && ['wall-tile', 'floor-tile', 'other'].includes(String(i.housingClassification.value))))))
    return false
  return feeArray(v.responsibilityOptions, r => feeObject(r) && feeKeys(r, ['assignmentId', 'workerId', 'crewId', 'scopeIds', 'cells', 'label', 'eligible', 'reasons', 'sources']) && isQuantitySourceIdentity(r.assignmentId, 'unit_assignments') && feeNullableId(r.workerId) && feeNullableId(r.crewId) && feeArray(r.scopeIds, id => isQuantitySourceIdentity(id, 'unit_assignment_scopes')) && feeArray(r.cells, isPayrollAFeeCell) && feeText(r.label) && typeof r.eligible === 'boolean' && feeArray(r.reasons, feeText) && feeArray(r.sources, isPayrollAFeeNavigation))
}

export function isPayrollAFeeConfigEligibility(v: unknown): boolean {
  return feeObject(v) && feeKeys(v, ['canSaveFees', 'canSaveManagementBook', 'canStartManagementDraft', 'feeReasons', 'managementReasons']) && ['canSaveFees', 'canSaveManagementBook', 'canStartManagementDraft'].every(k => typeof v[k] === 'boolean') && feeArray(v.feeReasons, feeText) && feeArray(v.managementReasons, feeText) && v.canSaveFees === (v.feeReasons.length === 0) && v.canSaveManagementBook === (v.managementReasons.length === 0) && v.canStartManagementDraft === (v.managementReasons.length === 0)
}
