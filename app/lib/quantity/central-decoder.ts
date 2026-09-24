import type { QuantityReadQuery, QuantityReadResult } from './central-contract'
import type { QuantityStageWorkspace } from './central-stages'
import type { QuantityRegionWorkspace } from './region'
import type { QuantityTemplateWorkspace } from './template'
import { isISODateTimeDTO } from '../../types/read-model'
import { quantityProblem } from './central-contract'

export function quantityObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function quantityStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

export function invalidQuantityResponse(): never {
  throw quantityProblem('internal-error', '工程量服务响应格式或身份无效，请重新读取')
}

function rows(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(row => quantityObject(row) && typeof row.id === 'string' && row.id.trim())
    && new Set(value.map(row => row.id)).size === value.length
}

function strings(row: Record<string, unknown>, keys: string[]) {
  return keys.every(key => typeof row[key] === 'string')
}

function nullableQuantity(value: unknown) {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
}

export function quantityReadEnvelope(value: unknown, query: QuantityReadQuery): asserts value is Record<string, unknown> & { data: Record<string, unknown> } {
  if (!quantityObject(value) || !quantityObject(value.data) || value.data.projectId !== query.projectId
    || value.dataOrigin !== query.origin || typeof value.sourceVersion !== 'string' || !value.sourceVersion
    || !isISODateTimeDTO(value.asOf) || !quantityStrings(value.capabilities)) {
    invalidQuantityResponse()
  }
}

export function decodeQuantityRegion(value: unknown, query: QuantityReadQuery): QuantityReadResult<QuantityRegionWorkspace> {
  quantityReadEnvelope(value, query)
  const data = value.data
  if (!strings(data, ['projectCode', 'projectName']) || !(data.matrixArchivedAt === null || isISODateTimeDTO(data.matrixArchivedAt))
    || !rows(data.buildings) || !rows(data.floors) || !rows(data.units) || !rows(data.templates)) {
    invalidQuantityResponse()
  }
  const nodes = [...data.buildings, ...data.floors, ...data.units]
  if (!nodes.every(row => strings(row, ['code', 'name']) && Number.isFinite(row.sortOrder))
    || !data.templates.every(row => strings(row, ['code', 'name']))) {
    invalidQuantityResponse()
  }
  const buildings = new Set(data.buildings.map(row => row.id))
  const floors = new Set(data.floors.map(row => row.id))
  const templates = new Set(data.templates.map(row => row.id))
  if (!data.floors.every(row => buildings.has(row.buildingId))
    || !data.units.every(row => floors.has(row.floorId) && templates.has(row.templateId))) {
    invalidQuantityResponse()
  }
  return value as unknown as QuantityReadResult<QuantityRegionWorkspace>
}

export function decodeQuantityTemplates(value: unknown, query: QuantityReadQuery): QuantityReadResult<QuantityTemplateWorkspace> {
  quantityReadEnvelope(value, query)
  const data = value.data
  if (!rows(data.items) || !rows(data.templates) || !rows(data.rooms) || !rows(data.lines))
    invalidQuantityResponse()
  if (!data.items.every(row => row.projectId === query.projectId && strings(row, ['code', 'name', 'section', 'trade', 'unit']) && Number.isFinite(row.sortOrder))
    || !data.templates.every(row => row.projectId === query.projectId && strings(row, ['code', 'name'])
      && (row.copiedFromTemplateId === null || typeof row.copiedFromTemplateId === 'string')
      && Number.isFinite(row.sortOrder) && isISODateTimeDTO(row.updatedAt) && Number.isSafeInteger(row.unitCount) && Number(row.unitCount) >= 0)) {
    invalidQuantityResponse()
  }
  const templates = new Set(data.templates.map(row => row.id))
  const rooms = new Set(data.rooms.map(row => row.id))
  const items = new Set(data.items.map(row => row.id))
  if (!data.rooms.every(row => templates.has(row.templateId) && strings(row, ['code', 'name']) && ['room', 'whole_unit'].includes(String(row.kind)) && Number.isFinite(row.sortOrder))
    || !data.lines.every(row => rooms.has(row.roomId) && items.has(row.itemId) && strings(row, ['fieldFormula', 'note'])
      && (row.boqLineId === null || typeof row.boqLineId === 'string') && Number.isFinite(row.sortOrder)
      && ['recognizedContractQty', 'contractQty', 'provisionalQty', 'fieldQty'].every(key => nullableQuantity(row[key])))) {
    invalidQuantityResponse()
  }
  return value as unknown as QuantityReadResult<QuantityTemplateWorkspace>
}

export function decodeQuantityStages(value: unknown, query: QuantityReadQuery): QuantityReadResult<QuantityStageWorkspace> {
  quantityReadEnvelope(value, query)
  const data = value.data
  if (!(data.matrixArchivedAt === null || isISODateTimeDTO(data.matrixArchivedAt))
    || !rows(data.stages) || !rows(data.items) || !rows(data.mappings)) {
    invalidQuantityResponse()
  }
  if (!data.stages.every(row => strings(row, ['code', 'name', 'trade']) && ['unit', 'manual'].includes(String(row.completionMode)) && Number.isSafeInteger(row.sortOrder))
    || !data.items.every(row => strings(row, ['code', 'name', 'trade']) && (row.unit === null || typeof row.unit === 'string'))) {
    invalidQuantityResponse()
  }
  const stages = new Map(data.stages.map(row => [row.id, row]))
  const items = new Map(data.items.map(row => [row.id, row]))
  const reportingItems = new Set<unknown>()
  const pairs = new Set<string>()
  for (const mapping of data.mappings) {
    const stage = stages.get(mapping.stageId)
    const item = items.get(mapping.itemId)
    const pair = JSON.stringify([mapping.stageId, mapping.itemId])
    if (!stage || !item || stage.trade !== item.trade || stage.completionMode !== 'unit'
      || typeof mapping.isReportingStage !== 'boolean' || pairs.has(pair)
      || (mapping.isReportingStage && reportingItems.has(item.id))) {
      invalidQuantityResponse()
    }
    pairs.add(pair)
    if (mapping.isReportingStage)
      reportingItems.add(item.id)
  }
  return value as unknown as QuantityReadResult<QuantityStageWorkspace>
}
