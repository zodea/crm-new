import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { fireEvent, render, screen } from '@testing-library/vue'
import { expect, it } from 'vitest'
import CentralInvoiceWorkspaceView from '~/components/invoice/CentralInvoiceWorkspaceView.vue'

it('归档使用用户选定的稳定项目身份；未保存输入不能归档，可重新识别但不能首次识别', async () => {
  const record: CentralInvoiceRecord = {
    id: 'invoice-one',
    version: '1',
    sourceKind: 'scan',
    fields: { invoiceNumber: '00123', invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: 'BUYER', seller: '', sellerTaxNo: 'SELLER', amount: null, taxAmount: 0, totalAmount: null, taxRate: '', remark: '' },
    items: [],
    unrecognizedPageIndexes: [],
    ocrStatus: 'done',
    completionMethod: 'ocr',
    reviewStatus: 'reviewed',
    accountStatus: 'none',
    duplicateStatus: 'normal',
    printCount: 0,
    printRotation: 0,
    ownerKind: null,
    projectId: null,
    supplierId: null,
    contract: null,
    archivedAt: null,
    original: { id: 'original-one', fileName: '合成.pdf', fileSize: 100, mimeType: 'application/pdf', sha256: 'a'.repeat(64) },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  }
  const view = render(CentralInvoiceWorkspaceView, { props: { records: [record], selectedId: record.id, originalFile: null, originalLoading: false, busy: false, cloudAvailable: false, projects: [{ id: 'project-one', label: '同名项目' }, { id: 'project-two', label: '同名项目' }], suppliers: [{ id: 'supplier-one', label: '合成分供方', version: '3' }], signatories: [{ id: 'buyer-one', label: '合成购方', version: '2' }], contracts: [{ domain: 'material', id: 'contract-one', version: '4', label: '合成采购合同', projectId: 'project-two', supplierId: 'supplier-one' }] } })
  expect((screen.getByRole('button', { name: '云识别' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText('云识别未启用；默认使用本机识别。')).toBeTruthy()
  await fireEvent.update(screen.getByLabelText('归属类型'), 'project')
  await fireEvent.update(screen.getByLabelText('项目'), 'project-two')
  expect((screen.getByRole('button', { name: '归档发票' }) as HTMLButtonElement).disabled).toBe(true)
  await fireEvent.update(screen.getByLabelText('分供方公司'), 'supplier-one')
  expect((screen.getByRole('button', { name: '归档发票' }) as HTMLButtonElement).disabled).toBe(true)
  await fireEvent.update(screen.getByLabelText('我方购买公司'), 'buyer-one')
  await fireEvent.update(screen.getByLabelText('项目合同（可选）'), JSON.stringify(['material', 'contract-one', '4']))
  await fireEvent.click(screen.getByRole('button', { name: '归档发票' }))
  expect(view.emitted('archive')).toEqual([[{ ownerKind: 'project', projectId: 'project-two', supplierId: 'supplier-one', taxVerification: { buyerId: 'buyer-one', buyerVersion: '2', supplierVersion: '3' }, contract: { domain: 'material', id: 'contract-one', version: '4' } }]])
  await view.rerender({ suppliers: [] })
  expect((screen.getByRole('button', { name: '归档发票' }) as HTMLButtonElement).disabled).toBe(true)
  await fireEvent.update(screen.getByLabelText('价税合计'), '200')
  expect((screen.getByRole('button', { name: '归档发票' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: '本机重新识别' }) as HTMLButtonElement).disabled).toBe(false)
  await view.rerender({ records: [{ ...record, ocrStatus: 'pending' }] })
  expect((screen.getByRole('button', { name: '本机识别' }) as HTMLButtonElement).disabled).toBe(true)
})

it('旧扫描发票缺件时显示原因并禁止确认，补齐原件后可请求人工核对', async () => {
  const record: CentralInvoiceRecord = {
    id: 'legacy-one',
    version: '1',
    sourceKind: 'legacy',
    fields: { invoiceNumber: '00123', invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '合成销方', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: 100, taxRate: '', remark: '' },
    items: [],
    unrecognizedPageIndexes: [],
    ocrStatus: 'pending',
    completionMethod: 'legacy',
    reviewStatus: 'reviewed',
    accountStatus: 'archived',
    duplicateStatus: 'normal',
    printCount: 0,
    printRotation: 0,
    ownerKind: 'personal',
    projectId: null,
    supplierId: null,
    contract: null,
    archivedAt: '2026-01-01T00:00:00.000Z',
    original: null,
    legacy: { source: 'scan', originalState: 'session-original-unavailable', ambiguousZeroFields: ['amount'], ambiguousItemNumbers: false },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  }
  const props = { records: [record], selectedId: record.id, originalFile: null, originalLoading: false, busy: false, cloudAvailable: false, projects: [], suppliers: [], signatories: [] }
  const view = render(CentralInvoiceWorkspaceView, { props })
  expect(screen.getByText(/旧会话原件已不可用/)).toBeTruthy()
  expect((screen.getByRole('button', { name: '核对旧发票后用于新付款' }) as HTMLButtonElement).disabled).toBe(true)
  const original = { id: 'original-one', fileName: '合成.pdf', fileSize: 100, mimeType: 'application/pdf', sha256: 'a'.repeat(64) }
  await view.rerender({ ...props, records: [{ ...record, original }] })
  await fireEvent.click(screen.getByRole('button', { name: '核对旧发票后用于新付款' }))
  expect(view.emitted('confirmLegacy')).toEqual([[]])
})

it('未选归属的手工草稿可选择公司开销，须手选可信主体及公司合同且来源版本变化后重新选择', async () => {
  const record: CentralInvoiceRecord = { id: 'manual-one', version: '1', sourceKind: 'manual', fields: { invoiceNumber: 'MANUAL-01', invoiceDate: '2026-01-01', invoiceType: '', buyer: '合成购方', buyerTaxNo: 'BUYER', seller: '合成销方', sellerTaxNo: 'SELLER', amount: null, taxAmount: null, totalAmount: 100, taxRate: '', remark: '' }, items: [], unrecognizedPageIndexes: [], ocrStatus: 'pending', completionMethod: 'manual', reviewStatus: 'reviewed', accountStatus: 'none', duplicateStatus: 'normal', printCount: 0, printRotation: 0, ownerKind: null, projectId: null, supplierId: null, contract: null, archivedAt: null, original: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
  const suppliers = [{ id: 'supplier-one', label: '合成分供方', version: '1' }]
  const signatories = [{ id: 'buyer-one', label: '合成购方', version: '1' }]
  const contracts = [{ domain: 'company' as const, id: 'company-one', version: '1', label: '合成公司合同', supplierId: 'supplier-one' }, { domain: 'material' as const, id: 'project-contract', version: '1', label: '合成项目合同', projectId: 'project-one', supplierId: 'supplier-one' }]
  const view = render(CentralInvoiceWorkspaceView, { props: { records: [record], selectedId: record.id, originalFile: null, originalLoading: false, busy: false, cloudAvailable: false, projects: [{ id: 'project-one', label: '合成项目' }, { id: 'project-two', label: '另一项目' }], suppliers, signatories, contracts } })
  const owner = screen.getByLabelText('归属类型') as HTMLSelectElement
  expect(owner.querySelector('option[value="personal"]')).toBeNull()
  expect(owner.querySelector('option[value="company"]')).not.toBeNull()
  await fireEvent.update(owner, 'company')
  const button = screen.getByRole('button', { name: '归档发票' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  await fireEvent.update(screen.getByLabelText('我方购买公司'), 'buyer-one')
  await fireEvent.update(screen.getByLabelText('分供方公司'), 'supplier-one')
  expect(button.disabled).toBe(true)
  await fireEvent.update(screen.getByLabelText('公司支出合同'), JSON.stringify(['company', 'company-one', '1']))
  expect(button.disabled).toBe(false)
  await fireEvent.update(owner, 'project')
  await fireEvent.update(screen.getByLabelText('项目'), 'project-one')
  expect((screen.getByLabelText('项目合同（可选）') as HTMLSelectElement).value).toBe('')
  expect(button.disabled).toBe(false)
  await fireEvent.update(screen.getByLabelText('项目合同（可选）'), JSON.stringify(['material', 'project-contract', '1']))
  await fireEvent.update(screen.getByLabelText('项目'), 'project-two')
  expect((screen.getByLabelText('项目合同（可选）') as HTMLSelectElement).value).toBe('')
  expect(button.disabled).toBe(false)
  await fireEvent.update(owner, 'company')
  expect((screen.getByLabelText('公司支出合同') as HTMLSelectElement).value).toBe('')
  expect(button.disabled).toBe(true)
  await fireEvent.update(screen.getByLabelText('公司支出合同'), JSON.stringify(['company', 'company-one', '1']))
  await view.rerender({ contracts: [{ ...contracts[0]!, version: '2' }] })
  expect(button.disabled).toBe(true)
  await fireEvent.update(screen.getByLabelText('公司支出合同'), JSON.stringify(['company', 'company-one', '2']))
  await view.rerender({ suppliers: [{ ...suppliers[0]!, version: '2' }] })
  expect(button.disabled).toBe(true)
  expect((screen.getByLabelText('分供方公司') as HTMLSelectElement).value).toBe('')
  await fireEvent.update(screen.getByLabelText('分供方公司'), 'supplier-one')
  await fireEvent.update(screen.getByLabelText('公司支出合同'), JSON.stringify(['company', 'company-one', '2']))
  await view.rerender({ signatories: [{ ...signatories[0]!, version: '2' }] })
  expect(button.disabled).toBe(true)
  expect((screen.getByLabelText('我方购买公司') as HTMLSelectElement).value).toBe('')
  await fireEvent.update(screen.getByLabelText('我方购买公司'), 'buyer-one')
  await view.rerender({ selectionUnavailable: true })
  expect(button.disabled).toBe(true)
  await view.rerender({ selectionUnavailable: false })
  await fireEvent.click(button)
  expect(view.emitted('archive')).toEqual([[{ ownerKind: 'company', projectId: null, supplierId: 'supplier-one', taxVerification: { buyerId: 'buyer-one', buyerVersion: '2', supplierVersion: '2' }, contract: { domain: 'company', id: 'company-one', version: '2' } }]])
})
