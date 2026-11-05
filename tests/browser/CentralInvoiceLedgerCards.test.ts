import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import CentralInvoiceLedgerView from '~/components/invoice/CentralInvoiceLedgerView.vue'

it('卡片可键盘切换，筛选及跨视图选择保持，页面不横向溢出', async ({ task }) => {
  const match = /^chromium-(390|768|1024|1280|1440)$/.exec(task.file.projectName ?? '')
  expect(match).not.toBeNull()
  expect(window.innerWidth).toBe(Number(match![1]))
  const record: CentralInvoiceRecord = {
    id: 'browser-zero',
    version: '1',
    sourceKind: 'manual',
    fields: { invoiceNumber: 'B-001', invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '合成销售方', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: 0, taxRate: '', remark: '' },
    items: [],
    unrecognizedPageIndexes: [],
    ocrStatus: 'pending',
    completionMethod: 'manual',
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
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  }
  const second: CentralInvoiceRecord = { ...record, id: 'browser-unknown', fields: { ...record.fields, invoiceNumber: 'B-002', totalAmount: null } }
  const view = await render(CentralInvoiceLedgerView, {
    props: { records: [record, second], projects: [] },
    global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
  })
  await page.getByLabelText('选择发票 B-001').click()
  await page.getByLabelText('搜索发票').fill('B-002')
  const cardButton = page.getByRole('button', { name: '卡片' })
  ;(cardButton.element() as HTMLElement).focus()
  await expect.element(cardButton).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(cardButton).toHaveAttribute('aria-pressed', 'true')
  await expect.element(page.getByText('字段预览，非原件')).toBeVisible()
  await expect.element(page.getByRole('link', { name: '更正发票 B-002' })).toHaveAttribute('href', '/finance/invoice/correction/browser-unknown')
  await expect.element(page.getByRole('button', { name: 'B-001' })).not.toBeInTheDocument()
  await page.getByLabelText('选择发票 B-002').click()
  await expect.element(page.getByRole('status')).toHaveTextContent('已选 2 张 · 合计未统计')
  await page.getByLabelText('搜索发票').fill('')
  await expect.element(page.getByLabelText('选择发票 B-001')).toBeChecked()
  await expect.element(page.getByLabelText('选择发票 B-002')).toBeChecked()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  const tableButton = page.getByRole('button', { name: '表格' })
  ;(tableButton.element() as HTMLElement).focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(tableButton).toHaveFocus()
  await expect.element(page.getByLabelText('选择发票 B-001')).toBeChecked()
  await expect.element(page.getByLabelText('选择发票 B-002')).toBeChecked()
  const table = page.getByLabelText('发票台账').element().querySelector('table')!
  expect(getComputedStyle(table.parentElement!).overflowX).toBe('auto')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  view.unmount()
})
