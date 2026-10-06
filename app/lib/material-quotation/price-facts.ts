import type { QuotationLine, QuotationRead } from './contract'
import { comparablePriceDifference, convertOriginalPrice } from '../material/price-comparison'

export interface QuotationPriceFact {
  key: string
  quotationId: string
  lineId: string
  version: string
  partyName: string
  supplierId: string | null
  scope: string
  projectId: string | null
  quotationDate: string | null
  savedAt: string
  line: QuotationLine
  fileIds: string[]
}
/** Every price point belongs to an actual frozen quote revision and original line. Unknown party names are never supplier IDs. */
export function quotationPriceFacts(read: QuotationRead): QuotationPriceFact[] {
  return read.records.flatMap(record => record.history.flatMap((history) => {
    const relation = record.relations?.find(row => row.version === history.version)
    return history.draft.lines.map(line => ({ key: `${record.id}:${history.version}:${line.id}`, quotationId: record.id, lineId: line.id, version: history.version, partyName: history.draft.partyName, supplierId: relation?.supplierId ?? history.draft.supplierId, scope: history.draft.scope, projectId: relation?.projectId ?? history.draft.projectId, quotationDate: history.draft.quotationDate, savedAt: history.occurredAt, line: { ...line }, fileIds: history.files.filter(file => file.deletedAt === null).map(file => file.id) }))
  }))
}
export function convertedQuotationPrice(fact: QuotationPriceFact, targetUnit: string, factor: number, basis: string) {
  const result = convertOriginalPrice(fact.line, { unit: targetUnit, factor, basis }, '请明确比较单位、正换算系数和真实依据')
  return { targetUnit: result.unit, factor, basis, unitPrice: result.unitPrice, quantity: result.quantity, source: fact }
}
export function quotationDifference(base: QuotationPriceFact, candidate: QuotationPriceFact, input: {
  materialBasis: string
  targetUnit: string
  factor: number
  conversionBasis: string
}) {
  return comparablePriceDifference(base.line, candidate.line, { unit: input.targetUnit, factor: input.factor, basis: input.conversionBasis, materialBasis: input.materialBasis })
}
