import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h, ref } from 'vue'
import CentralInvoiceWorkspaceView from '~/components/invoice/CentralInvoiceWorkspaceView.vue'

it('手工票键盘选择公司开销并核对来源版本，失权时不能归档', async () => {
  const record: CentralInvoiceRecord = { id: 'manual-company', version: '1', sourceKind: 'manual', fields: { invoiceNumber: 'MANUAL-01', invoiceDate: '2026-01-01', invoiceType: '', buyer: '合成购方', buyerTaxNo: 'BUYER', seller: '合成销方', sellerTaxNo: 'SELLER', amount: null, taxAmount: null, totalAmount: 100, taxRate: '', remark: '' }, items: [], unrecognizedPageIndexes: [], ocrStatus: 'pending', completionMethod: 'manual', reviewStatus: 'reviewed', accountStatus: 'none', duplicateStatus: 'normal', printCount: 0, printRotation: 0, ownerKind: null, projectId: null, supplierId: null, contract: null, archivedAt: null, original: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
  const archive = vi.fn()
  const supplier = ref([{ id: 'supplier-one', label: '合成分供方', version: '1' }])
  const buyer = ref([{ id: 'buyer-one', label: '合成购方', version: '1' }])
  const contracts = ref([{ domain: 'company' as const, id: 'company-one', version: '1', label: '合成公司合同', supplierId: 'supplier-one' }])
  const unavailable = ref(false)
  await render(defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceView, { records: [record], selectedId: record.id, originalFile: null, originalLoading: false, busy: false, cloudAvailable: false, projects: [{ id: 'project-one', label: '合成项目' }], suppliers: supplier.value, signatories: buyer.value, contracts: contracts.value, selectionUnavailable: unavailable.value, onArchive: archive }) }))
  const tabs = document.querySelector('[data-workbench-tabs]') as HTMLElement
  if (getComputedStyle(tabs).display !== 'none')
    await page.getByRole('tab', { name: '校对' }).click()
  const owner = page.getByLabelText('归属类型')
  expect(owner.element().querySelector('option[value="personal"]')).toBeNull()
  await owner.selectOptions('company')
  await page.getByLabelText('我方购买公司').selectOptions('buyer-one')
  await page.getByLabelText('分供方公司').selectOptions('supplier-one')
  const button = page.getByRole('button', { name: '归档发票' })
  await expect.element(button).toBeDisabled()
  await page.getByLabelText('公司支出合同').selectOptions(JSON.stringify(['company', 'company-one', '1']))
  await expect.element(button).toBeEnabled()
  unavailable.value = true
  await expect.element(button).toBeDisabled()
  unavailable.value = false
  supplier.value = [{ ...supplier.value[0]!, version: '2' }]
  await expect.element(button).toBeDisabled()
  await expect.element(page.getByLabelText('分供方公司')).toHaveValue('')
  await page.getByLabelText('分供方公司').selectOptions('supplier-one')
  await page.getByLabelText('公司支出合同').selectOptions(JSON.stringify(['company', 'company-one', '1']))
  button.element().focus()
  await expect.element(button).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  expect(archive).toHaveBeenCalledExactlyOnceWith({ ownerKind: 'company', projectId: null, supplierId: 'supplier-one', taxVerification: { buyerId: 'buyer-one', buyerVersion: '1', supplierVersion: '2' }, contract: { domain: 'company', id: 'company-one', version: '1' } })
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})
