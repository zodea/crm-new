import { isEntityKindDTO } from '../../types/read-model'
import { isQuantitySourceIdentity } from '../quantity/migration-identity'
import { isStableRouteIdentity } from '../util/stable-route-identity'
import { payrollObject } from './central-snapshot'

const object = payrollObject
const text = (v: unknown): v is string => typeof v === 'string'
const nullableText = (v: unknown) => v === null || text(v)
const id = isStableRouteIdentity
const nullableId = (v: unknown) => v === null || id(v)
const array = (v: unknown, check: (v: unknown) => boolean): v is unknown[] => Array.isArray(v) && v.every(check)
const fields = (v: Record<string, unknown>, keys: string[], check: (v: unknown) => boolean) => keys.every(k => check(v[k]))
function exact(v: unknown, keys: string[]): v is Record<string, unknown> {
  return object(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))
}
export function isPayrollAFeeCell(v: unknown) {
  return exact(v, ['unitId', 'roomId', 'itemId']) && isQuantitySourceIdentity(v.unitId, 'units') && isQuantitySourceIdentity(v.roomId, 'rooms') && isQuantitySourceIdentity(v.itemId, 'items')
}
export function isPayrollAFeePriceScope(v: unknown) {
  return (exact(v, ['kind']) && v.kind === 'project')
    || (exact(v, ['kind', 'cells']) && v.kind === 'cells' && array(v.cells, isPayrollAFeeCell))
}
function entity(v: unknown) {
  if (!object(v) || !isEntityKindDTO(v.entity))
    return false
  if (v.state === 'resolved')
    return exact(v, ['state', 'entity', 'id', 'label', 'no']) && (v.entity === 'quantity-unit' ? isQuantitySourceIdentity(v.id, 'units') : id(v.id)) && text(v.label) && nullableText(v.no)
  if (!exact(v, ['state', 'entity', 'id', 'label', 'reason']) || v.label !== null)
    return false
  return v.state === 'missing' ? v.id === null && ['not-configured', 'not-recorded', 'not-applicable'].includes(String(v.reason)) : v.state === 'forbidden' && nullableId(v.id) && v.reason === 'permission-denied'
}
export function isPayrollAFeeNavigation(v: unknown) {
  if (!object(v))
    return false
  if (v.kind === 'unavailable')
    return exact(v, ['kind', 'reason']) && ['missing-id', 'missing-route', 'not-connected', 'forbidden', 'unverified-target', 'error'].includes(String(v.reason))
  if (v.kind === 'same-route-overlay')
    return exact(v, ['kind', 'subject', 'view']) && entity(v.subject) && text(v.view)
  if (!nullableText(v.variant) || !nullableText(v.view) || !object(v.filters) || !Object.values(v.filters).every(nullableText))
    return false
  return v.kind === 'entity-list' ? exact(v, ['kind', 'entity', 'variant', 'view', 'filters']) && isEntityKindDTO(v.entity) : ['entity-detail', 'entity-subview', 'source-record'].includes(String(v.kind)) && exact(v, ['kind', 'subject', 'variant', 'view', 'filters']) && entity(v.subject)
}
export function isPayrollAFeeContext(v: unknown, origin: unknown) {
  return exact(v, ['workspaceId', 'actorId', 'origin', 'sourceVersion', 'capabilities', 'readonly']) && fields(v, ['workspaceId', 'actorId'], id) && text(v.sourceVersion) && v.sourceVersion.length > 0 && v.origin === origin && array(v.capabilities, text) && v.capabilities.includes('payroll:read') && typeof v.readonly === 'boolean' && (origin === 'real' ? v.readonly === !v.capabilities.includes('payroll:write') : origin === 'demo' && v.readonly && v.capabilities.includes('demo:read'))
}
export function isPayrollAFeeOptions(v: unknown) {
  return exact(v, ['projects', 'crews', 'workers'])
    && array(v.projects, p => exact(p, ['id', 'name', 'code']) && id(p.id) && fields(p, ['name', 'code'], text))
    && array(v.crews, c => exact(c, ['id', 'name', 'eligible', 'reasons']) && id(c.id) && nullableText(c.name) && typeof c.eligible === 'boolean' && array(c.reasons, text))
    && array(v.workers, w => exact(w, ['id', 'name', 'crewId', 'eligible', 'reasons', 'source']) && id(w.id) && nullableText(w.name) && nullableId(w.crewId) && typeof w.eligible === 'boolean' && array(w.reasons, text) && (w.source === null || isPayrollAFeeNavigation(w.source)))
}
const blockerFields = ['code', 'message', 'locationLabel', 'sourceUnavailableReason', 'field', 'completionId', 'assignmentId', 'unitId', 'roomId', 'itemId', 'workerId', 'statementId', 'source', 'feeId', 'managementBookId', 'negativeLineId']
export function isPayrollAFeeBlocker(v: unknown) {
  const quantityFields = { completionId: 'unit_stage_completions', assignmentId: 'unit_assignments', unitId: 'units', roomId: 'rooms', itemId: 'items' } as const
  return exact(v, blockerFields) && fields(v, ['code', 'message'], text) && fields(v, ['locationLabel', 'sourceUnavailableReason', 'field'], nullableText) && Object.entries(quantityFields).every(([key, table]) => v[key] === null || isQuantitySourceIdentity(v[key], table)) && fields(v, ['workerId', 'statementId', 'feeId', 'managementBookId', 'negativeLineId'], nullableId) && (v.source === null || isPayrollAFeeNavigation(v.source))
}
function json(v: unknown): boolean {
  return v === null || text(v) || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (Array.isArray(v) && v.every(json)) || (object(v) && Object.values(v).every(json))
}
export function isPayrollAFeeHistory(v: unknown) {
  return exact(v, ['id', 'tableName', 'recordId', 'operation', 'operatedAt', 'operator', 'beforeData', 'afterData', 'beforeRaw', 'afterRaw']) && fields(v, ['id', 'tableName', 'recordId', 'operation'], text) && fields(v, ['operatedAt', 'operator', 'beforeRaw', 'afterRaw'], nullableText) && json(v.beforeData) && json(v.afterData)
}
export function isPayrollAFeeQuantityFact(v: unknown) {
  const ids = { completionId: 'unit_stage_completions', assignmentId: 'unit_assignments', stageId: 'construction_stages', stageItemId: 'construction_stage_items', unitId: 'units', floorId: 'floors', buildingId: 'buildings', templateId: 'house_type_templates', templateLineId: 'house_type_template_items', roomId: 'rooms', itemId: 'items' } as const
  const labels = ['unit', 'fieldFormula', 'buildingName', 'floorName', 'unitName', 'templateName', 'roomName', 'itemName', 'workerName', 'crewName']
  return exact(v, [...Object.keys(ids), ...labels, 'ownershipKey', 'completedAt', 'sourceFingerprint', 'workerId', 'crewId', 'fieldQty', 'assignmentScopeIds', 'scopeKind', 'scopeRows']) && Object.entries(ids).every(([key, table]) => isQuantitySourceIdentity(v[key], table)) && fields(v, labels, nullableText) && fields(v, ['ownershipKey', 'completedAt', 'sourceFingerprint'], text) && fields(v, ['workerId', 'crewId'], nullableId) && (v.fieldQty === null || (typeof v.fieldQty === 'number' && Number.isFinite(v.fieldQty))) && array(v.assignmentScopeIds, id => isQuantitySourceIdentity(id, 'unit_assignment_scopes')) && ['whole-trade', 'selected'].includes(String(v.scopeKind)) && array(v.scopeRows, r => exact(r, ['id', 'roomId', 'itemId', 'deletedAt']) && isQuantitySourceIdentity(r.id, 'unit_assignment_scopes') && isQuantitySourceIdentity(r.roomId, 'rooms') && isQuantitySourceIdentity(r.itemId, 'items') && nullableText(r.deletedAt))
}
