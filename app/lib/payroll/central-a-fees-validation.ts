import type { PayrollABookRef, PayrollAFeeBasis, PayrollAFeeDraft, PayrollAFeesFrozenDocument, PayrollAFeesSourceSnapshot, PayrollAManagementScope, PayrollAStatementSourceSnapshotV2, PayrollAStatementSourceSnapshotV4, PayrollAStatementSourceVersioned } from './central-a-fees-contract'
import type { PayrollAStatementSourceSnapshotV3 } from './central-a-hollow-contract'
import { isQuantitySourceIdentity } from '../quantity/migration-identity'
import { isStableRouteIdentity } from '../util/stable-route-identity'
import { payrollAAmount, payrollACanonical, payrollAMoney } from './central-a-calculation'
import { isPayrollAStatementSourceSnapshot } from './central-a-codec'
import { payrollAFeeTotal, payrollAManagementContains } from './central-a-fees-calculation'
import { isPayrollAFeeBlocker, isPayrollAFeeCell, isPayrollAFeeNavigation, isPayrollAFeePriceScope, isPayrollAFeeQuantityFact } from './central-a-fees-read-primitives'
import { isPayrollARatioPlan } from './central-a-item-ratio'
import { payrollProblem } from './central-contract'
import { isPayrollHollowSnapshot } from './central-hollow-deduction-snapshot'
import { payrollObject } from './central-snapshot'

export const feeObject = payrollObject
export const feeId = isStableRouteIdentity
export const feeText = (v: unknown): v is string => typeof v === 'string'
export const feeNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
export const feeNullableNumber = (v: unknown) => v === null || feeNumber(v)
export const feeNullableId = (v: unknown) => v === null || feeId(v)
export const feeArray = (v: unknown, check: (v: unknown) => boolean): v is unknown[] => Array.isArray(v) && v.every(check)
export const feeMonth = (v: unknown) => typeof v === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(v)
export function feeExact(v: unknown, keys: string[]): asserts v is Record<string, unknown> {
  if (!feeObject(v) || Object.keys(v).some(k => !keys.includes(k)) || keys.some(k => !Object.hasOwn(v, k)))
    throw payrollProblem('validation-failed', '费用资料字段缺失或包含不支持的字段')
}
export function isPayrollABook(v: unknown): v is PayrollABookRef {
  return feeObject(v) && Object.keys(v).length === 2 && (v.bookPurpose === 'ordinary' ? v.managementBookId === null : v.bookPurpose === 'management' && feeId(v.managementBookId))
}
export function isPayrollAManagementScope(v: unknown): v is PayrollAManagementScope {
  return feeObject(v) && Object.keys(v).length === 1 && feeArray(v.assignments, a => feeObject(a) && Object.keys(a).length === 3 && isQuantitySourceIdentity(a.assignmentId, 'unit_assignments') && feeArray(a.scopeIds, id => isQuantitySourceIdentity(id, 'unit_assignment_scopes')) && feeArray(a.cells, isPayrollAFeeCell))
}
export function isPayrollAFeeBasis(v: unknown): v is PayrollAFeeBasis {
  return feeObject(v) && Object.keys(v).length === 3 && v.kind === 'completed-field-quantity' && feeArray(v.itemIds, id => isQuantitySourceIdentity(id, 'items')) && isPayrollAFeePriceScope(v.scope)
}
export function isPayrollCrewFeeDefaults(v: unknown) {
  const field = (f: unknown, numeric: boolean) => feeObject(f) && (f.state === 'missing' ? Object.keys(f).length === 1 : Object.keys(f).length === 2 && (f.state === 'null' ? f.value === null : f.state === 'value' && (numeric ? feeNumber(f.value) && f.value >= 0 : typeof f.value === 'boolean')))
  return feeObject(v) && Object.keys(v).length === 6 && feeId(v.crewId) && feeText(v.sourceVersion) && field(v.rentEnabled, false) && field(v.rentUnitPrice, true) && field(v.managementEnabled, false) && field(v.managementUnitPrice, true)
}
export function isPayrollAFeeAdoption(v: unknown) {
  return v === null || (feeObject(v) && (['crew-rent', 'crew-management'].includes(String(v.kind)) ? Object.keys(v).length === 2 && isPayrollCrewFeeDefaults(v.fact) : v.kind === 'confirmed-housing-items' && Object.keys(v).length === 5 && feeArray(v.itemIds, id => isQuantitySourceIdentity(id, 'items')) && v.unitPrice === 1.3 && v.unit === '㎡' && feeText(v.evidenceNote)))
}
export function isPayrollAFeeDraft(v: unknown): v is PayrollAFeeDraft {
  return feeObject(v) && feeNullableId(v.feeId) && feeNullableId(v.baseRevisionId) && feeText(v.name) && typeof v.enabled === 'boolean' && feeNullableNumber(v.unitPrice) && (v.unit === null || feeText(v.unit)) && feeMonth(v.effectiveMonth) && isPayrollAFeeBasis(v.basis) && isPayrollAFeeAdoption(v.adoptedDefault)
    && (v.bookPurpose === 'ordinary' ? v.managementBookId === null && ['housing', 'subsidy'].includes(String(v.kind)) : v.bookPurpose === 'management' && feeId(v.managementBookId) && v.kind === 'management')
}
export function isPayrollANegativeValues(v: unknown) {
  return feeObject(v) && feeText(v.label) && feeNullableNumber(v.quantity) && (v.unit === null || feeText(v.unit)) && feeNullableNumber(v.unitPrice) && isPayrollAManagementScope(v.scope) && feeText(v.reason) && feeText(v.evidenceNote)
    && (v.actualRef === null || (feeObject(v.actualRef) && Object.keys(v.actualRef).length === 2 && (v.actualRef.kind === 'released-statement' ? feeId(v.actualRef.statementId) : v.actualRef.kind === 'actual-event' && feeId(v.actualRef.eventId))))
}
export function feeKeys(v: Record<string, unknown>, expected: string[]) {
  return Object.keys(v).length === expected.length && expected.every(k => Object.hasOwn(v, k))
}
const keys = feeKeys
export function feeAmount(v: unknown) {
  return feeObject(v) && keys(v, ['value', 'knownValue', 'state', 'reasons']) && feeNullableNumber(v.value) && feeNullableNumber(v.knownValue) && feeArray(v.reasons, feeText)
    && (v.state === 'known' ? v.value !== null && v.value === v.knownValue && v.reasons.length === 0 : v.value === null && (v.state === 'partial' ? v.knownValue !== null : v.state === 'unknown' && v.knownValue === null))
}
const amount = feeAmount
export function isPayrollAFeeRevision(r: unknown) {
  return feeObject(r) && keys(r, ['id', 'feeId', 'projectId', 'crewId', 'leaderWorkerId', 'bookPurpose', 'managementBookId', 'kind', 'name', 'enabled', 'unitPrice', 'unit', 'basis', 'effectiveMonth', 'adoptedDefault', 'revision', 'removed', 'operatorId', 'createdAt']) && isPayrollAFeeDraft({ ...r, baseRevisionId: r.id }) && ['id', 'feeId', 'projectId', 'leaderWorkerId', 'operatorId'].every(k => feeId(r[k])) && feeNullableId(r.crewId) && feeText(r.createdAt) && Number.isSafeInteger(r.revision) && Number(r.revision) > 0 && typeof r.removed === 'boolean' && (r.unitPrice === null || Number(r.unitPrice) >= 0)
}
export function isPayrollANegativeLineRevision(n: unknown) {
  return feeObject(n) && keys(n, ['id', 'lineId', 'statementId', 'projectId', 'managementBookId', 'managementRevisionId', 'revision', 'label', 'quantity', 'unit', 'unitPrice', 'signedAmountFen', 'scope', 'reason', 'evidenceNote', 'actualRef', 'removed', 'operatorId', 'createdAt']) && isPayrollANegativeValues(n) && ['id', 'lineId', 'statementId', 'projectId', 'managementBookId', 'managementRevisionId', 'operatorId'].every(k => feeId(n[k])) && Number.isSafeInteger(n.revision) && Number(n.revision) > 0 && typeof n.removed === 'boolean' && feeText(n.createdAt) && (n.signedAmountFen === null || Number.isSafeInteger(n.signedAmountFen))
}
export function isPayrollAManagementBookRead(v: unknown) {
  if (!feeObject(v) || !keys(v, ['book', 'revision', 'managerName', 'eligible', 'reasons']) || (v.managerName !== null && !feeText(v.managerName)) || typeof v.eligible !== 'boolean' || !feeArray(v.reasons, feeText))
    return false
  const b = v.book
  const r = v.revision
  if (!feeObject(b) || !keys(b, ['id', 'projectId', 'managerWorkerId', 'createdBy', 'createdAt', 'deletedAt']) || !['id', 'projectId', 'createdBy'].every(k => feeId(b[k])) || !feeNullableId(b.managerWorkerId) || !feeText(b.createdAt) || (b.deletedAt !== null && !feeText(b.deletedAt)))
    return false
  return r === null ? !v.eligible : feeObject(r) && keys(r, ['id', 'managementBookId', 'projectId', 'revision', 'effectiveMonth', 'managementMode', 'scope', 'initialPayRatio', 'evidenceNote', 'sourceVersion', 'operatorId', 'createdAt']) && ['id', 'managementBookId', 'projectId', 'operatorId'].every(k => feeId(r[k])) && r.managementBookId === b.id && r.projectId === b.projectId && feeMonth(r.effectiveMonth) && Number.isSafeInteger(r.revision) && Number(r.revision) > 0 && ['crew-managed', 'company-managed'].includes(String(r.managementMode)) && isPayrollAManagementScope(r.scope) && feeNullableNumber(r.initialPayRatio) && ['evidenceNote', 'sourceVersion', 'createdAt'].every(k => feeText(r[k])) && (!v.eligible || (r.managementMode === 'crew-managed' && b.managerWorkerId !== null && b.deletedAt === null && v.reasons.length === 0))
}
const same = (a: unknown, b: unknown) => payrollACanonical(a) === payrollACanonical(b)
function ownershipIdentity(v: unknown) {
  return feeObject(v) && keys(v, ['purpose', 'projectId', 'ownershipKey']) && v.purpose === 'management-fee' && feeId(v.projectId) && feeText(v.ownershipKey)
}
export function isPayrollAFeesSourceSnapshot(v: unknown, book: PayrollABookRef, diagnostic = false): v is PayrollAFeesSourceSnapshot {
  if (!feeObject(v) || !keys(v, ['schemaVersion', 'configSourceVersion', 'crewDefaults', 'feeRevisions', 'management', 'managementOwnership', 'negativeLines', 'lines', 'totals']) || v.schemaVersion !== 1 || !feeText(v.configSourceVersion) || (v.crewDefaults !== null && !isPayrollCrewFeeDefaults(v.crewDefaults)))
    return false
  if (!feeArray(v.feeRevisions, r => feeObject(r) && isPayrollAFeeRevision(r) && r.bookPurpose === book.bookPurpose && r.managementBookId === book.managementBookId))
    return false
  if (!feeArray(v.negativeLines, n => feeObject(n) && isPayrollANegativeLineRevision(n) && n.managementBookId === book.managementBookId))
    return false
  if (!feeArray(v.lines, l => feeObject(l) && keys(l, ['id', 'kind', 'feeId', 'feeRevisionIds', 'name', 'buildingId', 'buildingName', 'itemId', 'itemName', 'unit', 'quantity', 'knownQuantity', 'amount', 'components', 'sources', 'blockers']) && ['id', 'feeId', 'name', 'itemId'].every(k => feeText(l[k])) && ['housing', 'subsidy', 'management'].includes(String(l.kind)) && feeArray(l.feeRevisionIds, feeId) && ['buildingId', 'buildingName', 'itemName', 'unit'].every(k => l[k] === null || feeText(l[k])) && feeNullableNumber(l.quantity) && feeNullableNumber(l.knownQuantity) && amount(l.amount) && feeArray(l.sources, isPayrollAFeeNavigation) && feeArray(l.blockers, isPayrollAFeeBlocker)
    && feeArray(l.components, c => feeObject(c) && keys(c, ['componentKey', 'feeId', 'feeRevisionId', 'ownershipKey', 'managementOwnership', 'fact', 'quantity', 'unitPrice', 'amountFen']) && ['componentKey', 'feeId', 'feeRevisionId', 'ownershipKey'].every(k => feeText(c[k])) && feeNullableNumber(c.quantity) && feeNullableNumber(c.unitPrice) && (c.amountFen === null || Number.isSafeInteger(c.amountFen)) && (c.managementOwnership === null || ownershipIdentity(c.managementOwnership)) && isPayrollAFeeQuantityFact(c.fact)))) {
    return false
  }
  if (!feeArray(v.managementOwnership, o => feeObject(o) && keys(o, ['id', 'projectId', 'ownershipKey', 'managementBookId', 'firstStatementId', 'proof']) && ['id', 'projectId', 'managementBookId', 'firstStatementId'].every(k => feeId(o[k])) && feeText(o.ownershipKey) && feeObject(o.proof) && keys(o.proof, ['schemaVersion', 'identity', 'managementBookId', 'managementRevisionId', 'firstStatementId', 'firstCommandId', 'fact']) && o.proof.schemaVersion === 1 && ownershipIdentity(o.proof.identity) && feeObject(o.proof.identity) && o.proof.identity.projectId === o.projectId && o.proof.identity.ownershipKey === o.ownershipKey && o.proof.managementBookId === o.managementBookId && o.proof.firstStatementId === o.firstStatementId && feeId(o.proof.firstCommandId) && feeId(o.proof.managementRevisionId) && isPayrollAFeeQuantityFact(o.proof.fact) && feeObject(o.proof.fact) && o.proof.fact.ownershipKey === o.ownershipKey))
    return false
  if (!feeObject(v.totals) || !keys(v.totals, ['workAmount', 'subsidyAmount', 'managementAmount', 'negativeAmount', 'listAmount', 'cumulativeAmount', 'previouslyPaid', 'grossAmount']) || !Object.values(v.totals).every(amount))
    return false
  if (book.bookPurpose === 'ordinary' ? v.management !== null || v.negativeLines.length > 0 || v.managementOwnership.length > 0 : !feeObject(v.management) || !keys(v.management, ['book', 'revision']) || !isPayrollAManagementBookRead({ ...v.management, managerName: null, eligible: false, reasons: [] }) || !feeObject(v.management.book) || !feeObject(v.management.revision) || v.management.book.id !== book.managementBookId || v.management.revision.managementBookId !== book.managementBookId)
    return false
  const fees = v as unknown as PayrollAFeesSourceSnapshot
  if (new Set(fees.feeRevisions.map(r => r.id)).size !== fees.feeRevisions.length || new Set(fees.negativeLines.map(n => n.lineId)).size !== fees.negativeLines.length)
    return false
  if (fees.negativeLines.some(n => n.removed || n.quantity === null || n.quantity < 0 || n.unitPrice === null || n.unitPrice >= 0 || n.signedAmountFen !== Math.round(payrollAMoney(n.quantity * n.unitPrice) * 100)))
    return false
  const unprovenNegative = diagnostic && book.bookPurpose === 'management' && fees.totals.negativeAmount.state !== 'known' && fees.totals.negativeAmount.reasons.length > 0 && same(fees.totals.negativeAmount, payrollAAmount([...fees.negativeLines.map(n => n.signedAmountFen === null ? null : n.signedAmountFen / 100), null], fees.totals.negativeAmount.reasons))
  if (!same(fees.totals.subsidyAmount, payrollAFeeTotal(fees.lines.filter(l => l.kind !== 'management').map(l => l.amount))) || !same(fees.totals.managementAmount, payrollAFeeTotal(fees.lines.filter(l => l.kind === 'management').map(l => l.amount))) || (!unprovenNegative && !same(fees.totals.negativeAmount, payrollAAmount(fees.negativeLines.map(n => n.signedAmountFen === null ? null : n.signedAmountFen / 100)))) || !same(fees.totals.listAmount, payrollAFeeTotal([fees.totals.workAmount, fees.totals.subsidyAmount, fees.totals.managementAmount, fees.totals.negativeAmount])))
    return false
  return true
}
export function isPayrollAStatementSourceSnapshotV2(v: unknown): v is PayrollAStatementSourceSnapshotV2 {
  if (!feeObject(v) || v.schemaVersion !== 2 || Object.keys(v).some(k => !['schemaVersion', 'subject', 'facts', 'priceRevisions', 'book', 'fees', 'adjustmentReconciliation'].includes(k)) || !isPayrollABook(v.book) || !isPayrollAStatementSourceSnapshot({ ...v, schemaVersion: 1 }) || !isPayrollAFeesSourceSnapshot(v.fees, v.book))
    return false
  const source = v as unknown as PayrollAStatementSourceSnapshotV2
  if (new Set(source.facts.map(f => f.ownershipKey)).size !== source.facts.length || source.fees.feeRevisions.some(r => r.projectId !== source.subject.projectId || r.leaderWorkerId !== source.subject.leaderWorkerId || r.crewId !== source.subject.crewId))
    return false
  return source.fees.lines.every(l => l.components.every(c => source.facts.some(f => f.ownershipKey === c.ownershipKey && same(f, c.fact)) && c.quantity === c.fact.fieldQty && (source.book.bookPurpose === 'management' ? !!source.fees.management && payrollAManagementContains(source.fees.management.revision.scope, c.fact) && same(c.managementOwnership, { purpose: 'management-fee', projectId: source.subject.projectId, ownershipKey: c.ownershipKey }) : c.managementOwnership === null)))
}
export function isPayrollAStatementSourceVersioned(v: unknown): v is PayrollAStatementSourceVersioned {
  return feeObject(v) && (v.schemaVersion === 1 ? isPayrollAStatementSourceSnapshot(v) : v.schemaVersion === 3 ? isPayrollAStatementSourceSnapshotV3(v) : v.schemaVersion === 4 ? isPayrollAStatementSourceSnapshotV4(v) : isPayrollAStatementSourceSnapshotV2(v))
}
export function isPayrollAStatementSourceSnapshotV4(v: unknown): v is PayrollAStatementSourceSnapshotV4 {
  if (!feeObject(v) || v.schemaVersion !== 4 || !isPayrollARatioPlan(v.ratioPlan))
    return false
  const { ratioPlan, hollow, ...previous } = v
  if (hollow === undefined ? !isPayrollAStatementSourceSnapshotV2({ ...previous, schemaVersion: 2 }) : !isPayrollAStatementSourceSnapshotV3({ ...previous, schemaVersion: 3, hollow }))
    return false
  const source = v as unknown as PayrollAStatementSourceSnapshotV4
  return ratioPlan.itemRatios.every(row => source.facts.some(fact => fact.itemId === row.itemId))
    && ratioPlan.feeRatios.every(row => row.kind === 'fee' ? source.fees.feeRevisions.some(fee => fee.feeId === row.id) : source.fees.negativeLines.some(line => line.lineId === row.id))
}
export function isPayrollAStatementSourceSnapshotV3(v: unknown): v is PayrollAStatementSourceSnapshotV3 {
  if (!feeObject(v) || v.schemaVersion !== 3 || !isPayrollHollowSnapshot(v.hollow) || v.hollow.state !== 'available' || v.hollow.adoptions.length || v.hollow.scope.formatFamily !== 'A')
    return false
  const { hollow, ...previous } = v
  return isPayrollAStatementSourceSnapshotV2({ ...previous, schemaVersion: 2 }) && feeObject(v.subject)
    && hollow.scope.projectId === v.subject.projectId && hollow.scope.crewId === v.subject.crewId && hollow.scope.leaderWorkerId === v.subject.leaderWorkerId && same(hollow.scope.book, v.book)
}
export function isPayrollAFeesFrozenDocument(v: unknown): v is PayrollAFeesFrozenDocument {
  if (!feeObject(v) || !isPayrollABook(v.book) || !isPayrollAFeesSourceSnapshot(v.fees, v.book) || !feeNumber(v.listAmount) || !feeArray(v.previousBookPayments, p => feeObject(p) && keys(p, ['statementId', 'month', 'amount', 'book']) && feeId(p.statementId) && feeMonth(p.month) && feeNumber(p.amount) && isPayrollABook(p.book) && same(p.book, v.book)))
    return false
  const fees = v.fees
  const hollow = v.hollow === undefined ? null : isPayrollHollowSnapshot(v.hollow) ? v.hollow : false
  if (hollow === false)
    return false
  return Object.values(fees.totals).every(t => t.state === 'known') && fees.totals.listAmount.value === v.listAmount && ['workAmount', 'cumulativeAmount', 'previouslyPaid'].every(k => fees.totals[k as keyof typeof fees.totals].value === v[k])
    && fees.totals.grossAmount.value === (hollow ? hollow.totals.claimSubtotal.value : v.grossAmount)
}
