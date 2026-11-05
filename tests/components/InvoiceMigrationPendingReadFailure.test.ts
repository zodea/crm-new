import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { expect, it, vi } from 'vitest'
import InvoiceMigrationPanel from '~/components/migration/InvoiceMigrationPanel.vue'
import { CentralInvoiceProblem } from '~/lib/invoice/central-contract'
import { createInvoiceMigrationSession } from '~/lib/invoice/central-migration'
import { createProductionInvoiceMigration } from '../../server/utils/production-invoice-migration'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { createSubcontractFixture } from '../helpers/production-subcontract-fixture'

const authority = vi.hoisted(() => ({ changed: (_problem: { message: string }) => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true }) }))
vi.mock('~/lib/read-model/authority', () => ({ bindReadAuthority: (changed: typeof authority.changed) => {
  authority.changed = changed
} }))
vi.mock('~/lib/db/native-snapshot', () => ({ inspectNativeMigrationSnapshot: async () => ({ sha256: 'a'.repeat(64), schemaVersion: 60 }) }))

for (const action of ['publish', 'retire'] as const) {
  it(`${action} 已生效但响应及批次读取失败时，重进仍可见并核对原编号`, async () => {
    const f = await createSubcontractFixture()
    const native = await createMigratedMemoryDb()
    try {
      f.setActor({ ...f.session(), capabilities: [...f.session().capabilities, 'finance-invoice:read', 'finance-invoice:write', 'finance-invoice:import'] })
      await native.execute(`INSERT INTO invoices(id,file_name,file_path,source,invoice_number,invoice_date,seller,amount,tax_amount,total_amount,ocr_status,review_status,account_status,dup_status,print_count,print_rotation,items) VALUES ('legacy-pending-one','missing.pdf','','scan','SYN-PENDING','2026-01-01','合成销方',0,0,100,'pending','unreviewed','none','normal',0,0,'[]')`)
      const bytes = native.raw.export()
      const source = { sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: Buffer.from(bytes).toString('base64') }
      const mappings = { projects: [], suppliers: [], contracts: [] }
      const migration = createProductionInvoiceMigration(f.storage)
      const identity = f.session()
      const storageMap = new Map<string, string>()
      const storage = () => ({
        get length() { return storageMap.size },
        key: (index: number) => [...storageMap.keys()][index] ?? null,
        getItem: (key: string) => storageMap.get(key) ?? null,
        setItem: (key: string, value: string) => { storageMap.set(key, value) },
        removeItem: (key: string) => { storageMap.delete(key) },
      })
      const previous = action === 'retire' ? await migration.publish({ workspaceId: identity.workspaceId, actorId: identity.actorId, commandId: 'pending-previous-publish', source, mappings, confirmed: true }, f.session) : null
      let stateUnavailable = true
      let publishes = 0
      const session = createInvoiceMigrationSession({ identity, context: async () => f.session(), storage, commandId: () => `pending-${action}-command`, fetcher: async (url, options) => {
        if (url.endsWith('/migration-publish')) {
          publishes++
          await migration.publish(options?.body, f.session)
          throw new Error('合成发布响应丢失')
        }
        if (url.endsWith('/migration-retire')) {
          await migration.retire(options?.body, f.session)
          throw new Error('合成撤回响应丢失')
        }
        if (url.endsWith('/migration-resolve'))
          return migration.resolve(options?.body, f.session)
        if (stateUnavailable)
          throw new Error('合成批次读取 503')
        return migration.state(f.session)
      } })
      if (action === 'publish')
        await expect(session.publish(source, mappings)).rejects.toThrow('合成发布响应丢失')
      else
        await expect(session.retire(previous!.batchId)).rejects.toThrow('合成撤回响应丢失')
      const targetId = previous?.batchId ?? null
      expect(session.pending(targetId)?.commandId).toBe(`pending-${action}-command`)
      const view = render(InvoiceMigrationPanel, { props: { session, previewClient: {} as never, catalogClient: {} as never } })
      expect((await screen.findByRole('alert')).textContent).toContain('合成批次读取 503')
      await screen.findByText(`原提交 pending-${action}-command 尚未核对。`)
      expect((screen.getByLabelText('选择完整 SQLite 快照') as HTMLInputElement).disabled).toBe(true)
      expect(session.pending(targetId)?.commandId).toBe(`pending-${action}-command`)
      stateUnavailable = false
      await fireEvent.click(screen.getByRole('button', { name: '重新读取批次' }))
      await waitFor(() => expect((screen.getByRole('button', { name: '核对原提交' }) as HTMLButtonElement).disabled).toBe(false))
      await fireEvent.click(screen.getByRole('button', { name: '核对原提交' }))
      await waitFor(() => expect(session.pending(targetId)).toBeNull())
      expect(publishes).toBe(action === 'publish' ? 1 : 0)
      view.unmount()
    }
    finally {
      native.close()
      await f.storage.close()
    }
  }, 30_000)
}

it('发布响应丢失后批次读取挂起时先显示原编号，撤权后迟到读取不得覆盖提示', async () => {
  let unresolved = false
  let release!: (value: never[]) => void
  const session = {
    pendingAll: () => unresolved ? [{ targetId: null, commandId: 'hung-publish' }] : [],
    state: () => unresolved ? new Promise<never[]>((resolve) => { release = resolve }) : Promise.resolve([]),
    publish: async () => {
      unresolved = true
      throw new Error('合成响应丢失')
    },
  }
  const sourcePreview = { sourceSha256: 'a'.repeat(64), schemaVersion: 60, invoices: [{ legacyId: 'invoice-one', invoiceNumber: '001', deleted: false, sourceState: 'session-original-unavailable', ambiguousZeroFields: [], historicalAllocationCount: 0, originalCount: 0, originalBodyStates: [] }], references: [], orphanLogCount: 0 }
  const previewClient = { source: async () => sourcePreview, mappings: async () => ({ sourceSha256: 'a'.repeat(64), invoiceCount: 1, missingAllocationIds: [], orphanLogCount: 0 }) }
  const catalogClient = { load: async () => ({ projects: [], suppliers: [], contracts: [] }) }
  const view = render(InvoiceMigrationPanel, { props: { session: session as never, previewClient: previewClient as never, catalogClient: catalogClient as never } })
  await waitFor(() => expect((screen.getByLabelText('选择完整 SQLite 快照') as HTMLInputElement).disabled).toBe(false))
  const file = new File(['synthetic'], 'synthetic.sqlite')
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1]).buffer })
  await fireEvent.change(screen.getByLabelText('选择完整 SQLite 快照'), { target: { files: [file] } })
  await waitFor(() => expect((screen.getByRole('button', { name: '核对映射与历史付款' }) as HTMLButtonElement).disabled).toBe(false))
  await fireEvent.click(screen.getByRole('button', { name: '核对映射与历史付款' }))
  await waitFor(() => expect((screen.getByRole('button', { name: '确认迁入' }) as HTMLButtonElement).disabled).toBe(false))
  await fireEvent.click(screen.getByRole('button', { name: '确认迁入' }))
  await screen.findByText('原提交 hung-publish 尚未核对。')
  expect(screen.getByText(/来源 a{64}/).textContent).toContain('1 条发票')
  expect((screen.getByLabelText('选择完整 SQLite 快照') as HTMLInputElement).disabled).toBe(true)
  authority.changed({ message: '当前身份无读取权限。' })
  await screen.findByText('当前身份无读取权限。')
  release([])
  await waitFor(() => expect(screen.queryByText('原提交 hung-publish 尚未核对。')).toBeNull())
  expect(screen.getByRole('alert').textContent).toBe('当前身份无读取权限。')
  view.unmount()
})

it('核对原提交期间失权时立即隐藏编号且不清除存储', async () => {
  let verified = true
  const stored = { commandId: 'forbidden-command', targetId: null }
  const session = {
    pendingAll: () => [stored],
    identityVerified: () => verified,
    state: async () => [],
    recover: async () => {
      verified = false
      throw new CentralInvoiceProblem('forbidden', '当前迁入权限已撤销。')
    },
  }
  const view = render(InvoiceMigrationPanel, { props: { session: session as never, previewClient: {} as never, catalogClient: {} as never } })
  await screen.findByText('原提交 forbidden-command 尚未核对。')
  await waitFor(() => expect((screen.getByRole('button', { name: '核对原提交' }) as HTMLButtonElement).disabled).toBe(false))
  await fireEvent.click(screen.getByRole('button', { name: '核对原提交' }))
  await screen.findByText('当前迁入权限已撤销。')
  expect(screen.queryByText('原提交 forbidden-command 尚未核对。')).toBeNull()
  expect(stored.commandId).toBe('forbidden-command')
  view.unmount()
})
