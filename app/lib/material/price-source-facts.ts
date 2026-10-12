import type { ContractPriceFact } from '../material-contract/price-facts'
import type { QuotationRead } from '../material-quotation/contract'
import type { DeliveryPriceRecordInput, PricePartyInput } from './price-analysis'
import type { PriceConditions } from './price-comparison'
import { contractPriceSourceLink } from '../material-contract/price-facts'
import { quotationPriceFacts } from '../material-quotation/price-facts'
import { hasConfirmedDeliveryPriceSource, hasConfirmedMaterialPriceLine, normalizeMaterialIdentityText } from './price-analysis'

export interface MaterialSourcePriceFact extends PriceConditions {
  key: string
  kind: 'quotation' | 'contract' | 'delivery'
  sourceId: string
  lineId: string
  version: string | null
  date: string | null
  sourceLink: string
  sourceLabel: string
  partyName: string
  supplierId: string | null
  scope: 'general' | 'project' | 'unknown'
  projectId: string | null
  materialName: string
  spec: string
  grade: string
  brand: string
  fileIds: string[]
}
const unknownConditions = { taxIncluded: null, taxRate: null, freight: null, quantityCondition: null, paymentCondition: null, validity: null }
/** The current source owner supplies every fact. This view neither edits nor synthesizes another source. */
export function buildMaterialSourcePriceFacts(input: {
  quotations?: QuotationRead | null
  contracts?: readonly ContractPriceFact[] | null
  deliveries?: readonly DeliveryPriceRecordInput[] | null
  suppliers?: readonly PricePartyInput[]
}): MaterialSourcePriceFact[] {
  const quotes = input.quotations
    ? quotationPriceFacts(input.quotations).map((fact): MaterialSourcePriceFact => ({
        ...fact.line,
        key: `quotation:${fact.key}`,
        kind: 'quotation',
        sourceId: fact.quotationId,
        lineId: fact.lineId,
        version: fact.version,
        date: fact.quotationDate,
        sourceLink: `/material/quotations/${fact.quotationId}?version=${fact.version}`,
        sourceLabel: `报价版本 ${fact.version}`,
        partyName: fact.partyName,
        supplierId: fact.supplierId,
        scope: fact.scope as MaterialSourcePriceFact['scope'],
        projectId: fact.projectId,
        materialName: fact.line.name,
        spec: fact.line.spec,
        grade: fact.line.grade,
        brand: fact.line.brand,
        fileIds: [...fact.fileIds],
      }))
    : []
  const contracts = (input.contracts ?? []).map((fact): MaterialSourcePriceFact => ({
    ...unknownConditions,
    key: JSON.stringify(['contract', fact.dataOrigin, fact.contractId, fact.lineId]),
    kind: 'contract',
    sourceId: fact.contractId,
    lineId: fact.lineId,
    version: null,
    date: fact.date,
    sourceLink: contractPriceSourceLink(fact),
    sourceLabel: fact.contractName || fact.contractNo || '合同原行',
    partyName: fact.supplierName ?? '目录名称未读取',
    supplierId: fact.supplierId,
    projectId: fact.projectId,
    scope: fact.projectId ? 'project' : 'unknown',
    materialName: fact.materialName,
    spec: fact.spec,
    grade: fact.materialGrade,
    brand: '',
    unit: fact.unit,
    unitPrice: fact.taxInclusiveUnitPrice,
    quantity: fact.quantity,
    taxIncluded: true,
    taxRate: fact.applicableTaxRate,
    fileIds: [],
  }))
  const names = new Map(input.suppliers?.map(row => [row.id, row.name]))
  const deliveries = (input.deliveries ?? []).flatMap(record => !hasConfirmedDeliveryPriceSource(record) || !record.supplierId || !names.has(record.supplierId)
    ? []
    : record.lines.filter(line => hasConfirmedMaterialPriceLine(line, true)).map((line): MaterialSourcePriceFact => ({
        ...unknownConditions,
        key: JSON.stringify(['delivery', record.dataOrigin ?? 'native', record.id, record.version ?? null, line.id]),
        kind: 'delivery',
        sourceId: record.id,
        lineId: line.id,
        version: record.version ?? null,
        date: record.deliveryDate,
        sourceLink: `/material/delivery/archive/${encodeURIComponent(record.id)}${record.dataOrigin ? `?origin=${record.dataOrigin}` : ''}`,
        sourceLabel: record.orderNo || record.id,
        partyName: names.get(record.supplierId!)!,
        supplierId: record.supplierId,
        projectId: record.projectId,
        scope: 'project',
        materialName: line.materialName,
        spec: line.spec,
        grade: '',
        brand: '',
        unit: line.unit,
        unitPrice: line.unitPrice,
        quantity: line.qty ?? null,
        fileIds: record.assetId ? [record.assetId] : [],
      })))
  return [...quotes, ...contracts, ...deliveries]
}
export function filterMaterialSourcePrices(rows: readonly MaterialSourcePriceFact[], filter: {
  search?: string
  projectId?: string
  supplierId?: string
  unlinkedOnly?: boolean
}) {
  const search = normalizeMaterialIdentityText(filter.search ?? '')
  return rows.filter(row => (!filter.projectId || row.scope === 'general' || (row.scope === 'project' && row.projectId === filter.projectId))
    && (!filter.unlinkedOnly || row.supplierId === null)
    && (!filter.supplierId || row.supplierId === filter.supplierId)
    && normalizeMaterialIdentityText([row.materialName, row.spec, row.grade, row.brand, row.unit].join(' ')).includes(search))
}
