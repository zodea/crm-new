import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import CentralInvoiceLedgerView from '~/components/invoice/CentralInvoiceLedgerView.vue'

it('归属树在各视口可键盘选择，跨筛选勾选及来源缺口保持真实', async ({ task }) => {
  const match = /^chromium-(390|768|1024|1280|1440)$/.exec(task.file.projectName ?? '')
  expect(match).not.toBeNull()
  expect(window.innerWidth).toBe(Number(match![1]))
  const record: CentralInvoiceRecord = {
    id: 'first',
    version: '1',
    sourceKind: 'manual',
    fields: { invoiceNumber: 'first', invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '合成销售方', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: 100, taxRate: '', remark: '' },
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
    projectId: 'project-one',
    supplierId: null,
    contract: null,
    archivedAt: '2026-01-01T00:00:00.000Z',
    original: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  }
  const records: CentralInvoiceRecord[] = [
    record,
    { ...record, id: 'second', projectId: 'project-two', fields: { ...record.fields, invoiceNumber: 'second' } },
    { ...record, id: 'unassigned', ownerKind: null, projectId: null, fields: { ...record.fields, invoiceNumber: 'unassigned' } },
    { ...record, id: 'unavailable', projectId: 'project-missing', fields: { ...record.fields, invoiceNumber: 'unavailable' } },
  ]
  const projects = [{ id: 'project-one', label: '同名项目' }, { id: 'project-two', label: '同名项目' }]
  const view = await render(CentralInvoiceLedgerView, {
    props: { records, projects, projectsReadable: true },
    global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
  })
  await page.getByLabelText('选择发票 first').click()
  const second = page.getByRole('button', { name: /同名项目 · project-two/ })
  ;(second.element() as HTMLElement).focus()
  await expect.element(second).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(second).toHaveAttribute('aria-pressed', 'true')
  await expect.element(page.getByRole('button', { name: 'second' })).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'first' })).not.toBeInTheDocument()
  await expect.element(page.getByRole('status')).toHaveTextContent('已选 1 张 · 合计 100.00')
  await page.getByRole('button', { name: '卡片' }).click()
  await expect.element(page.getByRole('button', { name: 'second' })).toBeVisible()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  await view.rerender({ projectsReadable: false })
  await expect.element(page.getByRole('button', { name: /同名项目 · project-two/ })).not.toBeInTheDocument()
  const unavailable = page.getByRole('button', { name: '项目来源或权限不可用' })
  await expect.element(unavailable).toBeVisible()
  await unavailable.click()
  await expect.element(page.getByRole('button', { name: 'unavailable' })).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'unassigned' })).not.toBeInTheDocument()
  await expect.element(page.getByLabelText('选择发票 first')).toBeChecked()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  view.unmount()
})
