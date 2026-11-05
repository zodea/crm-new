import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import type { InvoiceCorrectionContent } from '~/lib/invoice/correction-contract'
import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h, ref } from 'vue'
import CentralInvoiceCorrectionForm from '~/components/invoice/CentralInvoiceCorrectionForm.vue'

it('更正票面与归属在各视口可键盘操作，真实零和未知保持区分', async () => {
  const invoice: CentralInvoiceRecord = { id: 'invoice-browser', version: '1', sourceKind: 'manual', fields: { invoiceNumber: 'B-001', invoiceDate: '2026-01-01', invoiceType: '', buyer: '购方', buyerTaxNo: 'BUYER', seller: '销方', sellerTaxNo: 'SELLER', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' }, items: [], unrecognizedPageIndexes: [], ocrStatus: 'pending', completionMethod: 'manual', reviewStatus: 'reviewed', accountStatus: 'archived', duplicateStatus: 'normal', printCount: 0, printRotation: 0, ownerKind: 'project', projectId: 'project-browser', supplierId: 'supplier-browser', contract: null, archivedAt: '2026-01-01T00:00:00.000Z', original: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
  const baseline = { fields: invoice.fields, items: [], ownerKind: 'project' as const, projectId: 'project-browser', supplierId: 'supplier-browser', supplierVersion: '1', buyer: { id: 'buyer-browser', version: '1' }, contract: null }
  const proposed = ref(structuredClone(baseline))
  const reason = ref('')
  const supplierVersion = ref('1')
  await render(defineComponent({ setup: () => () => h(CentralInvoiceCorrectionForm, { invoice, baseline, proposed: proposed.value, reason: reason.value, catalog: { projects: [{ id: 'project-browser', label: '合成项目', version: '1', sourceVersion: 'projects:1' }], suppliers: [{ id: 'supplier-browser', label: '合成销方', version: supplierVersion.value, sourceVersion: `suppliers:${supplierVersion.value}` }], contracts: [{ id: 'company-browser', label: '合成公司合同', domain: 'company', version: '1', projectId: null, supplierId: 'supplier-browser' }] }, signatories: [{ id: 'buyer-browser', label: '合成购方', version: '1' }], draft: null, busy: false, editable: true, onProposed: value => proposed.value = value, onReason: value => reason.value = value }) }))
  expect((page.getByLabelText('不含税金额').element() as HTMLInputElement).value).toBe('')
  expect((page.getByLabelText('税额').element() as HTMLInputElement).value).toBe('0')
  await page.getByLabelText('税额').fill('3')
  const apply = page.getByRole('button', { name: '应用票面修改' })
  ;(apply.element() as HTMLElement).focus()
  await expect.element(apply).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('税额：0 → 3')).toBeVisible()
  await page.getByLabelText('更正归属', { exact: true }).selectOptions('company')
  expect(Array.from((page.getByLabelText('更正归属', { exact: true }).element() as HTMLSelectElement).options).map(option => option.value)).not.toContain('personal')
  await page.getByLabelText('更正关联合同').selectOptions(JSON.stringify(['company', 'company-browser', '1']))
  expect(proposed.value.projectId).toBeNull()
  expect(proposed.value.contract).toEqual({ domain: 'company', id: 'company-browser', version: '1' })
  supplierVersion.value = '2'
  const supplier = page.getByLabelText('更正分供方')
  await expect.element(supplier).toHaveValue('')
  await supplier.selectOptions('supplier-browser')
  expect(proposed.value.supplierVersion).toBe('2')
  expect(proposed.value.contract).toBeNull()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})

it.each(['project', 'company'] as const)('历史个人票更正草稿切换为 %s 后可以恢复个人归属', async (target) => {
  const invoice: CentralInvoiceRecord = { id: 'legacy-personal', version: '1', sourceKind: 'legacy', fields: { invoiceNumber: 'OLD-001', invoiceDate: '2026-01-01', invoiceType: '', buyer: '购方', buyerTaxNo: 'BUYER', seller: '销方', sellerTaxNo: 'SELLER', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' }, items: [], unrecognizedPageIndexes: [], ocrStatus: 'pending', completionMethod: 'legacy', reviewStatus: 'reviewed', accountStatus: 'archived', duplicateStatus: 'normal', printCount: 0, printRotation: 0, ownerKind: 'personal', projectId: null, supplierId: 'supplier-browser', contract: null, archivedAt: '2026-01-01T00:00:00.000Z', original: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
  const baseline: InvoiceCorrectionContent = { fields: invoice.fields, items: [], ownerKind: 'personal', projectId: null, supplierId: 'supplier-browser', supplierVersion: '1', buyer: { id: 'buyer-browser', version: '1' }, contract: null }
  const proposed = ref<InvoiceCorrectionContent>(structuredClone(baseline))
  await render(defineComponent({ setup: () => () => h(CentralInvoiceCorrectionForm, { invoice, baseline, proposed: proposed.value, reason: '保留的更正原因', catalog: { projects: [{ id: 'project-browser', label: '合成项目', version: '1', sourceVersion: 'projects:1' }], suppliers: [{ id: 'supplier-browser', label: '合成销方', version: '1', sourceVersion: 'suppliers:1' }], contracts: [{ id: 'company-browser', label: '合成公司合同', domain: 'company', version: '1', projectId: null, supplierId: 'supplier-browser' }] }, signatories: [{ id: 'buyer-browser', label: '合成购方', version: '1' }], draft: null, busy: false, editable: true, onProposed: value => proposed.value = value }) }))
  const owner = page.getByLabelText('更正归属', { exact: true })
  await owner.selectOptions(target)
  if (target === 'project')
    await page.getByLabelText('更正归属和依据').getByRole('combobox').nth(1).selectOptions('project-browser')
  else
    await page.getByLabelText('更正关联合同').selectOptions(JSON.stringify(['company', 'company-browser', '1']))
  await expect.element(owner).toHaveValue(target)
  expect(Array.from((owner.element() as HTMLSelectElement).options).map(option => option.value)).toContain('personal')
  ;(owner.element() as HTMLElement).focus()
  await expect.element(owner).toHaveFocus()
  await userEvent.keyboard('{Home}')
  await expect.element(owner).toHaveValue('personal')
  expect(proposed.value).toMatchObject({ ownerKind: 'personal', projectId: null, contract: null, supplierId: 'supplier-browser', buyer: { id: 'buyer-browser', version: '1' } })
  await expect.element(page.getByLabelText('更正原因')).toHaveValue('保留的更正原因')
})
