import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h, ref } from 'vue'
import CentralInvoiceWorkspaceView from '~/components/invoice/CentralInvoiceWorkspaceView.vue'

async function openReview() {
  const tabs = document.querySelector('[data-workbench-tabs]') as HTMLElement
  if (getComputedStyle(tabs).display !== 'none')
    await page.getByRole('tab', { name: '校对' }).click()
}

it('项目票须手选购销主体，目录失效时不能归档，并支持键盘操作', async () => {
  const record: CentralInvoiceRecord = {
    id: 'invoice-one',
    version: '1',
    sourceKind: 'scan',
    fields: { invoiceNumber: '00123', invoiceDate: '2026-01-01', invoiceType: '', buyer: '合成购方', buyerTaxNo: 'BUYER', seller: '合成销方', sellerTaxNo: 'SELLER', amount: null, taxAmount: null, totalAmount: 100, taxRate: '', remark: '' },
    items: [],
    unrecognizedPageIndexes: [],
    ocrStatus: 'done',
    completionMethod: 'ocr',
    reviewStatus: 'reviewed',
    accountStatus: 'none',
    duplicateStatus: 'normal',
    printCount: 0,
    printRotation: 0,
    ownerKind: 'project',
    projectId: 'project-one',
    supplierId: null,
    contract: null,
    archivedAt: null,
    original: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  }
  const archive = vi.fn()
  const suppliers = ref([{ id: 'supplier-one', label: '合成销方', version: '2' }])
  await render(defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceView, {
    records: [record],
    selectedId: record.id,
    originalFile: null,
    originalLoading: false,
    busy: false,
    cloudAvailable: false,
    projects: [{ id: 'project-one', label: '合成项目' }],
    suppliers: suppliers.value,
    signatories: [{ id: 'buyer-one', label: '合成购方', version: '1' }],
    onArchive: archive,
  }) }))
  await openReview()
  const button = page.getByRole('button', { name: '归档发票' })
  await expect.element(button).toBeDisabled()
  expect(page.getByLabelText('归属类型').element().querySelector('option[value="personal"]')).toBeNull()
  await page.getByLabelText('我方购买公司').selectOptions('buyer-one')
  await page.getByLabelText('分供方公司').selectOptions('supplier-one')
  await expect.element(button).toBeEnabled()
  button.element().focus()
  await expect.element(button).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  expect(archive).toHaveBeenCalledWith({ ownerKind: 'project', projectId: 'project-one', supplierId: 'supplier-one', taxVerification: { buyerId: 'buyer-one', buyerVersion: '1', supplierVersion: '2' } })
  suppliers.value = []
  await expect.element(button).toBeDisabled()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})

it('公司开销须选择已有公司合同，且没有虚构项目', async () => {
  const record: CentralInvoiceRecord = {
    id: 'invoice-company',
    version: '1',
    sourceKind: 'scan',
    fields: { invoiceNumber: '00123', invoiceDate: '2026-01-01', invoiceType: '', buyer: '合成购方', buyerTaxNo: 'BUYER', seller: '合成销方', sellerTaxNo: 'SELLER', amount: null, taxAmount: null, totalAmount: 100, taxRate: '', remark: '' },
    items: [],
    unrecognizedPageIndexes: [],
    ocrStatus: 'done',
    completionMethod: 'ocr',
    reviewStatus: 'reviewed',
    accountStatus: 'none',
    duplicateStatus: 'normal',
    printCount: 0,
    printRotation: 0,
    ownerKind: 'company',
    projectId: null,
    supplierId: null,
    contract: null,
    archivedAt: null,
    original: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  }
  const archive = vi.fn()
  const upload = vi.fn()
  await render(defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceView, {
    records: [record],
    selectedId: record.id,
    originalFile: null,
    originalLoading: false,
    busy: false,
    cloudAvailable: false,
    projects: [],
    suppliers: [{ id: 'supplier-one', label: '合成销方', version: '2' }],
    signatories: [{ id: 'buyer-one', label: '合成购方', version: '1' }],
    contracts: [{ domain: 'company', id: 'company-one', version: '3', supplierId: 'supplier-one', label: '合成公司合同' }],
    onArchive: archive,
    onUpload: upload,
  }) }))
  await page.getByLabelText('上传归属').selectOptions('company')
  const input = page.getByLabelText('上传发票').element() as HTMLInputElement
  expect(input.disabled).toBe(false)
  const transfer = new DataTransfer()
  transfer.items.add(new File(['合成'], 'synthetic.png', { type: 'image/png' }))
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
  expect(upload).toHaveBeenCalledOnce()
  expect(upload.mock.calls[0]?.[1]).toBeNull()
  await openReview()
  expect(page.getByLabelText('归属类型').element().querySelector('option[value="project"]')).toBeNull()
  await page.getByLabelText('我方购买公司').selectOptions('buyer-one')
  await page.getByLabelText('分供方公司').selectOptions('supplier-one')
  const button = page.getByRole('button', { name: '归档发票' })
  await expect.element(button).toBeDisabled()
  await page.getByLabelText('公司支出合同').selectOptions(JSON.stringify(['company', 'company-one', '3']))
  await expect.element(button).toBeEnabled()
  button.element().focus()
  await userEvent.keyboard('{Enter}')
  expect(archive).toHaveBeenCalledWith({ ownerKind: 'company', projectId: null, supplierId: 'supplier-one', taxVerification: { buyerId: 'buyer-one', buyerVersion: '1', supplierVersion: '2' }, contract: { domain: 'company', id: 'company-one', version: '3' } })
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})
