import type { QuantityBoqWorkspace } from './central-boq'
import type { QuantityReadQuery, QuantityReadResult } from './central-contract'
import type { QuantityVarianceFact } from './variance'
import { isISODateTimeDTO } from '../../types/read-model'
import { invalidQuantityResponse, quantityObject, quantityReadEnvelope } from './central-decoder'

function quantity(value: unknown) {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
}

export function decodeQuantityBoq(value: unknown, query: QuantityReadQuery): QuantityReadResult<QuantityBoqWorkspace> {
  quantityReadEnvelope(value, query)
  const lines = value.data.lines
  if (!Array.isArray(lines) || !lines.every(row => quantityObject(row)
    && ['id', 'contractId'].every(key => typeof row[key] === 'string' && row[key].trim())
    && ['contractName', 'contractNo', 'itemName', 'unit'].every(key => typeof row[key] === 'string')
    && ['qty', 'unitPrice', 'effectiveUnitPrice'].every(key => quantity(row[key]))
    && typeof row.approvedDeltaQty === 'number' && Number.isFinite(row.approvedDeltaQty)
    && (row.building === null || typeof row.building === 'string')
    && (row.updatedAt === null || isISODateTimeDTO(row.updatedAt)))
  || new Set(lines.map(row => row.id)).size !== lines.length) {
    invalidQuantityResponse()
  }
  return value as unknown as QuantityReadResult<QuantityBoqWorkspace>
}

export function decodeQuantityVariance(value: unknown, query: QuantityReadQuery): QuantityReadResult<{ projectId: string, facts: QuantityVarianceFact[], boqSourceVersion: string }> {
  quantityReadEnvelope(value, query)
  const facts = value.data.facts
  if (typeof value.data.boqSourceVersion !== 'string' || !value.data.boqSourceVersion
    || !Array.isArray(facts) || !facts.every(row => quantityObject(row)
      && ['id', 'buildingId', 'itemId'].every(key => typeof row[key] === 'string' && row[key].trim())
      && ['buildingName', 'itemName', 'section', 'trade', 'unit'].every(key => typeof row[key] === 'string')
      && ['buildingSortOrder', 'itemSortOrder'].every(key => Number.isFinite(row[key]))
      && ['contractQty', 'provisionalQty', 'fieldQty', 'effectiveUnitPrice'].every(key => row[key] === null || (typeof row[key] === 'number' && Number.isFinite(row[key])))
      && isISODateTimeDTO(row.updatedAt))
    || new Set(facts.map(row => row.id)).size !== facts.length) {
    invalidQuantityResponse()
  }
  return value as unknown as QuantityReadResult<{ projectId: string, facts: QuantityVarianceFact[], boqSourceVersion: string }>
}
