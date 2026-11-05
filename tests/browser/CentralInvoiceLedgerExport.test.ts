import type { Component } from 'vue'
import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { createPinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { shallowRef } from 'vue'
import CentralInvoiceLedgerScreen from '~/components/invoice/CentralInvoiceLedgerScreen.vue'
import Dialog from '~/components/ui/dialog/Dialog.vue'
import DialogContent from '~/components/ui/dialog/DialogContent.vue'
import DialogDescription from '~/components/ui/dialog/DialogDescription.vue'
import DialogHeader from '~/components/ui/dialog/DialogHeader.vue'
import DialogTitle from '~/components/ui/dialog/DialogTitle.vue'

const fake = vi.hoisted(() => ({ saved: '' as string, exportFile: vi.fn(async (_value: unknown) => {}) }))
vi.mock('~/lib/db/client', () => ({ db: {
  select: async () => fake.saved ? [{ settings_json: fake.saved }] : [],
  execute: async (_sql: string, params: unknown[]) => { fake.saved = String(params[0]) },
} }))
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true, undoToast: () => {}, exportFile: fake.exportFile }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))

const components: Record<string, Component> = { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle }
afterEach(() => {
  vi.unstubAllGlobals()
  fake.saved = ''
  fake.exportFile.mockClear()
})

it('导出弹层在各视口可键盘操作，保存样式可重新读取，并拒绝过期项目目录', async () => {
  const record: CentralInvoiceRecord = {
    id: 'invoice-browser',
    version: '1',
    sourceKind: 'manual',
    fields: { invoiceNumber: 'B-001', invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '合成销方', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: null, taxRate: '', remark: '' },
    items: [],
    unrecognizedPageIndexes: [],
    ocrStatus: 'pending',
    completionMethod: 'manual',
    reviewStatus: 'reviewed',
    accountStatus: 'archived',
    duplicateStatus: 'normal',
    printCount: 0,
    printRotation: 0,
    ownerKind: 'project',
    projectId: 'project-browser',
    supplierId: null,
    contract: null,
    archivedAt: '2026-01-01T00:00:00.000Z',
    original: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  }
  const workspace = { records: shallowRef([record]), loading: shallowRef(false), readState: shallowRef('ready'), pendingPrint: () => null, load: vi.fn(async () => {}) }
  let projectVersion = 'projects:2'
  const verifyProjects = async () => [{ id: 'project-browser', label: '合成项目', sourceVersion: projectVersion }]
  const props = { workspace: workspace as never, projects: [{ id: 'project-browser', label: '合成项目', sourceVersion: 'projects:1' }], verifyProjects }
  const first = await render(CentralInvoiceLedgerScreen, { props, global: { plugins: [createPinia()], components } })
  const owner = page.getByLabelText('归属')
  const start = page.getByLabelText('开票开始日期')
  const end = page.getByLabelText('开票结束日期')
  ;(owner.element() as HTMLElement).focus()
  await userEvent.tab()
  await expect.element(start).toHaveFocus()
  await start.fill('2026-02-01')
  await end.fill('2026-01-01')
  await expect.element(page.getByRole('alert')).toHaveTextContent('开始日期不能晚于结束日期')
  await expect.element(page.getByRole('button', { name: '导出 Excel' })).toBeDisabled()
  await start.fill('2026-01-01')
  await expect.element(page.getByRole('button', { name: 'B-001' })).toBeVisible()
  const ledgerTable = page.getByLabelText('发票台账').element().querySelector('table')!
  expect(getComputedStyle(ledgerTable.parentElement!).overflowX).toBe('auto')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  const open = page.getByRole('button', { name: '导出 Excel' })
  ;(open.element() as HTMLElement).focus()
  await expect.element(open).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('dialog')).toBeVisible()
  await expect.element(page.getByText('未统计（金额缺失或超出范围）')).toBeVisible()
  const table = page.getByRole('region', { name: 'Excel 数据预览' }).element().querySelector('table')!
  const tableScroller = table.parentElement!
  expect(getComputedStyle(tableScroller).overflowX).toBe('auto')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  const freeze = page.getByRole('spinbutton', { name: '冻结行数' })
  await freeze.fill('5')
  const save = page.getByRole('button', { name: '保存为台账默认样式' })
  ;(save.element() as HTMLElement).focus()
  await expect.element(save).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => fake.saved && JSON.parse(fake.saved).freezeRows).toBe(5)
  await page.getByRole('button', { name: '取消' }).click()
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  first.unmount()
  await render(CentralInvoiceLedgerScreen, { props, global: { plugins: [createPinia()], components } })
  await page.getByRole('button', { name: '导出 Excel' }).click()
  await expect.element(page.getByRole('spinbutton', { name: '冻结行数' })).toHaveValue(5)
  const confirm = page.getByRole('button', { name: '确认导出' })
  ;(confirm.element() as HTMLElement).focus()
  await expect.element(confirm).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  const alert = page.getByRole('alert')
  await expect.element(alert).toHaveTextContent('项目目录已变化')
  await expect.element(alert).toHaveFocus()
  expect(fake.exportFile).not.toHaveBeenCalled()
  projectVersion = 'projects:1'
  await expect.element(confirm).toBeEnabled()
  for (let count = 0; count < 100 && document.activeElement !== confirm.element(); count++)
    await userEvent.tab()
  await expect.element(confirm).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => fake.exportFile.mock.calls.length).toBe(1)
})
