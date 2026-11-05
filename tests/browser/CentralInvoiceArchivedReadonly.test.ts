import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h, shallowRef } from 'vue'
import CentralInvoiceWorkspaceScreen from '~/components/invoice/CentralInvoiceWorkspaceScreen.vue'

const confirm = vi.hoisted(() => vi.fn(async () => false))
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm, undoToast: () => {} }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))

it('归档票可键盘聚焦复制，动态归档保留草稿并阻止误编辑', async ({ task }) => {
  const match = /^chromium-(390|768|1024|1280|1440)$/.exec(task.file.projectName ?? '')
  expect(match).not.toBeNull()
  expect(window.innerWidth).toBe(Number(match![1]))
  const record: CentralInvoiceRecord = { id: 'one', version: '1', sourceKind: 'manual', fields: { invoiceNumber: 'ARCHIVE-1', invoiceDate: '2026-01-01', invoiceType: '', buyer: '原购方', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: 10, taxRate: '', remark: '' }, items: [{ name: '合成明细', spec: '', unit: '', quantity: 1, unitPrice: 10, amount: 10, taxRate: '', taxAmount: 0 }], unrecognizedPageIndexes: [], ocrStatus: 'pending', completionMethod: 'manual', reviewStatus: 'reviewed', accountStatus: 'none', duplicateStatus: 'normal', printCount: 0, printRotation: 0, ownerKind: 'project', projectId: 'project-one', supplierId: null, contract: null, archivedAt: null, original: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
  const other = { ...record, id: 'two', fields: { ...record.fields, invoiceNumber: 'OTHER-2' } }
  const workspace = { records: shallowRef([record, other]), loading: shallowRef(false), readState: shallowRef('ready'), sourceVersion: shallowRef('invoices:1'), load: async () => {}, pending: () => null }
  confirm.mockReset().mockResolvedValue(false)
  const link = defineComponent({ props: { to: { type: String, required: true } }, setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) })
  await render(defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceScreen, { workspace: workspace as never, projects: [], suppliers: [], signatories: [], initialSelectedId: record.id }) }), { global: { stubs: { NuxtLink: link } } })
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '校对' }).click()
  const buyer = page.getByLabelText('购买方', { exact: true })
  await buyer.fill('未保存购方')
  workspace.records.value = [{ ...record, version: '2', accountStatus: 'archived', archivedAt: '2026-01-02T00:00:00.000Z' }, other]
  await expect.element(buyer).toHaveValue('未保存购方')
  await vi.waitFor(() => expect((buyer.element() as HTMLInputElement).readOnly).toBe(true))
  ;(buyer.element() as HTMLInputElement).focus()
  await expect.element(buyer).toHaveFocus()
  await userEvent.keyboard('X')
  await expect.element(buyer).toHaveValue('未保存购方')
  const buyerInput = buyer.element() as HTMLInputElement
  buyerInput.select()
  expect(buyerInput.value.slice(buyerInput.selectionStart!, buyerInput.selectionEnd!)).toBe('未保存购方')
  expect((page.getByLabelText('开票日期').element() as HTMLInputElement).readOnly).toBe(true)
  expect((page.getByLabelText('税额', { exact: true }).element() as HTMLInputElement).readOnly).toBe(true)
  await page.getByText('货物明细（1）').click()
  expect((page.getByLabelText('第 1 行名称').element() as HTMLInputElement).readOnly).toBe(true)
  expect((page.getByLabelText('第 1 行数量').element() as HTMLInputElement).readOnly).toBe(true)
  await expect.element(page.getByRole('button', { name: '添加明细' })).toBeDisabled()
  await expect.element(page.getByRole('button', { name: '删除第 1 行' })).toBeDisabled()
  await expect.element(page.getByRole('link', { name: '查看或新建更正单' })).toHaveAttribute('href', '/finance/invoice/correction/one')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '队列' }).click()
  await page.getByRole('button', { name: /OTHER-2/ }).click()
  expect(confirm).toHaveBeenCalledOnce()
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '校对' }).click()
  await expect.element(buyer).toHaveValue('未保存购方')
})
