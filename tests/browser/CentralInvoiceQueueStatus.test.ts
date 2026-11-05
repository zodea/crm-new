import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import CentralInvoiceWorkspaceView from '~/components/invoice/CentralInvoiceWorkspaceView.vue'

it('识别状态在工作台队列可读、可用键盘选择，且不造成页面横向溢出', async () => {
  const select = vi.fn()
  const activeId = shallowRef<string | null>(null)
  const records = [
    { id: 'waiting', fields: { invoiceNumber: '000001', totalAmount: null }, original: null, ocrStatus: 'pending', printCount: 0, reviewStatus: 'unreviewed', accountStatus: 'none' },
    { id: 'failed', fields: { invoiceNumber: '000002', totalAmount: 100 }, original: null, ocrStatus: 'failed', printCount: 0, reviewStatus: 'unreviewed', accountStatus: 'none' },
    { id: 'complete', fields: { invoiceNumber: '000003', totalAmount: 0 }, original: null, ocrStatus: 'done', printCount: 2, reviewStatus: 'reviewed', accountStatus: 'archived' },
  ] as CentralInvoiceRecord[]
  await render(defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceView, {
    records,
    selectedId: null,
    recognizingId: activeId.value,
    originalFile: null,
    originalLoading: false,
    busy: false,
    cloudAvailable: false,
    projects: [],
    suppliers: [],
    signatories: [],
    onSelect: select,
  }) }))
  await expect.element(page.getByText('识别尚未完成')).toBeVisible()
  await expect.element(page.getByText('识别失败或部分页面未识别')).toBeVisible()
  await expect.element(page.getByText('已登记打印 2 次')).toBeVisible()
  const waiting = page.getByRole('button', { name: /000001/ })
  waiting.element().focus()
  await expect.element(waiting).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  expect(select).toHaveBeenCalledWith('waiting')
  activeId.value = 'waiting'
  await nextTick()
  await expect.element(page.getByText('正在识别或核对结果')).toBeVisible()
  expect(page.getByText('正在识别或核对结果').element().getAttribute('aria-live')).toBe('polite')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
  const queue = page.getByRole('region', { name: '发票队列' }).element()
  expect(queue.scrollWidth).toBeLessThanOrEqual(queue.clientWidth + 1)
  activeId.value = null
  await nextTick()
  await expect.element(page.getByText('识别尚未完成')).toBeVisible()
})
