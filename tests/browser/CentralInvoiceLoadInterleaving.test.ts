import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { computed, shallowRef, useTemplateRef, watch } from 'vue'
import CentralInvoiceWorkspaceScreen from '~/components/invoice/CentralInvoiceWorkspaceScreen.vue'
import { createCentralInvoiceHttp } from '~/lib/invoice/central-http'
import { createCentralInvoiceWorkspace } from '~/lib/invoice/central-workspace'

vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true, undoToast: () => {} }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))
beforeEach(() => {
  for (const [name, value] of Object.entries({ computed, shallowRef, useTemplateRef, watch }))
    vi.stubGlobal(name, value)
  vi.stubGlobal('useEventListener', vi.fn())
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
for (const oldResult of ['success', 'network'] as const) {
  it(`后继来源读取完成后旧载入 ${oldResult} 不污染，键盘可继续操作`, async ({ task }) => {
    const width = /^chromium-(390|1280)$/.exec(task.file.projectName ?? '')
    expect(window.innerWidth).toBe(Number(width?.[1]))
    const identity = { workspaceId: 'synthetic-workspace', actorId: 'synthetic-actor' }
    const caps = ['finance-invoice:read', 'finance-invoice:write']
    const at = '2026-01-01T00:00:00.000Z'
    let current: CentralInvoiceRecord = { id: 'invoice-001', version: '1', sourceKind: 'manual', fields: { invoiceNumber: 'SYN-001', invoiceDate: '', invoiceType: '', buyer: '合成购方', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: null, taxRate: '', remark: '' }, items: [], unrecognizedPageIndexes: [], ocrStatus: 'pending', completionMethod: null, reviewStatus: 'unreviewed', accountStatus: 'none', duplicateStatus: 'normal', printCount: 0, printRotation: 0, ownerKind: null, projectId: null, supplierId: null, contract: null, archivedAt: null, original: null, createdAt: at, updatedAt: at, deletedAt: null }
    let revision = 1
    let holdOld = false
    const writeEntered = deferred()
    const writeGate = deferred()
    const listEntered = deferred()
    const listGate = deferred()
    const values = new Map<string, string>()
    const storage = () => ({
      get length() { return values.size },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    })
    const evidence = (scope: string) => {
      const sourceVersion = `read-synthetic-${revision}`
      const meta = { schemaVersion: 'invoice-read-v1', ...identity, dataOrigin: 'real', asOf: at, sourceVersion, sources: [{ key: 'invoices', state: 'readable', sourceVersion: `invoices:${revision}`, asOf: at }], authorizedScope: { coverage: 'complete', fingerprint: scope }, capabilities: [...caps] }
      return { dataOrigin: 'real', asOf: at, sourceVersion, capabilities: [...caps], meta }
    }
    const fetcher = vi.fn<Parameters<typeof createCentralInvoiceHttp>[0]>(async (url, options) => {
      if (url === '/api/read/invoices') {
        const snapshot = { ...evidence('scope-list'), items: [structuredClone(current)], pagination: { requestedPage: 1, page: 1, pageSize: 100, total: 1 } }
        if (holdOld) {
          holdOld = false
          listEntered.resolve()
          await listGate.promise
          if (oldResult === 'network')
            throw new Error('合成旧网络读取失败')
        }
        return snapshot
      }
      if (url === '/api/commands/invoices') {
        writeEntered.resolve()
        await writeGate.promise
        revision = 2
        current = { ...current, version: '2' }
        return { commandId: (options!.body as { commandId: string }).commandId, invoiceId: current.id, version: '2', originalId: null, updatedAt: at }
      }
      if (url === '/api/read/invoices/invoice-001')
        return { ...evidence('scope-detail'), record: structuredClone(current) }
      throw new Error(`拒绝未知合成请求 ${url}`)
    })
    const workspace = createCentralInvoiceWorkspace({ identity, client: createCentralInvoiceHttp(fetcher, identity), context: async () => ({ ...identity, capabilities: [...caps] }), recognizeLocal: async () => {
      throw new Error('未使用识别')
    }, storage, commandId: () => 'synthetic-command' })
    await workspace.load()
    const original = JSON.parse(JSON.stringify(workspace.records.value[0])) as CentralInvoiceRecord
    const submitted = workspace.edit(original, original.fields, original.items, () => true)
    await writeEntered.promise
    holdOld = true
    await render(CentralInvoiceWorkspaceScreen, { props: { workspace, projects: [], suppliers: [], signatories: [], initialSelectedId: original.id }, global: { stubs: { NuxtLink: true, InvoiceRegionViewer: true } } })
    await listEntered.promise
    writeGate.resolve()
    await submitted
    expect(workspace.readState.value).toBe('unavailable')
    await workspace.load()
    expect(workspace.records.value[0]?.version).toBe('2')
    listGate.resolve()
    if (window.innerWidth < 960)
      await page.getByRole('tab', { name: '校对' }).click()
    const buyer = page.getByLabelText('购买方', { exact: true })
    await expect.element(buyer).toBeEnabled()
    await buyer.fill('合成待修改购方')
    const save = page.getByRole('button', { name: '保存修改' })
    await expect.element(save).toBeEnabled()
    await expect.element(page.getByText('发票读取目标已变化。')).not.toBeInTheDocument()
    await expect.element(page.getByText('合成旧网络读取失败')).not.toBeInTheDocument()
    expect(workspace.readState.value).toBe('ready')
    expect(workspace.records.value[0]?.version).toBe('2')
    save.element().focus()
    await expect.element(save).toHaveFocus()
    await userEvent.keyboard('{Tab}')
    expect(document.activeElement).not.toBe(document.body)
    expect(fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices')).toHaveLength(1)
  })
}
