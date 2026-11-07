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

for (const outcome of ['applied', 'not-applied'] as const) {
  it(`${outcome} 键盘核对期间失权保留原编号，恢复后继续核对`, async () => {
    const actor = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'finance-invoice:write', 'finance-invoice:import'] }
    const asOf = '2026-01-01T00:00:00.000Z'
    const sha256 = 'a'.repeat(64)
    const values = new Map<string, string>()
    const storage = () => ({
      get length() { return values.size },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    })
    const original = { commandId: 'original-command', batchId: 'batch-one', sourceSha256: sha256, invoiceIds: ['invoice-one'], createdAt: asOf }
    let resume: (() => void) | undefined
    let holdNext = true
    let settled = 0
    const resolutions: unknown[] = []
    const session = createInvoiceMigrationSession({ identity: actor, verifiedIdentity: actor, storage, commandId: () => 'original-command', context: async () => actor, fetcher: async (url, options) => {
      if (url.endsWith('/migration-publish'))
        throw new Error('合成原提交响应丢失')
      if (url.endsWith('/migration-resolve')) {
        resolutions.push(options?.body)
        if (holdNext) {
          holdNext = false
          await new Promise<void>((resolve) => {
            resume = resolve
          })
        }
        return outcome === 'applied' ? { outcome: 'applied', result: original } : { outcome: 'not-applied', commandId: 'original-command' }
      }
      if (url.endsWith('/migration-state')) {
        const meta = { schemaVersion: 'invoice-read-v1', workspaceId: actor.workspaceId, actorId: actor.actorId, dataOrigin: 'real', asOf, sourceVersion: 'invoices:1', sources: [{ key: 'invoices', state: 'readable', sourceVersion: 'invoices:1', asOf }], authorizedScope: { coverage: 'complete', fingerprint: 'scope' }, capabilities: actor.capabilities }
        return { dataOrigin: 'real', asOf, sourceVersion: meta.sourceVersion, capabilities: actor.capabilities, meta, batches: outcome === 'applied' ? [{ ...original, retiredAt: null }] : [] }
      }
      throw new Error(`未预期的合成请求 ${url}`)
    } })
    const recover = session.recover
    session.recover = (targetId, isCurrent) => {
      const pending = recover(targetId, isCurrent)
      pending.then(() => {
        settled++
      }, () => {
        settled++
      })
      return pending
    }
    await expect(session.publish({ sha256, payloadBase64: 'AA==' }, { projects: [], suppliers: [], contracts: [] })).rejects.toThrow('合成原提交响应丢失')
    const Host = defineComponent({ setup: () => () => h('main', { style: { minWidth: '0', maxWidth: '100%', padding: '12px' } }, h(InvoiceMigrationPanel, { session, previewClient: {}, catalogClient: {} } as never)) })
    const first = await render(Host)
    const button = page.getByRole('button', { name: '核对原提交' })
    await expect.element(button).toBeEnabled()
    button.element().focus()
    await expect.element(button).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => !!resume).toBe(true)
    ui.invalidate({ message: '来源不可用' })
    resume!()
    await expect.poll(() => settled).toBe(1)
    expect(session.pending(null)?.commandId).toBe('original-command')
    await expect.element(page.getByRole('alert')).toHaveTextContent('来源不可用')
    expect(document.body.textContent).not.toMatch(/原提交已核对，批次|已核对原提交未生效/)
    first.unmount()
    await render(Host)
    const retry = page.getByRole('button', { name: '核对原提交' })
    await expect.element(retry).toBeEnabled()
    retry.element().focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByText(outcome === 'applied' ? '原提交已核对，批次 batch-one。' : '已核对原提交未生效，可以重新预检。')).toBeVisible()
    expect(session.pending(null)).toBeNull()
    expect(resolutions).toHaveLength(2)
    expect(resolutions.every(body => (body as { commandId: string }).commandId === 'original-command')).toBe(true)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
  })
}
