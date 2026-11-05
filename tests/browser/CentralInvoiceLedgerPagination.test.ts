import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import CentralInvoiceLedgerView from '~/components/invoice/CentralInvoiceLedgerView.vue'

it('分页跨视图保留选择，键盘与窄屏布局可用', async ({ task }) => {
  const match = /^chromium-(390|768|1024|1280|1440)$/.exec(task.file.projectName ?? '')
  expect(match).not.toBeNull()
  expect(window.innerWidth).toBe(Number(match![1]))
  const record: CentralInvoiceRecord = {
    id: 'invoice-01',
    version: '1',
    sourceKind: 'manual',
    fields: { invoiceNumber: 'invoice-01', invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '合成销售方', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: 100, taxRate: '', remark: '' },
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
  const records = Array.from({ length: 45 }, (_, index) => {
    const id = `invoice-${String(index + 1).padStart(2, '0')}`
    return { ...record, id, fields: { ...record.fields, invoiceNumber: id } }
  })
  const view = await render(CentralInvoiceLedgerView, {
    props: { records, projects: [] },
    global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
  })
  await page.getByLabelText('选择发票 invoice-01').click()
  const next = page.getByRole('button', { name: '下一页' })
  ;(next.element() as HTMLElement).focus()
  await expect.element(next).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(next).toHaveFocus()
  await expect.element(page.getByRole('button', { name: '第 2 页' })).toHaveAttribute('aria-current', 'page')
  await expect.element(page.getByText('本页 20 条 · 筛选后 45 条 · 已读取归档 45 条')).toBeVisible()
  await page.getByLabelText('选择发票 invoice-21').click()
  const card = page.getByRole('button', { name: '卡片' })
  ;(card.element() as HTMLElement).focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(card).toHaveFocus()
  await expect.element(page.getByLabelText('选择发票 invoice-21')).toBeChecked()
  await expect.element(page.getByRole('button', { name: 'invoice-01' })).not.toBeInTheDocument()
  await expect.element(page.getByRole('status')).toHaveTextContent('已选 2 张 · 合计 200.00')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  await page.getByRole('button', { name: '表格' }).click()
  await expect.element(page.getByLabelText('选择发票 invoice-21')).toBeChecked()
  const table = page.getByLabelText('发票台账').element().querySelector('table')!
  expect(getComputedStyle(table.parentElement!).overflowX).toBe('auto')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  await page.getByRole('button', { name: '上一页' }).click()
  await expect.element(page.getByLabelText('选择发票 invoice-01')).toBeChecked()
  await page.getByLabelText('每页条数').selectOptions('10')
  await expect.element(page.getByText('本页 10 条 · 筛选后 45 条 · 已读取归档 45 条')).toBeVisible()
  view.unmount()
})
