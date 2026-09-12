import type { QuantityAssignmentWorkspace } from './assignment'
import type { QuantityBatchCompletionPlan } from './batch-completion'
import type { QuantityBatchReadQuery, QuantityReadQuery, QuantityReadResult, QuantityUnitReadQuery } from './central-contract'
import type { QuantityCentralWorkspace } from './central-workspace'
import type { QuantityCompletionWorkspace } from './completion'
import { isISODateDTO, isISODateTimeDTO } from '../../types/read-model'
import { invalidQuantityResponse, quantityObject, quantityReadEnvelope, quantityStrings } from './central-decoder'

type Row = Record<string, unknown>
function array(value: unknown): value is Row[] {
  return Array.isArray(value) && value.every(quantityObject)
}
function ids(value: unknown): value is Row[] {
  return array(value) && value.every(row => typeof row.id === 'string' && row.id.trim()) && new Set(value.map(row => row.id)).size === value.length
}
function strings(row: Row, keys: string[]) {
  return keys.every(key => typeof row[key] === 'string')
}
function nullableStrings(row: Row, keys: string[]) {
  return keys.every(key => row[key] === null || typeof row[key] === 'string')
}
function integer(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0
}
function quantity(value: unknown) {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
}
function archived(data: Row) {
  return data.matrixArchivedAt === null || isISODateTimeDTO(data.matrixArchivedAt)
}
function statusDate(row: Row) {
  return ['draft', 'completed'].includes(String(row.status)) && (row.completedAt === null || isISODateDTO(row.completedAt))
}
function measure(value: unknown) {
  return quantityObject(value) && quantity(value.value) && quantity(value.knownValue)
    && integer(value.sourceCount) && integer(value.missingCount) && Number(value.missingCount) <= Number(value.sourceCount)
    && typeof value.unitMissing === 'boolean' && ['complete', 'partial'].includes(String(value.completeness))
    && (value.completeness !== 'partial' || value.value === null)
}

export function decodeQuantityAssignments(value: unknown, query: QuantityReadQuery): QuantityReadResult<QuantityAssignmentWorkspace> {
  quantityReadEnvelope(value, query)
  const data = value.data
  if (!archived(data) || !ids(data.units) || !ids(data.assignments) || !array(data.assignees) || !array(data.scopeOptions) || !quantityStrings(data.trades))
    invalidQuantityResponse()
  const units = new Map(data.units.map(row => [row.id, row]))
  const scopeOptions = data.scopeOptions
  if (!data.units.every(row => row.projectId === query.projectId && strings(row, ['buildingId', 'buildingName', 'floorId', 'floorName', 'templateId', 'code', 'name']) && Number.isFinite(row.sortOrder))
    || !data.assignees.every(row => strings(row, ['id', 'name', 'trade']) && ['crew', 'worker'].includes(String(row.kind)) && quantityStrings(row.trades) && quantityStrings(row.itemNames))
    || new Set(data.assignees.map(row => `${row.kind}:${row.id}`)).size !== data.assignees.length
    || !data.scopeOptions.every(row => strings(row, ['templateId', 'roomId', 'roomName', 'itemId', 'itemName', 'trade']) && Number.isFinite(row.roomSortOrder) && Number.isFinite(row.itemSortOrder))) {
    invalidQuantityResponse()
  }
  if (!data.assignments.every(row => units.has(row.unitId) && strings(row, ['trade', 'assigneeId', 'assigneeName', 'note', 'fingerprint'])
    && ['crew', 'worker'].includes(String(row.assigneeKind)) && typeof row.hasInvalidScopes === 'boolean'
    && array(row.scopes) && row.scopes.every(scope => strings(scope, ['roomId', 'roomName', 'itemId', 'itemName'])
      && scopeOptions.some(option => option.templateId === units.get(row.unitId)?.templateId && option.roomId === scope.roomId && option.itemId === scope.itemId && option.trade === row.trade)))) {
    invalidQuantityResponse()
  }
  return value as unknown as QuantityReadResult<QuantityAssignmentWorkspace>
}

export function decodeQuantityCompletion(value: unknown, query: QuantityUnitReadQuery): QuantityReadResult<QuantityCompletionWorkspace> {
  quantityReadEnvelope(value, query)
  const data = value.data
  if (!archived(data) || !quantityObject(data.unit) || data.unit.id !== query.unitId
    || !strings(data.unit, ['code', 'name', 'floorId', 'floorName', 'buildingId', 'buildingName', 'templateId'])
    || !ids(data.stages) || !(data.planWindow === null || (quantityObject(data.planWindow) && isISODateDTO(data.planWindow.plannedStartAt) && isISODateDTO(data.planWindow.plannedEndAt)))) {
    invalidQuantityResponse()
  }
  const photoIds: unknown[] = []
  for (const stage of data.stages) {
    if (!strings(stage, ['code', 'name', 'trade']) || !Number.isFinite(stage.sortOrder) || !array(stage.quantities) || !ids(stage.photos) || !array(stage.warnings))
      invalidQuantityResponse()
    if (!stage.quantities.every(row => strings(row, ['roomId', 'roomName', 'itemId', 'itemName', 'unit']) && ['recognizedContractQty', 'contractQty', 'provisionalQty', 'fieldQty'].every(key => quantity(row[key])))
      || !stage.photos.every(row => strings(row, ['fileName', 'mimeType']) && integer(row.fileSize))
      || !stage.warnings.every(row => strings(row, ['stageId', 'stageName']) && ['prior-incomplete', 'prior-photo-missing'].includes(String(row.code)))) {
      invalidQuantityResponse()
    }
    const assignment = stage.currentAssignment
    if (!(assignment === null || (quantityObject(assignment) && strings(assignment, ['id', 'assigneeId', 'assigneeName', 'note']) && typeof assignment.available === 'boolean' && ['crew', 'worker'].includes(String(assignment.assigneeKind)))))
      invalidQuantityResponse()
    const completion = stage.completion
    if (!(completion === null || (quantityObject(completion) && strings(completion, ['id', 'note', 'executionAssigneeName', 'fingerprint']) && nullableStrings(completion, ['assignmentId']) && statusDate(completion))))
      invalidQuantityResponse()
    if (completion === null && stage.photos.length)
      invalidQuantityResponse()
    photoIds.push(...stage.photos.map(row => row.id))
  }
  if (new Set(photoIds).size !== photoIds.length)
    invalidQuantityResponse()
  return value as unknown as QuantityReadResult<QuantityCompletionWorkspace>
}

export function decodeQuantityBatchPlan(value: unknown, query: QuantityBatchReadQuery): QuantityReadResult<QuantityBatchCompletionPlan> {
  quantityReadEnvelope(value, query)
  const data = value.data
  if (!archived(data) || data.trade !== query.trade || !array(data.items))
    invalidQuantityResponse()
  if (new Set(data.items.map(row => `${row.unitId}:${row.stageId}`)).size !== data.items.length
    || !data.items.every(row => query.unitIds.includes(String(row.unitId)) && row.trade === query.trade
      && strings(row, ['unitName', 'floorName', 'stageId', 'stageName']) && Number.isFinite(row.stageSortOrder)
      && nullableStrings(row, ['assigneeName', 'expectedCompletionId', 'expectedCompletionFingerprint', 'expectedAssignmentId'])
      && [null, 'draft', 'completed'].includes(row.currentStatus as never)
      && (row.currentCompletedAt === null || isISODateDTO(row.currentCompletedAt)) && typeof row.hasPhotos === 'boolean'
      && ['draft', 'completed'].includes(String(row.projectedStatus)) && [null, 'missing-photo', 'missing-assignment'].includes(row.projectedReason as never))) {
    invalidQuantityResponse()
  }
  return value as unknown as QuantityReadResult<QuantityBatchCompletionPlan>
}

export function decodeQuantityWorkspace(value: unknown, query: QuantityReadQuery): QuantityReadResult<QuantityCentralWorkspace> {
  quantityReadEnvelope(value, query)
  const data = value.data
  const snapshot = data.snapshot
  if (!quantityObject(snapshot) || snapshot.projectId !== query.projectId || !archived(snapshot)
    || !ids(snapshot.buildings) || !ids(snapshot.floors) || !ids(snapshot.units) || !ids(snapshot.stages) || !ids(snapshot.assignments) || !ids(snapshot.completions)
    || !array(data.stageProgress) || !array(data.records) || !array(data.monthly)) {
    invalidQuantityResponse()
  }
  const buildings = new Set(snapshot.buildings.map(row => row.id))
  const floors = new Set(snapshot.floors.map(row => row.id))
  const units = new Set(snapshot.units.map(row => row.id))
  const stages = new Set(snapshot.stages.map(row => row.id))
  const completions = new Set(snapshot.completions.map(row => row.id))
  if (![...snapshot.buildings, ...snapshot.floors, ...snapshot.units, ...snapshot.stages].every(row => strings(row, ['code', 'name']) && Number.isFinite(row.sortOrder))
    || ![...snapshot.buildings, ...snapshot.stages].every(row => row.projectId === query.projectId)
    || !snapshot.floors.every(row => buildings.has(row.buildingId)) || !snapshot.units.every(row => floors.has(row.floorId) && typeof row.templateId === 'string')
    || !snapshot.stages.every(row => typeof row.trade === 'string')
    || !snapshot.assignments.every(row => units.has(row.unitId) && strings(row, ['trade', 'assigneeId', 'assigneeName', 'note']) && ['crew', 'worker'].includes(String(row.assigneeKind)))
    || !snapshot.completions.every(row => units.has(row.unitId) && stages.has(row.stageId) && statusDate(row) && strings(row, ['stageName', 'stageTrade', 'assigneeName', 'note'])
      && Number.isFinite(row.stageSortOrder) && nullableStrings(row, ['assignmentId', 'assigneeId']) && [null, 'crew', 'worker'].includes(row.assigneeKind as never))) {
    invalidQuantityResponse()
  }
  if (!data.stageProgress.every(row => stages.has(row.stageId) && strings(row, ['stageName', 'trade']) && Number.isFinite(row.sortOrder)
    && ['applicableUnits', 'completedUnits', 'draftUnits'].every(key => integer(row[key])) && typeof row.completionRate === 'number' && Number.isFinite(row.completionRate) && row.completionRate >= 0
    && ['firstCompletedAt', 'lastCompletedAt'].every(key => row[key] === null || isISODateDTO(row[key])))
  || !data.records.every(row => completions.has(row.completionId) && units.has(row.unitId) && stages.has(row.stageId) && statusDate(row)
    && strings(row, ['unitName', 'floorName', 'buildingName', 'stageName', 'trade', 'note']) && nullableStrings(row, ['executionAssigneeName', 'currentAssigneeName'])
    && Number.isFinite(row.stageSortOrder) && integer(row.photoCount))
  || !data.monthly.every(row => stages.has(row.stageId) && strings(row, ['month', 'trade', 'stageName', 'unit']) && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(row.month))
    && Number.isFinite(row.stageSortOrder) && integer(row.completedUnits) && ['contractQty', 'provisionalQty', 'fieldQty'].every(key => measure(row[key])))) {
    invalidQuantityResponse()
  }
  return value as unknown as QuantityReadResult<QuantityCentralWorkspace>
}
