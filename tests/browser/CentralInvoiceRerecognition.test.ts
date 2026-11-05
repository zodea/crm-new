import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h, shallowRef } from 'vue'
import CentralInvoiceWorkspaceScreen from '~/components/invoice/CentralInvoiceWorkspaceScreen.vue'

vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true, undoToast: () => {} }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))

it('键盘重识别保留未完成输入，切票与失权期间不采用迟到结果', async () => {
  const record: CentralInvoiceRecord = { id: 'invoice-one', version: '1', sourceKind: 'scan', fields: { invoiceNumber: '00123', invoiceDate: '', invoiceType: '', buyer: '已保存购方', buyerTaxNo: '', seller: '已保存销方', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: 10, taxRate: '', remark: '' }, items: [], unrecognizedPageIndexes: [], ocrStatus: 'done', completionMethod: 'ocr', reviewStatus: 'reviewed', accountStatus: 'none', duplicateStatus: 'normal', printCount: 0, printRotation: 0, ownerKind: 'project', projectId: 'project-one', supplierId: null, contract: null, archivedAt: null, original: { id: 'original-one', fileName: '合成.pdf', fileSize: 100, mimeType: 'application/pdf', sha256: 'a'.repeat(64) }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
  const other = { ...record, id: 'invoice-two', fields: { ...record.fields, invoiceNumber: '00456' } }
  const candidate = { source: 'local' as const, fields: { ...record.fields, buyer: '识别购方', amount: 8, items: [], projectHint: '', balanced: false }, textPages: ['合成'], unrecognizedPageIndexes: [], requiresReview: true as const }
  let finish!: (value: typeof candidate) => void
  let first = true
  const readState = shallowRef('ready')
  const workspace = {
    records: shallowRef([record, other]),
    loading: shallowRef(false),
    readState,
    sourceVersion: shallowRef('invoices:1'),
    load: async () => {},
    pending: () => null,
    verifiedOriginal: async () => { throw new Error('合成原件暂不可读') },
    prepareRerecognition: () => {
      if (!first)
        return Promise.resolve(candidate)
      first = false
      return new Promise<typeof candidate>((resolve) => {
        finish = resolve
      })
    },
  }
  await render(defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceScreen, { workspace: workspace as never, projects: [], suppliers: [], signatories: [], cloudAvailable: false }) }), { global: { stubs: { NuxtLink: true } } })
  await page.getByRole('button', { name: /00123/ }).click()
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '校对' }).click()
  const amount = page.getByLabelText('不含税金额')
  await amount.fill('1e')
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '原件' }).click()
  const recognition = page.getByRole('button', { name: '本机重新识别' })
  recognition.element().focus()
  await expect.element(recognition).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '队列' }).click()
  await expect.element(page.getByRole('button', { name: /00456/ })).toBeDisabled()
  readState.value = 'forbidden'
  await expect.element(page.getByText('发票来源尚不可用。')).toBeVisible()
  finish(candidate)
  readState.value = 'ready'
  await expect.element(page.getByText('发票或权限已变化，未保存输入仍保留。')).toBeVisible()
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '校对' }).click()
  await expect.element(amount).toHaveValue('1e')
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '原件' }).click()
  await recognition.click()
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '校对' }).click()
  await expect.element(page.getByText(/重新识别结果为未保存草稿/)).toBeVisible()
  await page.getByRole('button', { name: '放弃识别草稿' }).click()
  await expect.element(page.getByLabelText('不含税金额')).toHaveValue('1e')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})
