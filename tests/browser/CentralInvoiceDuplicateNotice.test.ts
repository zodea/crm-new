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

it('候选可键盘选择并遵守离开保护，窄屏、失权和恢复时不丢输入', async () => {
  const record: CentralInvoiceRecord = { id: 'invoice-one', version: '1', sourceKind: 'manual', fields: { invoiceNumber: '00000000000000000123', invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: null, taxRate: '', remark: '' }, items: [], unrecognizedPageIndexes: [], ocrStatus: 'pending', completionMethod: null, reviewStatus: 'unreviewed', accountStatus: 'none', duplicateStatus: 'duplicate', printCount: 0, printRotation: 0, ownerKind: null, projectId: null, supplierId: null, contract: null, archivedAt: null, original: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
  const other: CentralInvoiceRecord = { ...record, id: 'invoice-two', duplicateStatus: 'normal' }
  const readState = shallowRef('ready')
  const workspace = { records: shallowRef([record, other]), loading: shallowRef(false), readState, sourceVersion: shallowRef('invoices:1'), load: async () => {}, pending: () => null }
  confirm.mockReset().mockResolvedValue(false)
  await render(defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceScreen, { workspace: workspace as never, projects: [], suppliers: [], signatories: [], initialSelectedId: record.id }) }), { global: { stubs: { NuxtLink: true } } })
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '校对' }).click()
  const number = page.getByLabelText('发票号码')
  await number.fill('人工未保存票号')
  await expect.element(page.getByText('此处依据已保存票号；未保存修改尚未参与核对。')).toBeVisible()
  const candidate = page.getByRole('button', { name: /ID：invoice-two/ })
  candidate.element().focus()
  await expect.element(candidate).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  expect(confirm).toHaveBeenCalledOnce()
  await expect.element(number).toHaveValue('人工未保存票号')
  const notice = page.getByRole('region', { name: '同票号候选' }).element()
  expect(notice.scrollWidth).toBeLessThanOrEqual(notice.clientWidth + 1)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
  readState.value = 'unavailable'
  await expect.element(page.getByText('发票来源尚不可用。')).toBeVisible()
  expect(document.querySelector('[aria-label="同票号候选"]')).toBeNull()
  readState.value = 'ready'
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '校对' }).click()
  await expect.element(number).toHaveValue('人工未保存票号')
})
