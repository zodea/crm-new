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

it('货物明细默认折叠，展开后在独立区域键盘滚动并保留未保存输入', async ({ task }) => {
  const match = /^chromium-(390|768|1024|1280|1440)$/.exec(task.file.projectName ?? '')
  expect(match).not.toBeNull()
  expect(window.innerWidth).toBe(Number(match![1]))
  const items = Array.from({ length: 15 }, (_, index) => ({ name: `合成明细${index + 1}`, spec: '', unit: '', quantity: 1, unitPrice: 10, amount: 10, taxRate: '', taxAmount: 0 }))
  const record: CentralInvoiceRecord = { id: 'one', version: '1', sourceKind: 'manual', fields: { invoiceNumber: 'SCROLL-1', invoiceDate: '', invoiceType: '', buyer: '原购方', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: 10, taxRate: '', remark: '' }, items, unrecognizedPageIndexes: [], ocrStatus: 'pending', completionMethod: 'manual', reviewStatus: 'reviewed', accountStatus: 'none', duplicateStatus: 'normal', printCount: 0, printRotation: 0, ownerKind: 'project', projectId: 'project-one', supplierId: null, contract: null, archivedAt: null, original: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
  const other = { ...record, id: 'two', fields: { ...record.fields, invoiceNumber: 'OTHER-2' } }
  const workspace = { records: shallowRef([record, other]), loading: shallowRef(false), readState: shallowRef('ready'), sourceVersion: shallowRef('invoices:1'), load: async () => {}, pending: () => null }
  const link = defineComponent({ props: { to: { type: String, required: true } }, setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) })
  confirm.mockReset().mockResolvedValue(false)
  await render(defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceScreen, { workspace: workspace as never, projects: [], suppliers: [], signatories: [], initialSelectedId: record.id }) }), { global: { stubs: { NuxtLink: link } } })
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '校对' }).click()
  const buyer = page.getByLabelText('购买方', { exact: true })
  await buyer.fill('未保存购方')
  const summary = page.getByText('货物明细（15）')
  const details = summary.element().closest('details')!
  expect(details.open).toBe(false)
  ;(summary.element() as HTMLElement).focus()
  await expect.element(summary).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  expect(details.open).toBe(true)
  const area = Array.from(details.querySelectorAll<HTMLElement>('*')).find((element) => {
    const overflow = getComputedStyle(element).overflowY
    return (overflow === 'auto' || overflow === 'scroll') && element.scrollHeight > element.clientHeight
  })
  expect(area, '货物明细应拥有独立且可滚动的容器').toBeDefined()
  if (!area)
    throw new Error('货物明细缺少独立滚动区。')
  expect(area.tabIndex).toBeGreaterThanOrEqual(0)
  area.focus()
  expect(document.activeElement).toBe(area)
  await userEvent.keyboard('{End}')
  await vi.waitFor(() => expect(area.scrollTop).toBeGreaterThan(0))
  expect((page.getByLabelText('第 15 行名称').element() as HTMLInputElement).value).toBe('合成明细15')
  await page.getByLabelText('第 15 行名称').fill('未保存明细')
  await page.getByRole('button', { name: '添加明细' }).click()
  await expect.element(page.getByText('货物明细（16）')).toBeVisible()
  await page.getByRole('button', { name: '删除第 16 行' }).click()
  await expect.element(page.getByText('货物明细（15）')).toBeVisible()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '队列' }).click()
  await page.getByRole('button', { name: /OTHER-2/ }).click()
  expect(confirm).toHaveBeenCalledOnce()
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '校对' }).click()
  await expect.element(buyer).toHaveValue('未保存购方')
  await expect.element(page.getByLabelText('第 15 行名称')).toHaveValue('未保存明细')
})
