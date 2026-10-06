import type { ContractPriceFact } from '~/lib/material-contract/price-facts'
import type { QuotationRead, QuotationRecord } from '~/lib/material-quotation/contract'
import type { DeliveryPriceRecordInput } from '~/lib/material/price-analysis'
import { expect, it } from 'vitest'
import { newQuotationDraft } from '~/lib/material-quotation/contract'
import { buildMaterialPriceCatalog } from '~/lib/material/price-analysis'
import { comparablePriceDifference } from '~/lib/material/price-comparison'
import { buildMaterialSourcePriceFacts, filterMaterialSourcePrices } from '~/lib/material/price-source-facts'
import { createReadMeta, withReadMeta } from '../../server/utils/read-meta'

const at = '2026-10-05T00:00:00.000Z'
const actor = { workspaceId: 'price-source-workspace', actorId: 'price-source-owner', capabilities: ['material-quotation:read'] }
function quote(id: string, scope: 'general' | 'project' | 'unknown', projectId: string | null, supplierId: string | null): QuotationRecord {
  const draft = { ...newQuotationDraft(), partyName: '同名报价方', scope, projectId, supplierId, lines: [{ ...newQuotationDraft().lines[0]!, id: `${id}-line`, name: '原材料', unit: '米', unitPrice: 0, taxIncluded: true, taxRate: 0, freight: '不含运费', quantityCondition: '原数量范围', paymentCondition: '原付款条件', validity: '原有效期' }] }
  return { id, draft, version: '1', createdAt: at, updatedAt: at, attachments: [], history: [{ version: '1', draft, files: [], commandId: `${id}-original-command`, actorId: actor.actorId, occurredAt: at }] }
}
function sources() {
  const meta = createReadMeta({ session: actor, schemaVersion: 'material-quotation-read-v1', operation: 'quotation:list', dataOrigin: 'real', asOf: at, coverage: 'complete', scope: {}, sources: [{ key: 'material-quotations', state: 'readable', sourceVersion: 'actual:4', asOf: at }] })
  const quotations: QuotationRead = withReadMeta({ records: [quote('general-quote', 'general', null, null), quote('project-one-quote', 'project', 'project-one', 'supplier-one'), quote('project-two-quote', 'project', 'project-two', 'supplier-two'), quote('unknown-quote', 'unknown', null, null)] }, meta)
  const contract: ContractPriceFact = { dataOrigin: 'real', contractId: 'real-contract', lineId: 'real-contract-line', parentContractId: null, contractName: '原合同', contractNo: 'CA-001', supplierId: 'supplier-one', supplierName: '同名报价方', projectId: 'project-one', projectName: '原项目', date: '2026-10-01', materialName: '原材料', spec: '原规格', materialGrade: '原材质', unit: '米', quantity: 1, taxInclusiveUnitPrice: 20, applicableTaxRate: null }
  const delivery: DeliveryPriceRecordInput = { dataOrigin: 'real', id: 'real-delivery', version: '9', assetId: 'real-delivery-original', projectId: 'project-one', supplierId: 'supplier-one', orderNo: 'DL-001', deliveryDate: '2026-10-02', archived: true, reviewStatus: 'reviewed', ocrStatus: 'done', naturalKeyDuplicate: false, currentValuesConfirmed: true, hasSourceFile: true, lines: [{ id: 'real-delivery-line', materialName: '原材料', spec: '原规格', unit: '米', unitPrice: 0, amount: 0, qty: 1, currentValueConfirmed: true }] }
  return { quotations, contract, delivery, suppliers: [{ id: 'supplier-one', name: '同名报价方' }, { id: 'supplier-two', name: '另一实际分供方' }] }
}
it('三类原价实际同屏投影保原头/行/日期/版本/零，未知税条件不从别种来源套值', () => {
  const f = sources()
  const rows = buildMaterialSourcePriceFacts({ quotations: f.quotations, contracts: [f.contract], deliveries: [f.delivery], suppliers: f.suppliers })
  expect(rows.filter(row => row.kind === 'quotation').map(row => row.sourceId)).toEqual(['general-quote', 'project-one-quote', 'project-two-quote', 'unknown-quote'])
  expect(rows.find(row => row.sourceId === 'general-quote')).toMatchObject({ sourceLink: '/material/quotations/general-quote?version=1', lineId: 'general-quote-line', version: '1', date: null, unitPrice: 0, supplierId: null })
  expect(rows.find(row => row.kind === 'contract')).toMatchObject({ sourceId: 'real-contract', lineId: 'real-contract-line', version: null, taxIncluded: true, taxRate: null, freight: null, quantityCondition: null })
  expect(rows.find(row => row.kind === 'delivery')).toMatchObject({ sourceId: 'real-delivery', lineId: 'real-delivery-line', version: '9', date: '2026-10-02', unitPrice: 0, fileIds: ['real-delivery-original'], taxIncluded: null, taxRate: null })
  expect(buildMaterialPriceCatalog([f.delivery], f.suppliers, [{ id: 'project-one', name: '原项目' }])).toEqual([])
  const base = rows.find(row => row.sourceId === 'general-quote')!
  const candidate = rows.find(row => row.kind === 'contract')!
  expect(comparablePriceDifference(base, candidate, { unit: '米', factor: 1, basis: '同原单位', materialBasis: '原规格材质核验' }).difference).toBeNull()
})
it('项目只含通用或真实同项目，未知范围独立；同名不映射真实supplier身份', () => {
  const f = sources()
  const rows = buildMaterialSourcePriceFacts({ quotations: f.quotations, contracts: [f.contract], deliveries: [f.delivery], suppliers: f.suppliers })
  expect(filterMaterialSourcePrices(rows, { projectId: 'project-one' }).map(row => row.sourceId)).toEqual(['general-quote', 'project-one-quote', 'real-contract', 'real-delivery'])
  expect(filterMaterialSourcePrices(rows, { supplierId: 'supplier-one' }).map(row => row.sourceId)).toEqual(['project-one-quote', 'real-contract', 'real-delivery'])
  expect(filterMaterialSourcePrices(rows, { unlinkedOnly: true }).map(row => row.sourceId)).toEqual(['general-quote', 'unknown-quote'])
  expect(f.quotations.records[0]!.draft.supplierId).toBeNull()
})
it.each(['archived', 'currentValuesConfirmed', 'hasSourceFile'] as const)('送货 %s 未证明不能混入综合原价', (field) => {
  const f = sources()
  expect(buildMaterialSourcePriceFacts({ deliveries: [{ ...f.delivery, [field]: false }], suppliers: f.suppliers })).toEqual([])
})
it('重复、未核对、待确认/未知材料价、运费行均保原送货有效资格；空条件不能当作两方已一致', () => {
  const f = sources()
  for (const delivery of [{ ...f.delivery, naturalKeyDuplicate: true }, { ...f.delivery, reviewStatus: 'unreviewed' as const }, { ...f.delivery, lines: [{ ...f.delivery.lines[0]!, unitPrice: null }] }, { ...f.delivery, lines: [{ ...f.delivery.lines[0]!, currentValueConfirmed: false }] }, { ...f.delivery, lines: [{ ...f.delivery.lines[0]!, materialName: '运费' }] }])
    expect(buildMaterialSourcePriceFacts({ deliveries: [delivery], suppliers: f.suppliers })).toEqual([])
  const rows = buildMaterialSourcePriceFacts({ quotations: f.quotations })
  const base = rows[0]!
  expect(comparablePriceDifference(base, { ...base, unitPrice: 18 }, { unit: '米', factor: 1, basis: '原单位核实', materialBasis: '逐行原件规格核验' }).difference).toBe(18)
  expect(comparablePriceDifference({ ...base, validity: '' }, { ...base, validity: '' }, { unit: '米', factor: 1, basis: '原单位核实', materialBasis: '逐行原件规格核验' }).difference).toBeNull()
})
