import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import CentralInvoiceCorrectionEntry from '~/components/invoice/CentralInvoiceCorrectionEntry.vue'

const mocks = vi.hoisted(() => ({ actor: { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'finance-invoice:write', 'our-signatory:read'] }, authority: null as null | ((problem: { message: string }) => void), invoice: null as CentralInvoiceRecord | null, baseline: null as unknown, reads: 0 }))
vi.mock('~/lib/read-model/authority', () => ({ bindReadAuthority: (callback: typeof mocks.authority) => {
  mocks.authority = callback
} }))
vi.mock('~/lib/invoice/central-http', () => ({ createCentralInvoiceHttp: () => ({ get: async () => {
  mocks.reads++
  return { record: mocks.invoice }
} }) }))
vi.mock('~/lib/invoice/central-migration-catalog', () => ({ createInvoiceWorkspaceCatalogClient: () => ({ load: async () => ({ projects: [], suppliers: [], contracts: [] }) }) }))
vi.mock('~/lib/invoice/correction-http', () => ({ createInvoiceCorrectionHttp: () => ({ list: async () => [], start: async () => ({ invoice: mocks.invoice, baseline: mocks.baseline }) }) }))
vi.mock('~/lib/invoice/correction-session', () => ({ createInvoiceCorrectionSession: () => ({ pending: () => null }) }))
vi.mock('~/lib/our-signatory/http-repository', () => ({ createOurSignatoryRepository: () => ({ list: async () => ({ records: [], meta: { ...mocks.actor, authorizedScope: { coverage: 'complete' }, sources: [{ key: 'our-signatories', state: 'readable', sourceVersion: 'signatories:1' }] } }) }) }))
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {}, onBeforeRouteUpdate: () => {} }))

it('撤权隐藏原票和原件，同身份重读后恢复未保存输入', async () => {
  const invoice: CentralInvoiceRecord = { id: 'invoice-one', version: '1', sourceKind: 'manual', fields: { invoiceNumber: 'PRIVATE-123', invoiceDate: '2026-01-01', invoiceType: '', buyer: '合成购方', buyerTaxNo: 'BUYER', seller: '合成销方', sellerTaxNo: 'SELLER', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' }, items: [], unrecognizedPageIndexes: [], ocrStatus: 'pending', completionMethod: 'manual', reviewStatus: 'reviewed', accountStatus: 'archived', duplicateStatus: 'normal', printCount: 0, printRotation: 0, ownerKind: 'project', projectId: 'project-one', supplierId: 'supplier-one', contract: null, archivedAt: '2026-01-01T00:00:00.000Z', original: { id: 'original-one', fileName: '合成原件.pdf', fileSize: 1, mimeType: 'application/pdf', sha256: 'a'.repeat(64) }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
  mocks.invoice = invoice
  mocks.baseline = { fields: invoice.fields, items: [], ownerKind: 'project', projectId: 'project-one', supplierId: 'supplier-one', supplierVersion: '1', buyer: { id: 'buyer-one', version: '1' }, contract: null }
  mocks.reads = 0
  vi.stubGlobal('$fetch', async () => structuredClone(mocks.actor))
  await render(CentralInvoiceCorrectionEntry, { props: { invoiceId: invoice.id } })
  const tax = page.getByLabelText('税额', { exact: true })
  await expect.element(tax).toHaveValue('0')
  const main = page.getByRole('heading', { name: '发票更正单' }).element().closest('main')!
  const original = page.getByRole('link', { name: '合成原件.pdf' }).element()
  await tax.fill('6')
  ;(tax.element() as HTMLElement).focus()
  mocks.authority?.({ message: '登录已失效' })
  await vi.waitFor(() => expect(main.getAttribute('aria-hidden')).toBe('true'))
  expect(getComputedStyle(main).display).toBe('none')
  expect(original.closest('[inert]')).toBe(main)
  const retry = page.getByRole('button', { name: '重新读取' })
  await expect.element(retry).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('heading', { name: '发票更正单' })).toBeVisible()
  await expect.element(tax).toHaveValue('6')
  await expect.element(tax).toHaveFocus()
  expect(mocks.reads).toBeGreaterThanOrEqual(2)
  let revokedAgain = false
  const observer = new MutationObserver(() => {
    if (!revokedAgain && main.getAttribute('aria-hidden') === 'false') {
      revokedAgain = true
      mocks.authority?.({ message: '再次失权' })
    }
  })
  mocks.authority?.({ message: '重新失权' })
  await expect.element(page.getByRole('button', { name: '重新读取' })).toHaveFocus()
  observer.observe(main, { attributes: true, attributeFilter: ['aria-hidden'] })
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => revokedAgain).toBe(true)
  observer.disconnect()
  await expect.element(page.getByRole('button', { name: '重新读取' })).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(tax).toHaveValue('6')
  await expect.element(tax).toHaveFocus()
  vi.unstubAllGlobals()
})
