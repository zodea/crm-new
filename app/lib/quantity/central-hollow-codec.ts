import type { QuantityContext, QuantityUnitReadQuery } from './central-contract'
import type { QuantityHollowCommand, QuantityHollowCommandResult, QuantityHollowFact, QuantityHollowRead, QuantityHollowRectification, QuantityHollowRevision } from './central-hollow-contract'
import { isISODateDTO, isISODateTimeDTO } from '../../types/read-model'
import { quantityProblem } from './central-contract'
import { hollowCount, hollowEqual, hollowId, hollowIds, hollowKeys, hollowObject } from './central-hollow-primitives'
import { isQuantityHollowLocation, isQuantityHollowParty } from './central-hollow-responsibility'
import { isQuantityHollowProofRef } from './central-hollow-result'
import { isQuantityHollowInspectionInput, isQuantityHollowTarget } from './central-hollow-validation'

export { decodeQuantityHollowCommand, isQuantityHollowProofRef } from './central-hollow-result'
const factKeys = ['recordId', 'target', 'originalParty', 'originalPartyName', 'ownershipKey', 'location', 'inspection', 'revisions', 'rectifications', 'rectifiedCount', 'remainingCount', 'proof'] as const
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string')
}
function revision(value: unknown): value is QuantityHollowRevision {
  return hollowKeys(value, ['revisionId', 'previousRevisionId', 'input', 'reason', 'commandId', 'logId', 'actorId', 'createdAt']) && ['revisionId', 'commandId', 'logId', 'actorId'].every(key => hollowId(value[key])) && (value.previousRevisionId === null || hollowId(value.previousRevisionId)) && (value.reason === null || hollowId(value.reason)) && isQuantityHollowInspectionInput(value.input) && isISODateTimeDTO(value.createdAt)
}
function rectification(value: unknown): value is QuantityHollowRectification {
  return hollowKeys(value, ['id', 'revisionId', 'rectifiedOn', 'count', 'note', 'commandId', 'logId', 'actorId', 'createdAt']) && ['id', 'revisionId', 'commandId', 'logId', 'actorId'].every(key => hollowId(value[key])) && isISODateDTO(value.rectifiedOn) && hollowCount(value.count, true) && typeof value.note === 'string' && isISODateTimeDTO(value.createdAt)
}
/** 封闭结构与历史关系；物理原件和摘要核验由来源服务承担。 */
export function isQuantityHollowFact(value: unknown): value is QuantityHollowFact {
  if (!hollowKeys(value, factKeys) || !hollowId(value.recordId) || !isQuantityHollowTarget(value.target) || !isQuantityHollowParty(value.originalParty) || !hollowId(value.originalPartyName) || !isQuantityHollowLocation(value.location) || !revision(value.inspection) || !Array.isArray(value.revisions) || !value.revisions.length || !value.revisions.every(revision) || !Array.isArray(value.rectifications) || !value.rectifications.every(rectification) || !hollowCount(value.rectifiedCount) || !hollowCount(value.remainingCount) || !isQuantityHollowProofRef(value.proof))
    return false
  const rs = value.revisions
  const events = value.rectifications
  const current = value.inspection
  const proof = value.proof
  const target = value.target
  const location = value.location
  if (value.ownershipKey !== JSON.stringify([location.projectId, target.unitId, target.assignmentId, target.roomId, target.itemId]) || target.unitId !== location.unitId || target.roomId !== location.roomId || target.itemId !== location.itemId || !hollowEqual(rs.at(-1), current) || proof.recordId !== value.recordId || proof.revisionId !== current.revisionId || !hollowEqual(proof.rectificationIds, events.map(event => event.id)))
    return false
  if (new Set(rs.map(row => row.revisionId)).size !== rs.length || new Set(events.map(row => row.id)).size !== events.length || new Set([...rs, ...events].map(row => row.logId)).size !== rs.length + events.length || rs.some((row, index) => row.previousRevisionId !== (rs[index - 1]?.revisionId ?? null) || (index === 0 ? row.reason !== null : !hollowId(row.reason))))
    return false
  if (events.some(event => !rs.some(row => row.revisionId === event.revisionId && event.rectifiedOn >= row.input.inspectedOn) || event.rectifiedOn < current.input.inspectedOn))
    return false
  const total = events.reduce((sum, row) => sum + row.count, 0)
  const lastEvent = events.at(-1)
  const expectedHead = lastEvent?.revisionId === current.revisionId ? lastEvent.logId : current.logId
  return hollowCount(total) && value.rectifiedCount === total && value.remainingCount === current.input.count - total && proof.headLogId === expectedHead
}
function eligibility(value: unknown): value is { allowed: boolean, reasons: string[] } {
  return hollowKeys(value, ['allowed', 'reasons']) && typeof value.allowed === 'boolean' && strings(value.reasons) && (value.allowed ? !value.reasons.length : value.reasons.some(hollowId))
}
function source(value: unknown, query: QuantityUnitReadQuery, recordId?: string, revisionId?: string): boolean {
  if (!hollowKeys(value, ['navigation', 'reasons']) || !strings(value.reasons))
    return false
  if (value.navigation === null)
    return value.reasons.some(hollowId)
  const nav = value.navigation
  if (value.reasons.length || !hollowKeys(nav, ['kind', 'subject', 'variant', 'view', 'filters']) || !hollowKeys(nav.subject, ['state', 'entity', 'id', 'label', 'no']) || nav.subject.state !== 'resolved' || nav.subject.entity !== 'quantity-unit' || nav.subject.id !== query.unitId || !hollowId(nav.subject.label) || nav.subject.no !== null || nav.view !== null || !hollowObject(nav.filters) || nav.filters.projectId !== query.projectId || nav.filters.dataOrigin !== 'real')
    return false
  if (!recordId)
    return nav.kind === 'entity-detail' && nav.variant === 'detail' && hollowKeys(nav.filters, ['projectId', 'dataOrigin'])
  if (nav.kind !== 'entity-subview' || nav.variant !== 'hollow-record' || nav.filters.recordId !== recordId)
    return false
  if (Object.hasOwn(nav.filters, 'revisionId'))
    return hollowKeys(nav.filters, ['projectId', 'dataOrigin', 'recordId', 'revisionId']) && nav.filters.revisionId === revisionId
  return hollowKeys(nav.filters, ['projectId', 'dataOrigin', 'recordId'])
}
function context(value: unknown): value is QuantityContext {
  return hollowKeys(value, ['workspaceId', 'actorId', 'capabilities']) && hollowId(value.workspaceId) && hollowId(value.actorId) && hollowIds(value.capabilities)
}
export function decodeQuantityHollow(value: unknown, query: QuantityUnitReadQuery): QuantityHollowRead {
  const invalid = (): never => {
    throw quantityProblem('internal-error', '空鼓读取的原身份、数量或历史不完整')
  }
  if (!hollowKeys(value, ['data', 'dataOrigin', 'sourceVersion', 'asOf', 'capabilities', 'context']) || value.dataOrigin !== query.origin || value.dataOrigin !== 'real' || !hollowId(value.sourceVersion) || !isISODateTimeDTO(value.asOf) || !hollowIds(value.capabilities) || !context(value.context) || !hollowEqual(value.capabilities, value.context.capabilities) || !hollowKeys(value.data, ['projectId', 'unitId', 'targets', 'records', 'unavailable']) || value.data.projectId !== query.projectId || value.data.unitId !== query.unitId || !Array.isArray(value.data.targets) || !Array.isArray(value.data.records) || !Array.isArray(value.data.unavailable))
    return invalid()
  const data = value.data
  const mayWrite = value.capabilities.includes('quantity:write')
  for (const target of data.targets as unknown[]) {
    if (!hollowKeys(target, ['target', 'originalParty', 'originalPartyName', 'location', 'source', 'create']) || !isQuantityHollowTarget(target.target) || target.target.unitId !== query.unitId || !isQuantityHollowParty(target.originalParty) || !hollowId(target.originalPartyName) || !isQuantityHollowLocation(target.location) || target.location.projectId !== query.projectId || target.location.unitId !== query.unitId || target.location.roomId !== target.target.roomId || target.location.itemId !== target.target.itemId || !eligibility(target.create) || (!mayWrite && target.create.allowed) || !source(target.source, query))
      return invalid()
  }
  for (const row of data.records as unknown[]) {
    if (!hollowKeys(row, [...factKeys, 'source', 'eligibility']))
      return invalid()
    const { source: navigation, eligibility: actions, ...fact } = row
    if (!isQuantityHollowFact(fact) || fact.target.unitId !== query.unitId || fact.location.projectId !== query.projectId || !source(navigation, query, fact.recordId, fact.inspection.revisionId) || !hollowKeys(actions, ['revise', 'rectify']) || !eligibility(actions.revise) || !eligibility(actions.rectify) || (!mayWrite && (actions.revise.allowed || actions.rectify.allowed)) || (fact.remainingCount === 0 && actions.rectify.allowed))
      return invalid()
  }
  const codes = ['target-unavailable', 'responsibility-unproven', 'scope-incomplete', 'record-unproven', 'revision-chain-invalid', 'rectification-invalid', 'receipt-unproven', 'migration-unproven']
  for (const issue of data.unavailable as unknown[]) {
    if (!hollowKeys(issue, ['code', 'message', 'recordId', 'target']) || !codes.includes(String(issue.code)) || !hollowId(issue.message) || !(issue.recordId === null || hollowId(issue.recordId)) || !(issue.target === null || (isQuantityHollowTarget(issue.target) && issue.target.unitId === query.unitId)))
      return invalid()
  }
  if (new Set((data.records as { recordId: string }[]).map(row => row.recordId)).size !== (data.records as unknown[]).length)
    return invalid()
  return structuredClone(value) as unknown as QuantityHollowRead
}
export function quantityHollowReceiptObserved(read: QuantityHollowRead, command: QuantityHollowCommand, result: QuantityHollowCommandResult): boolean {
  if (read.context.workspaceId !== command.workspaceId || read.context.actorId !== command.actorId || read.dataOrigin !== command.origin || read.data.projectId !== command.projectId || read.data.unitId !== result.hollow.unitId || result.commandId !== command.commandId)
    return false
  const row = read.data.records.find(record => record.recordId === result.hollow.recordId)
  if (!row)
    return false
  const action = command.action
  if (action.kind === 'rectify-hollow-inspection')
    return row.rectifications.some(event => event.id === result.hollow.rectificationId && event.revisionId === action.expectedRevisionId && event.commandId === command.commandId && event.logId === result.hollow.logId && event.actorId === command.actorId && event.count === action.count && event.note === action.note && event.rectifiedOn === action.rectifiedOn)
  return row.revisions.some(revision => revision.revisionId === result.hollow.revisionId && revision.commandId === command.commandId && revision.logId === result.hollow.logId && revision.actorId === command.actorId && hollowEqual(revision.input, action.input) && (action.kind === 'create-hollow-inspection' ? revision.previousRevisionId === null && hollowEqual(row.target, action.target) : revision.previousRevisionId === action.expectedRevisionId && revision.reason === action.reason))
}
