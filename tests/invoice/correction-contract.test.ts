import type { InvoiceCorrectionContent } from '../../app/lib/invoice/correction-contract'
import { expect, it } from 'vitest'
import { invoiceCorrectionChanges } from '../../app/lib/invoice/correction-contract'

function baseline(): InvoiceCorrectionContent {
  return {
    fields: { invoiceNumber: '001', invoiceDate: '2026-10-07', invoiceType: '增值税', buyer: '旧购方', buyerTaxNo: 'BUYER', seller: '旧销方', sellerTaxNo: 'SELLER', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' },
    items: [{ name: '服务', spec: '', unit: '', quantity: null, unitPrice: 0, amount: null, taxRate: '', taxAmount: null }],
    ownerKind: 'project',
    projectId: 'project-one',
    supplierId: 'supplier-one',
    supplierVersion: '1',
    buyer: null,
    contract: { domain: 'material', id: 'same-id', version: '1' },
  }
}

it('更正对照保留未知与真实零，逐项记录票面、明细和主体关系变化', () => {
  const before = baseline()
  const after = structuredClone(before)
  after.fields.amount = 0
  after.fields.taxAmount = null
  after.items[0]!.quantity = 0
  after.projectId = 'project-two'
  after.supplierId = 'supplier-two'
  after.buyer = { id: 'buyer-one', version: '2' }
  after.contract = { domain: 'auxiliary', id: 'same-id', version: '1' }
  const changes = invoiceCorrectionChanges(before, after)
  expect(changes.map(row => row.path)).toEqual(['fields.amount', 'fields.taxAmount', 'items', 'projectId', 'supplierId', 'buyer', 'contract'])
  expect(changes.find(row => row.path === 'fields.amount')).toMatchObject({ before: null, after: 0 })
  expect(changes.find(row => row.path === 'fields.taxAmount')).toMatchObject({ before: 0, after: null })
  expect(changes.find(row => row.path === 'buyer')).toMatchObject({ before: null, after: { id: 'buyer-one', version: '2' } })
  expect(changes.find(row => row.path === 'contract')).toMatchObject({ before: { domain: 'material', id: 'same-id' }, after: { domain: 'auxiliary', id: 'same-id' } })
  after.items[0]!.quantity = 99
  expect(changes.find(row => row.path === 'items')?.after).toMatchObject([{ quantity: 0 }])
})

it('对象属性顺序不同但原始字段不变时，不制造更正差异', () => {
  const before = baseline()
  const after = structuredClone(before)
  after.contract = { version: '1', id: 'same-id', domain: 'material' }
  expect(invoiceCorrectionChanges(before, after)).toEqual([])
})
