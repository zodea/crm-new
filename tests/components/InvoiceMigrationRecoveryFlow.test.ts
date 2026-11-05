import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { expect, it, vi } from 'vitest'
import InvoiceMigrationPanel from '~/components/migration/InvoiceMigrationPanel.vue'
import { createInvoiceMigrationFromSession } from '~/lib/invoice/central-migration-bootstrap'

vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true }) }))
vi.mock('~/lib/read-model/authority', () => ({ bindReadAuthority: () => {} }))
vi.mock('~/lib/db/native-snapshot', () => ({ inspectNativeMigrationSnapshot: async () => ({ sha256: 'a'.repeat(64), schemaVersion: 60 }) }))

it('迁入响应丢失后重新打开页面，按原编号读回并解除阻断', async () => {
  const actor = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'finance-invoice:write', 'finance-invoice:import'] }
  const receipt = { commandId: 'command-one', batchId: 'batch-one', sourceSha256: 'a'.repeat(64), invoiceIds: ['invoice-one'], createdAt: '2026-01-01T00:00:00.000Z' }
  const asOf = '2026-01-01T00:00:00.000Z'
  const meta = { schemaVersion: 'invoice-read-v1', workspaceId: actor.workspaceId, actorId: actor.actorId, dataOrigin: 'real', asOf, sourceVersion: 'invoices:1', sources: [{ key: 'invoices', state: 'readable', sourceVersion: 'invoices:1', asOf }], authorizedScope: { coverage: 'complete', fingerprint: 'scope' }, capabilities: actor.capabilities }
  let applied = false
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/business-session'))
      return actor
    if (url.endsWith('/migration-state'))
      return { dataOrigin: 'real', asOf, sourceVersion: meta.sourceVersion, capabilities: actor.capabilities, meta, batches: applied ? [{ ...receipt, retiredAt: null }] : [] }
    if (url.endsWith('/migration-preview'))
      return { sourceSha256: receipt.sourceSha256, schemaVersion: 60, invoices: [{ legacyId: 'invoice-one', invoiceNumber: '001', deleted: false, sourceState: 'session-original-unavailable', ambiguousZeroFields: [], historicalAllocationCount: 0, originalCount: 0, originalBodyStates: [] }], references: [], orphanLogCount: 0 }
    if (url.endsWith('/migration-catalog'))
      return { context: actor, asOf, sources: [], projects: [], suppliers: [], contracts: [] }
    if (url.endsWith('/migration-mapping'))
      return { sourceSha256: receipt.sourceSha256, invoiceCount: 1, missingAllocationIds: [], orphanLogCount: 0 }
    if (url.endsWith('/migration-publish')) {
      applied = true
      throw new Error('合成连接中断')
    }
    if (url.endsWith('/migration-resolve'))
      return { outcome: 'applied', result: receipt }
    throw new Error(`意外请求 ${url}`)
  })
  const pending = new Map<string, string>()
  const storage = () => ({
    get length() { return pending.size },
    key: (index: number) => [...pending.keys()][index] ?? null,
    getItem: (key: string) => pending.get(key) ?? null,
    setItem: (key: string, value: string) => { pending.set(key, value) },
    removeItem: (key: string) => { pending.delete(key) },
  })
  const create = () => createInvoiceMigrationFromSession({ fetcher, storage, commandId: () => receipt.commandId })
  const view = render(InvoiceMigrationPanel, { props: await create() })
  await waitFor(() => expect((screen.getByLabelText('选择完整 SQLite 快照') as HTMLInputElement).disabled).toBe(false))
  const file = new File(['synthetic'], 'synthetic.sqlite')
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1]).buffer })
  await fireEvent.change(screen.getByLabelText('选择完整 SQLite 快照'), { target: { files: [file] } })
  await waitFor(() => expect((screen.getByRole('button', { name: '核对映射与历史付款' }) as HTMLButtonElement).disabled).toBe(false))
  await fireEvent.click(screen.getByRole('button', { name: '核对映射与历史付款' }))
  await waitFor(() => expect((screen.getByRole('button', { name: '确认迁入' }) as HTMLButtonElement).disabled).toBe(false))
  await fireEvent.click(screen.getByRole('button', { name: '确认迁入' }))
  await screen.findByText('原提交 command-one 尚未核对。')
  expect((screen.getByLabelText('选择完整 SQLite 快照') as HTMLInputElement).disabled).toBe(true)
  expect(pending.size).toBe(1)
  view.unmount()
  render(InvoiceMigrationPanel, { props: await create() })
  await screen.findByText('原提交 command-one 尚未核对。')
  await waitFor(() => expect((screen.getByRole('button', { name: '核对原提交' }) as HTMLButtonElement).disabled).toBe(false))
  await fireEvent.click(screen.getByRole('button', { name: '核对原提交' }))
  await screen.findByText('原提交已核对，批次 batch-one。')
  await waitFor(() => expect(pending.size).toBe(0))
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/migration-publish'))).toHaveLength(1)
})
