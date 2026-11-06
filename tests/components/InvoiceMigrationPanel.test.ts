import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { expect, it, vi } from 'vitest'
import InvoiceMigrationPanel from '~/components/migration/InvoiceMigrationPanel.vue'

vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true }) }))
vi.mock('~/lib/read-model/authority', () => ({ bindReadAuthority: () => {} }))
vi.mock('~/lib/db/native-snapshot', () => ({ inspectNativeMigrationSnapshot: async () => ({ sha256: 'a'.repeat(64), schemaVersion: 60 }) }))

it('必须预检完整关联与历史付款后才允许确认迁入，并在提交前再次核对', async () => {
  const sourcePreview = { sourceSha256: 'a'.repeat(64), schemaVersion: 60, invoices: [{ legacyId: 'invoice-one', invoiceNumber: '001', deleted: false, sourceState: 'session-original-unavailable', ambiguousZeroFields: ['amount'], historicalAllocationCount: 1, originalCount: 0, originalBodyStates: [] }], references: [{ table: 'projects', legacyId: 'project-old', label: '旧项目', deleted: false }], orphanLogCount: 0 }
  const mappingPreview = { sourceSha256: 'a'.repeat(64), invoiceCount: 1, missingAllocationIds: [] as string[], orphanLogCount: 0 }
  const publish = vi.fn(async () => ({ batchId: 'batch-one', invoiceIds: ['invoice-one'] }))
  const session = { state: vi.fn(async () => []), pending: () => null, publish }
  const check = vi.fn(async () => mappingPreview).mockRejectedValueOnce(Object.assign(new Error('Server Error'), { data: { data: { code: 'validation-failed', message: '旧归属与项目关系不一致' } } }))
  const catalogClient = { load: vi.fn(async () => ({ projects: [{ id: 'project-new', label: '新项目', version: '1', sourceVersion: 'projects:1' }], suppliers: [], contracts: [] })) }
  render(InvoiceMigrationPanel, { props: { session: session as never, previewClient: { source: async () => sourcePreview, mappings: check } as never, catalogClient } })
  await waitFor(() => expect((screen.getByLabelText('选择完整 SQLite 快照') as HTMLInputElement).disabled).toBe(false))
  const file = new File(['synthetic'], 'synthetic.sqlite', { type: 'application/octet-stream' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1]).buffer })
  await fireEvent.change(screen.getByLabelText('选择完整 SQLite 快照'), { target: { files: [file] } })
  await screen.findByText(/原件缺失/)
  expect((screen.getByRole('button', { name: '核对映射与历史付款' }) as HTMLButtonElement).disabled).toBe(true)
  await waitFor(() => expect((screen.getByLabelText(/项目：旧项目/) as HTMLSelectElement).disabled).toBe(false))
  await fireEvent.update(screen.getByLabelText(/项目：旧项目/), 'project-new')
  await waitFor(() => expect((screen.getByRole('button', { name: '核对映射与历史付款' }) as HTMLButtonElement).disabled).toBe(false))
  await fireEvent.click(screen.getByRole('button', { name: '核对映射与历史付款' }))
  await screen.findByText('旧归属与项目关系不一致')
  await waitFor(() => expect((screen.getByRole('button', { name: '核对映射与历史付款' }) as HTMLButtonElement).disabled).toBe(false))
  await fireEvent.click(screen.getByRole('button', { name: '核对映射与历史付款' }))
  await waitFor(() => expect((screen.getByRole('button', { name: '确认迁入' }) as HTMLButtonElement).disabled).toBe(false))
  await fireEvent.click(screen.getByRole('button', { name: '确认迁入' }))
  await waitFor(() => expect(publish).toHaveBeenCalledOnce())
  expect(check).toHaveBeenCalledTimes(3)
  expect(catalogClient.load).toHaveBeenCalledWith(['projects'])
  expect(publish).toHaveBeenCalledWith(expect.objectContaining({ sha256: 'a'.repeat(64) }), { projects: [{ legacyId: 'project-old', targetId: 'project-new', version: '1', sourceVersion: 'projects:1' }], suppliers: [], contracts: [] }, expect.any(Function))
})

it('有未核对原提交时阻止新迁入并提供原编号恢复', async () => {
  let unresolved = true
  const recover = vi.fn(async () => {
    unresolved = false
    return { outcome: 'not-applied', commandId: 'command-one' }
  })
  const session = { state: async () => [], pending: () => unresolved ? { commandId: 'command-one' } : null, recover }
  render(InvoiceMigrationPanel, { props: { session: session as never, previewClient: {} as never, catalogClient: {} as never } })
  await screen.findByText('原提交 command-one 尚未核对。')
  expect((screen.getByLabelText('选择完整 SQLite 快照') as HTMLInputElement).disabled).toBe(true)
  await waitFor(() => expect((screen.getByRole('button', { name: '核对原提交' }) as HTMLButtonElement).disabled).toBe(false))
  await fireEvent.click(screen.getByRole('button', { name: '核对原提交' }))
  await waitFor(() => expect((screen.getByLabelText('选择完整 SQLite 快照') as HTMLInputElement).disabled).toBe(false))
  expect(recover).toHaveBeenCalledWith(null)
})

it('公司旧票必须逐票手选分供方和我方主体，通过预检后才能发布', async () => {
  const sourcePreview = { sourceSha256: 'a'.repeat(64), schemaVersion: 60, invoices: [{ legacyId: 'invoice-one', invoiceNumber: '001', deleted: false, sourceState: 'session-original-unavailable', ambiguousZeroFields: [], historicalAllocationCount: 0, originalCount: 0, originalBodyStates: [], companyContractId: 'old-company' }], references: [{ table: 'company_expense_contracts', legacyId: 'old-company', label: '旧公司合同', deleted: false }], orphanLogCount: 0 }
  const check = vi.fn(async (_source: unknown, _mappings: unknown) => ({ sourceSha256: 'a'.repeat(64), invoiceCount: 1, missingAllocationIds: [], orphanLogCount: 0 }))
  const session = { state: async () => [], pending: () => null, publish: vi.fn() }
  const catalogClient = { load: async () => ({ projects: [], suppliers: [{ id: 'supplier-one', label: '真实分供方', version: '2', sourceVersion: 'suppliers:1' }], contracts: [{ id: 'company-one', label: '真实公司合同', domain: 'company', version: '3', projectId: null, supplierId: 'supplier-one' }] }) }
  const loadBuyers = async () => [{ id: 'buyer-one', label: '真实我方主体', version: '4' }]
  render(InvoiceMigrationPanel, { props: { session: session as never, previewClient: { source: async () => sourcePreview, mappings: check } as never, catalogClient: catalogClient as never, loadBuyers } })
  await waitFor(() => expect((screen.getByLabelText('选择完整 SQLite 快照') as HTMLInputElement).disabled).toBe(false))
  const file = new File(['synthetic'], 'synthetic.sqlite')
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1]).buffer })
  await fireEvent.change(screen.getByLabelText('选择完整 SQLite 快照'), { target: { files: [file] } })
  await waitFor(() => expect((screen.getByLabelText(/公司支出合同：旧公司合同/) as HTMLSelectElement).disabled).toBe(false))
  await fireEvent.update(screen.getByLabelText(/公司支出合同：旧公司合同/), 'company:company-one')
  expect((screen.getByRole('button', { name: '核对映射与历史付款' }) as HTMLButtonElement).disabled).toBe(true)
  await fireEvent.update(screen.getByLabelText('选择已有分供方'), 'supplier-one')
  await fireEvent.update(screen.getByLabelText('选择已有我方主体'), 'buyer-one')
  await fireEvent.click(screen.getByRole('button', { name: '核对映射与历史付款' }))
  await waitFor(() => expect(check).toHaveBeenCalledOnce())
  expect(check.mock.calls[0]?.[1]).toMatchObject({ companyInvoices: [{ invoiceId: 'invoice-one', legacyContractId: 'old-company', target: { domain: 'company', id: 'company-one', version: '3' }, supplierId: 'supplier-one', supplierVersion: '2', buyerId: 'buyer-one', buyerVersion: '4' }] })
  await waitFor(() => expect((screen.getByRole('button', { name: '确认迁入' }) as HTMLButtonElement).disabled).toBe(false))
})

it('我方主体目录无权读取时明确显示缺口且不能预检', async () => {
  const sourcePreview = { sourceSha256: 'a'.repeat(64), schemaVersion: 60, invoices: [{ legacyId: 'invoice-one', invoiceNumber: '001', deleted: false, sourceState: 'session-original-unavailable', ambiguousZeroFields: [], historicalAllocationCount: 0, originalCount: 0, originalBodyStates: [], companyContractId: 'old-company' }], references: [{ table: 'company_expense_contracts', legacyId: 'old-company', label: '旧公司合同', deleted: false }], orphanLogCount: 0 }
  const session = { state: async () => [], pending: () => null }
  const catalogClient = { load: async () => ({ projects: [], suppliers: [], contracts: [] }) }
  const loadBuyers = async () => {
    throw new Error('无我方主体读取权限')
  }
  render(InvoiceMigrationPanel, { props: { session: session as never, previewClient: { source: async () => sourcePreview } as never, catalogClient: catalogClient as never, loadBuyers } })
  await waitFor(() => expect((screen.getByLabelText('选择完整 SQLite 快照') as HTMLInputElement).disabled).toBe(false))
  const file = new File(['synthetic'], 'synthetic.sqlite')
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1]).buffer })
  await fireEvent.change(screen.getByLabelText('选择完整 SQLite 快照'), { target: { files: [file] } })
  await screen.findByText('无我方主体读取权限')
  expect((screen.getByRole('button', { name: '核对映射与历史付款' }) as HTMLButtonElement).disabled).toBe(true)
})
