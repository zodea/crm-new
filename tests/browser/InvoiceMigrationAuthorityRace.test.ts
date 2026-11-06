import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h } from 'vue'
import InvoiceMigrationPanel from '~/components/migration/InvoiceMigrationPanel.vue'
import { createInvoiceMigrationSession } from '~/lib/invoice/central-migration'

const ui = vi.hoisted(() => ({ invalidate: (_problem: { message: string }) => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true }) }))
vi.mock('~/lib/read-model/authority', () => ({ bindReadAuthority: (callback: typeof ui.invalidate) => {
  ui.invalidate = callback
} }))
vi.mock('~/lib/db/native-snapshot', () => ({ inspectNativeMigrationSnapshot: async () => ({ sha256: 'a'.repeat(64), schemaVersion: 60 }) }))

for (const action of ['publish', 'retire'] as const) {
  it(`${action} 键盘确认后授权期间失权，不发送旧命令`, async () => {
    const actor = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'finance-invoice:write', 'finance-invoice:import'] }
    const sha256 = 'a'.repeat(64)
    const asOf = '2026-01-01T00:00:00.000Z'
    const storageData = new Map<string, string>()
    const storage = () => ({
      get length() { return storageData.size },
      key: (index: number) => [...storageData.keys()][index] ?? null,
      getItem: (key: string) => storageData.get(key) ?? null,
      setItem: (key: string, value: string) => { storageData.set(key, value) },
      removeItem: (key: string) => { storageData.delete(key) },
    })
    const initial = { commandId: 'initial-command', batchId: 'batch-one', sourceSha256: sha256, invoiceIds: ['invoice-one'], createdAt: asOf, retiredAt: null }
    let holdNext = false
    let resume: (() => void) | undefined
    let released = false
    const writes: unknown[] = []
    const session = createInvoiceMigrationSession({ identity: actor, verifiedIdentity: actor, storage, commandId: () => 'race-command', context: async () => {
      if (holdNext) {
        holdNext = false
        await new Promise<void>((resolve) => {
          resume = resolve
        })
        released = true
      }
      return actor
    }, fetcher: async (url, options) => {
      if (url.endsWith('/migration-state')) {
        const meta = { schemaVersion: 'invoice-read-v1', workspaceId: actor.workspaceId, actorId: actor.actorId, dataOrigin: 'real', asOf, sourceVersion: 'invoices:1', sources: [{ key: 'invoices', state: 'readable', sourceVersion: 'invoices:1', asOf }], authorizedScope: { coverage: 'complete', fingerprint: 'scope' }, capabilities: actor.capabilities }
        return { dataOrigin: 'real', asOf, sourceVersion: meta.sourceVersion, capabilities: actor.capabilities, meta, batches: action === 'retire' ? [initial] : [] }
      }
      writes.push(options?.body)
      throw new Error('失权后不应发送')
    } })
    const previewClient = { source: async () => ({ sourceSha256: sha256, schemaVersion: 60, invoices: [{ legacyId: 'invoice-one', invoiceNumber: '001', deleted: false, sourceState: 'session-original-unavailable', ambiguousZeroFields: [], historicalAllocationCount: 0, originalCount: 0, originalBodyStates: [] }], references: [], orphanLogCount: 0 }), mappings: async () => ({ sourceSha256: sha256, invoiceCount: 1, missingAllocationIds: [], orphanLogCount: 0 }) }
    const catalogClient = { load: async () => ({ projects: [], suppliers: [], contracts: [] }) }
    await render(defineComponent({ setup: () => () => h('main', { style: { minWidth: '0', maxWidth: '100%', padding: '12px' } }, h(InvoiceMigrationPanel, { session, previewClient, catalogClient } as never)) }))
    await expect.element(page.getByLabelText('选择完整 SQLite 快照')).toBeEnabled()
    if (action === 'publish') {
      const input = page.getByLabelText('选择完整 SQLite 快照').element() as HTMLInputElement
      const transfer = new DataTransfer()
      transfer.items.add(new File(['synthetic'], 'synthetic.sqlite'))
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await expect.element(page.getByRole('button', { name: '核对映射与历史付款' })).toBeEnabled()
      await page.getByRole('button', { name: '核对映射与历史付款' }).click()
    }
    const button = page.getByRole('button', { name: action === 'publish' ? '确认迁入' : '撤回批次' })
    await expect.element(button).toBeEnabled()
    button.element().focus()
    await expect.element(button).toHaveFocus()
    holdNext = true
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => !!resume).toBe(true)
    ui.invalidate({ message: '来源不可用' })
    resume!()
    await expect.poll(() => released).toBe(true)
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    await expect.element(page.getByRole('alert')).toHaveTextContent('来源不可用')
    expect(writes).toHaveLength(0)
    expect(storageData.size).toBe(0)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
  })
}
