import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import CentralInvoiceCorrectionEntry from '~/components/invoice/CentralInvoiceCorrectionEntry.vue'

const mocks = vi.hoisted(() => ({
  actor: { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'finance-invoice:write', 'our-signatory:read'] },
  authority: null as null | ((problem: { message: string }) => void),
  getInvoice: vi.fn(),
  start: vi.fn(),
  list: vi.fn(),
  execute: vi.fn(),
}))
vi.mock('~/lib/read-model/authority', () => ({ bindReadAuthority: (callback: typeof mocks.authority) => {
  mocks.authority = callback
} }))
vi.mock('~/lib/invoice/central-http', () => ({ createCentralInvoiceHttp: () => ({ get: mocks.getInvoice }) }))
vi.mock('~/lib/invoice/central-migration-catalog', () => ({ createInvoiceWorkspaceCatalogClient: () => ({ load: async () => ({ projects: [], suppliers: [], contracts: [] }) }) }))
vi.mock('~/lib/invoice/correction-http', () => ({ createInvoiceCorrectionHttp: () => ({ start: mocks.start, list: mocks.list }) }))
vi.mock('~/lib/invoice/correction-session', () => ({ createInvoiceCorrectionSession: () => ({ pending: () => null, execute: mocks.execute }) }))
vi.mock('~/lib/our-signatory/http-repository', () => ({ createOurSignatoryRepository: () => ({ list: async () => ({ records: [], meta: { ...mocks.actor, authorizedScope: { coverage: 'complete' }, sources: [{ key: 'our-signatories', state: 'readable', sourceVersion: 'signatories:1' }] } }) }) }))
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {}, onBeforeRouteUpdate: () => {} }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  mocks.authority = null
})

it('服务端拒绝当前身份时也立即隐藏已读票面', async () => {
  mocks.actor = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'finance-invoice:write', 'our-signatory:read'] }
  const invoice = { id: 'invoice-denied', version: '1', fields: { invoiceNumber: 'DENIED-123', invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' }, items: [], unrecognizedPageIndexes: [], original: null, reviewStatus: 'reviewed', accountStatus: 'archived' } as CentralInvoiceRecord
  const baseline = { fields: invoice.fields, items: [], ownerKind: 'project' as const, projectId: 'project-one', supplierId: 'supplier-one', supplierVersion: '1', buyer: { id: 'buyer-one', version: '1' }, contract: null }
  mocks.getInvoice.mockResolvedValue({ record: invoice })
  mocks.start.mockResolvedValue({ invoice, baseline })
  mocks.list.mockResolvedValue([])
  mocks.execute.mockRejectedValueOnce(Object.assign(new Error('HTTP 403'), { response: { status: 403, _data: { data: { code: 'forbidden', message: '读取权限已撤销。', retryable: false, fieldErrors: {}, traceId: null } } } }))
  vi.stubGlobal('$fetch', async () => structuredClone(mocks.actor))
  render(CentralInvoiceCorrectionEntry, { props: { invoiceId: invoice.id } })
  await screen.findByDisplayValue('DENIED-123')
  await fireEvent.update(screen.getByLabelText('更正原因'), '待保存')
  await fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
  expect((await screen.findByRole('alert')).textContent).toContain('读取权限已撤销')
  expect(screen.queryByRole('heading', { name: '发票更正单' })).toBeNull()
  await fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
  await screen.findByRole('heading', { name: '发票更正单' })
  expect(screen.queryByText(/读取权限已撤销/)).toBeNull()
  expect(screen.getByLabelText('更正原因')).toHaveProperty('value', '待保存')
})

it('失权立即隐藏原票；同身份重读后恢复未保存输入，换身份不继承', async () => {
  mocks.actor = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'finance-invoice:write', 'our-signatory:read'] }
  const invoice: CentralInvoiceRecord = { id: 'invoice-one', version: '1', sourceKind: 'manual', fields: { invoiceNumber: 'PRIVATE-123', invoiceDate: '2026-01-01', invoiceType: '', buyer: '原购方', buyerTaxNo: 'BUYER', seller: '销方', sellerTaxNo: 'SELLER', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' }, items: [], unrecognizedPageIndexes: [], ocrStatus: 'pending', completionMethod: 'manual', reviewStatus: 'reviewed', accountStatus: 'archived', duplicateStatus: 'normal', printCount: 0, printRotation: 0, ownerKind: 'project', projectId: 'project-one', supplierId: 'supplier-one', contract: null, archivedAt: '2026-01-01T00:00:00.000Z', original: { id: 'original-one', fileName: '合成原件.pdf', fileSize: 1, mimeType: 'application/pdf', sha256: 'a'.repeat(64) }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
  const baseline = { fields: invoice.fields, items: [], ownerKind: 'project' as const, projectId: 'project-one', supplierId: 'supplier-one', supplierVersion: '1', buyer: { id: 'buyer-one', version: '1' }, contract: null }
  mocks.getInvoice.mockImplementation(async () => ({ record: invoice }))
  mocks.start.mockImplementation(async () => ({ invoice, baseline }))
  mocks.list.mockResolvedValue([])
  vi.stubGlobal('$fetch', async () => structuredClone(mocks.actor))
  render(CentralInvoiceCorrectionEntry, { props: { invoiceId: invoice.id } })
  await screen.findByDisplayValue('PRIVATE-123')
  expect(screen.getByRole('link', { name: '合成原件.pdf' })).toBeTruthy()
  await fireEvent.update(screen.getByLabelText('税额'), '6')
  mocks.authority?.({ message: '登录已失效' })
  await waitFor(() => expect(screen.queryByRole('heading', { name: '发票更正单' })).toBeNull())
  expect(screen.queryByRole('link', { name: '合成原件.pdf' })).toBeNull()
  await fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
  await screen.findByRole('heading', { name: '发票更正单' })
  await waitFor(() => expect(screen.getByLabelText('税额')).toHaveProperty('value', '6'))
  expect(mocks.getInvoice.mock.calls.length).toBeGreaterThanOrEqual(2)
  mocks.authority?.({ message: '来源已变化' })
  mocks.getInvoice.mockResolvedValue({ record: { ...invoice, version: '2' } })
  await fireEvent.click(await screen.findByRole('button', { name: '重新读取' }))
  await screen.findByText(/原票已变化/)
  expect(screen.queryByRole('heading', { name: '发票更正单' })).toBeNull()
  mocks.getInvoice.mockResolvedValue({ record: invoice })
  await fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
  await screen.findByRole('heading', { name: '发票更正单' })
  expect(screen.getByLabelText('税额')).toHaveProperty('value', '6')
  mocks.authority?.({ message: '身份已变化' })
  mocks.actor = { ...mocks.actor, actorId: 'actor-two' }
  await waitFor(() => expect(screen.queryByRole('heading', { name: '发票更正单' })).toBeNull())
  await fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
  await screen.findByRole('heading', { name: '发票更正单' })
  await waitFor(() => expect(screen.getByLabelText('税额')).toHaveProperty('value', '0'))
})
