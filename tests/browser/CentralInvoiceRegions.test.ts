import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { shallowRef } from 'vue'
import CentralInvoiceWorkspaceScreen from '~/components/invoice/CentralInvoiceWorkspaceScreen.vue'

vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true, undoToast: () => {} }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))

it('可信原件按字段定位；切票和失权后不保留旧区域', async () => {
  const canvas = document.createElement('canvas')
  canvas.width = 300
  canvas.height = 200
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('无法创建图片')), 'image/png'))
  const record: CentralInvoiceRecord = { id: 'invoice-one', version: '1', sourceKind: 'scan', fields: { invoiceNumber: '00123', invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: null, taxRate: '', remark: '' }, items: [], unrecognizedPageIndexes: [], ocrStatus: 'pending', completionMethod: null, reviewStatus: 'unreviewed', accountStatus: 'none', duplicateStatus: 'normal', printCount: 0, printRotation: 0, ownerKind: 'project', projectId: 'project-one', supplierId: null, contract: null, archivedAt: null, original: { id: 'original-one', fileName: '合成.png', fileSize: blob.size, mimeType: 'image/png', sha256: 'a'.repeat(64) }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
  const second = { ...record, id: 'invoice-two', fields: { ...record.fields, invoiceNumber: '00234' }, original: { ...record.original!, id: 'original-two' } }
  const records = shallowRef([record, second])
  const readState = shallowRef<'ready' | 'unavailable'>('ready')
  const candidate = { source: 'local' as const, fields: { ...record.fields, items: [] }, textPages: [], unrecognizedPageIndexes: [], requiresReview: true as const, fieldRegions: { invoiceNumber: { pageIndex: 0, blockLabel: 'text', box: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 } } }, regionFrames: [{ pageIndex: 0, width: 300, height: 200, source: 'image' as const }] }
  const workspace = {
    records,
    readState,
    loading: shallowRef(false),
    load: vi.fn(async () => {}),
    pending: () => null,
    verifiedOriginal: vi.fn(async () => blob),
    recognizeWithCandidate: vi.fn(async () => {
      const updated = { ...record, version: '2', ocrStatus: 'done' as const, completionMethod: 'ocr' as const }
      records.value = [updated, second]
      return { record: updated, candidate }
    }),
  }
  await render(CentralInvoiceWorkspaceScreen, { props: { workspace: workspace as never, projects: [], suppliers: [], signatories: [] } })
  await page.getByRole('button', { name: /00123/ }).click()
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '原件' }).click()
  await page.getByRole('button', { name: '本机识别' }).click()
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '校对' }).click()
  const number = page.getByRole('textbox', { name: '发票号码' })
  await expect.element(number).toBeVisible()
  number.element().dispatchEvent(new MouseEvent('mouseenter'))
  await expect.poll(() => document.querySelector('[data-testid="invoice-region-box"][data-active="true"]') !== null).toBe(true)
  number.element().dispatchEvent(new MouseEvent('mouseleave'))
  await expect.poll(() => document.querySelector('[data-testid="invoice-region-box"][data-active="true"]')).toBeNull()
  ;(number.element() as HTMLElement).focus()
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '原件' }).click()
  await expect.poll(() => document.querySelector('[data-testid="invoice-region-box"][data-active="true"]') !== null).toBe(true)
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '队列' }).click()
  await page.getByRole('button', { name: /00234/ }).click()
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '原件' }).click()
  await expect.poll(() => document.querySelector('[data-testid="invoice-region-box"]')).toBeNull()
  readState.value = 'unavailable'
  await expect.element(page.getByText('发票来源尚不可用。')).toBeVisible()
  expect(document.querySelector('[data-testid="invoice-region-box"]')).toBeNull()
  records.value = [record, second]
  readState.value = 'ready'
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '队列' }).click()
  await page.getByRole('button', { name: /00123/ }).click()
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '原件' }).click()
  let finish!: (value: Awaited<ReturnType<typeof workspace.recognizeWithCandidate>>) => void
  workspace.recognizeWithCandidate.mockImplementationOnce(() => new Promise((resolve) => {
    finish = resolve
  }))
  await page.getByRole('button', { name: '本机识别' }).click()
  await expect.poll(() => typeof finish).toBe('function')
  readState.value = 'unavailable'
  readState.value = 'ready'
  const updated = { ...record, version: '2', ocrStatus: 'done' as const, completionMethod: 'ocr' as const }
  records.value = [updated, second]
  finish({ record: updated, candidate })
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '校对' }).click()
  ;(page.getByRole('textbox', { name: '发票号码' }).element() as HTMLElement).focus()
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '原件' }).click()
  await expect.poll(() => document.querySelector('[data-testid="invoice-region-box"]')).toBeNull()
})
