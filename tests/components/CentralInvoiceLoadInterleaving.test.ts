import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { computed, shallowRef, useTemplateRef, watch } from 'vue'
import CentralInvoiceLedgerScreen from '~/components/invoice/CentralInvoiceLedgerScreen.vue'
import CentralInvoiceWorkspaceScreen from '~/components/invoice/CentralInvoiceWorkspaceScreen.vue'
import { CentralInvoiceProblem } from '~/lib/invoice/central-contract'
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
const identity = { workspaceId: 'synthetic-workspace', actorId: 'synthetic-actor' }
const caps = ['finance-invoice:read', 'finance-invoice:write']
const at = '2026-01-01T00:00:00.000Z'
function invoice(): CentralInvoiceRecord {
  return { id: 'invoice-001', version: '1', sourceKind: 'manual', fields: { invoiceNumber: 'SYN-001', invoiceDate: '', invoiceType: '', buyer: '合成购方', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: null, taxRate: '', remark: '' }, items: [], unrecognizedPageIndexes: [], ocrStatus: 'pending', completionMethod: null, reviewStatus: 'unreviewed', accountStatus: 'none', duplicateStatus: 'normal', printCount: 0, printRotation: 0, ownerKind: null, projectId: null, supplierId: null, contract: null, archivedAt: null, original: null, createdAt: at, updatedAt: at, deletedAt: null }
}
function evidence(revision: number, scope: string) {
  const sourceVersion = `read-synthetic-${revision}`
  const meta = { schemaVersion: 'invoice-read-v1', ...identity, dataOrigin: 'real', asOf: at, sourceVersion, sources: [{ key: 'invoices', state: 'readable', sourceVersion: `invoices:${revision}`, asOf: at }], authorizedScope: { coverage: 'complete', fingerprint: scope }, capabilities: [...caps] }
  return { dataOrigin: 'real', asOf: at, sourceVersion, capabilities: [...caps], meta }
}

it.each([
  { mode: 'workspace', oldResult: 'success' },
  { mode: 'ledger', oldResult: 'success' },
  { mode: 'workspace', oldResult: 'network' },
  { mode: 'ledger', oldResult: 'network' },
  { mode: 'workspace', oldResult: 'forbidden' },
  { mode: 'workspace', oldResult: 'unauthenticated' },
  { mode: 'ledger', oldResult: 'forbidden' },
  { mode: 'ledger', oldResult: 'unauthenticated' },
] as const)('$mode 后继读取完成后，按旧读取 $oldResult 处理当前页面', async ({ mode, oldResult }) => {
  let current = invoice()
  let revision = 1
  let holdOld = false
  const writeEntered = deferred()
  const writeGate = deferred()
  const listEntered = deferred()
  const listGate = deferred()
  const listReturned = deferred()
  const memory = new Map<string, string>()
  const storage = () => ({
    get length() { return memory.size },
    key: (index: number) => [...memory.keys()][index] ?? null,
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value) },
    removeItem: (key: string) => { memory.delete(key) },
  })
  const fetcher = vi.fn<Parameters<typeof createCentralInvoiceHttp>[0]>(async (url, options) => {
    if (url === '/api/read/invoices') {
      const snapshot = { ...evidence(revision, 'scope-list'), items: [structuredClone(current)], pagination: { requestedPage: 1, page: 1, pageSize: 100, total: 1 } }
      if (holdOld) {
        holdOld = false
        listEntered.resolve()
        await listGate.promise
        listReturned.resolve()
        if (oldResult === 'network')
          throw new Error('合成旧网络读取失败')
        if (oldResult === 'forbidden')
          throw new CentralInvoiceProblem('forbidden', '合成旧权限读取失败')
        if (oldResult === 'unauthenticated')
          throw new CentralInvoiceProblem('unauthenticated', '合成旧登录已失效')
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
      return { ...evidence(revision, 'scope-detail-invoice-001'), record: structuredClone(current) }
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
  const view = mode === 'workspace'
    ? render(CentralInvoiceWorkspaceScreen, { props: { workspace, projects: [], suppliers: [], signatories: [], initialSelectedId: original.id }, global: { stubs: { NuxtLink: true, InvoiceRegionViewer: true } } })
    : render(CentralInvoiceLedgerScreen, { props: { workspace, projects: [] }, global: { stubs: { NuxtLink: true, InvoiceRegionViewer: true } } })
  await listEntered.promise
  writeGate.resolve()
  await submitted
  expect(workspace.readState.value).toBe('unavailable')
  await workspace.load()
  expect(workspace.readState.value).toBe('ready')
  expect(workspace.records.value[0]?.version).toBe('2')
  listGate.resolve()
  await listReturned.promise
  await flushPromises()
  expect(workspace.loading.value).toBe(false)
  expect(screen.queryByText('发票读取目标已变化。')).toBeNull()
  expect(screen.queryByText('合成旧网络读取失败')).toBeNull()
  if (oldResult === 'forbidden' || oldResult === 'unauthenticated') {
    expect(workspace.readState.value).toBe('unavailable')
    expect(workspace.records.value).toEqual([])
    expect(workspace.sourceVersion.value).toBeNull()
    expect(screen.getByText(/发票来源尚不可用/)).toBeTruthy()
    const message = mode === 'ledger'
      ? '发票来源或权限已变化，请重新读取。'
      : oldResult === 'forbidden' ? '合成旧权限读取失败' : '合成旧登录已失效'
    expect(screen.getByRole('alert').textContent).toContain(message)
    await fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
    await waitFor(() => expect(workspace.readState.value).toBe('ready'))
    expect(workspace.records.value[0]?.version).toBe('2')
  }
  else {
    expect(workspace.readState.value).toBe('ready')
    expect(workspace.records.value[0]?.version).toBe('2')
  }
  expect(fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices')).toHaveLength(1)
  view.unmount()
})

it.each(['network', 'permission'] as const)('真实 %s 读取错误仍需提示', async (fault) => {
  const client = createCentralInvoiceHttp(async () => {
    throw new Error('合成网络读取失败')
  }, identity)
  const workspace = createCentralInvoiceWorkspace({ identity, client, context: async () => ({ ...identity, capabilities: fault === 'permission' ? ['finance-invoice:write'] : [...caps] }), recognizeLocal: async () => {
    throw new Error('未使用识别')
  } })
  const view = render(CentralInvoiceWorkspaceScreen, { props: { workspace, projects: [], suppliers: [], signatories: [] }, global: { stubs: { NuxtLink: true, InvoiceRegionViewer: true } } })
  const message = fault === 'network' ? '合成网络读取失败' : '发票工作区身份或权限已变化，请重新登录后核对原提交。'
  expect((await screen.findByRole('alert')).textContent).toContain(message)
  expect(workspace.readState.value).toBe('unavailable')
  view.unmount()
})
