import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h } from 'vue'
import InvoiceMigrationPanel from '~/components/migration/InvoiceMigrationPanel.vue'

vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true }) }))
vi.mock('~/lib/read-model/authority', () => ({ bindReadAuthority: () => {} }))
vi.mock('~/lib/db/native-snapshot', () => ({ inspectNativeMigrationSnapshot: async () => ({ sha256: 'a'.repeat(64), schemaVersion: 60 }) }))

it('多视口下核对关联和原提交可用键盘操作且页面不横向溢出', async () => {
  let pending = true
  const recover = vi.fn(async () => {
    pending = false
    return { outcome: 'not-applied', commandId: 'command-one' }
  })
  const session = { state: async () => [], pending: () => pending ? { commandId: 'command-one' } : null, recover }
  const previewClient = {
    source: async () => ({ sourceSha256: 'a'.repeat(64), schemaVersion: 60, invoices: [{ legacyId: 'invoice-one', invoiceNumber: '001', deleted: false, sourceState: 'session-original-unavailable', ambiguousZeroFields: ['amount'], historicalAllocationCount: 0, originalCount: 0, originalBodyStates: [] }], references: [{ table: 'projects', legacyId: 'project-old', label: '旧项目', deleted: false }], orphanLogCount: 0 }),
    mappings: async () => ({ sourceSha256: 'a'.repeat(64), invoiceCount: 1, missingAllocationIds: [], orphanLogCount: 0 }),
  }
  const catalogClient = { load: async () => ({ projects: [{ id: 'project-new', label: '新项目', version: '1', sourceVersion: 'projects:1' }], suppliers: [], contracts: [] }) }
  await render(defineComponent({ setup: () => () => h('main', { style: { minWidth: '0', maxWidth: '100%', padding: '12px' } }, h(InvoiceMigrationPanel, { session, previewClient, catalogClient } as never)) }))
  const recoverButton = page.getByRole('button', { name: '核对原提交' })
  await expect.element(recoverButton).toBeEnabled()
  recoverButton.element().focus()
  await expect.element(recoverButton).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('已核对原提交未生效，可以重新预检。')).toBeVisible()
  const input = page.getByLabelText('选择完整 SQLite 快照').element() as HTMLInputElement
  const transfer = new DataTransfer()
  transfer.items.add(new File(['synthetic'], 'synthetic.sqlite'))
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await expect.element(page.getByLabelText(/项目：旧项目/)).toBeEnabled()
  await page.getByLabelText(/项目：旧项目/).selectOptions('project-new')
  const check = page.getByRole('button', { name: '核对映射与历史付款' })
  await expect.element(check).toBeEnabled()
  check.element().focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('button', { name: '确认迁入' })).toBeEnabled()
  const panel = document.querySelector<HTMLElement>('[aria-label="旧发票迁入"]')!
  expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
  expect(recover).toHaveBeenCalledOnce()
})

it('多视口下逐票手选公司合同、分供方和我方主体后才能预检', async () => {
  const check = vi.fn(async () => ({ sourceSha256: 'a'.repeat(64), invoiceCount: 1, missingAllocationIds: [], orphanLogCount: 0 }))
  const session = { state: async () => [], pending: () => null }
  const previewClient = {
    source: async () => ({ sourceSha256: 'a'.repeat(64), schemaVersion: 60, invoices: [{ legacyId: 'invoice-one', invoiceNumber: '001', deleted: false, sourceState: 'session-original-unavailable', ambiguousZeroFields: [], historicalAllocationCount: 0, originalCount: 0, originalBodyStates: [], companyContractId: 'legacy-company' }], references: [{ table: 'company_expense_contracts', legacyId: 'legacy-company', label: '旧公司合同', deleted: false }], orphanLogCount: 0 }),
    mappings: check,
  }
  const catalogClient = { load: async () => ({ projects: [], suppliers: [{ id: 'supplier-one', label: '真实分供方', version: '2', sourceVersion: 'suppliers:1' }], contracts: [{ id: 'company-one', domain: 'company', label: '真实公司合同', version: '3', projectId: null, supplierId: 'supplier-one' }] }) }
  const loadBuyers = async () => [{ id: 'buyer-one', label: '真实我方主体', version: '4' }]
  await render(defineComponent({ setup: () => () => h('main', { style: { minWidth: '0', maxWidth: '100%', padding: '12px' } }, h(InvoiceMigrationPanel, { session, previewClient, catalogClient, loadBuyers } as never)) }))
  await expect.element(page.getByLabelText('选择完整 SQLite 快照')).toBeEnabled()
  const input = page.getByLabelText('选择完整 SQLite 快照').element() as HTMLInputElement
  const transfer = new DataTransfer()
  transfer.items.add(new File(['synthetic'], 'synthetic.sqlite'))
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await expect.element(page.getByLabelText(/公司支出合同：旧公司合同/)).toBeEnabled()
  await page.getByLabelText(/公司支出合同：旧公司合同/).selectOptions('company:company-one')
  const button = page.getByRole('button', { name: '核对映射与历史付款' })
  await expect.element(button).toBeDisabled()
  await page.getByLabelText('选择已有分供方').selectOptions('supplier-one')
  await page.getByLabelText('选择已有我方主体').selectOptions('buyer-one')
  await expect.element(button).toBeEnabled()
  button.element().focus()
  await expect.element(button).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('映射预检通过；提交时会再次核对。')).toBeVisible()
  await expect.element(page.getByRole('button', { name: '确认迁入' })).toBeEnabled()
  expect(check).toHaveBeenCalledOnce()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})
