import type { CentralInvoiceCommand, CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { computed, defineComponent, h, nextTick, shallowRef, useTemplateRef, watch } from 'vue'
import CentralInvoiceWorkspaceScreen from '~/components/invoice/CentralInvoiceWorkspaceScreen.vue'
import { createCentralInvoiceWorkspace } from '~/lib/invoice/central-workspace'

const confirm = vi.hoisted(() => vi.fn<() => Promise<boolean>>())
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm, undoToast: () => {} }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))
beforeEach(() => {
  confirm.mockReset()
  for (const [name, value] of Object.entries({ computed, shallowRef, useTemplateRef, watch }))
    vi.stubGlobal(name, value)
  vi.stubGlobal('useEventListener', vi.fn())
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function fixture(workspaceId: string, invoiceNumber: string) {
  let current: CentralInvoiceRecord = {
    id: 'same-invoice',
    version: '1',
    sourceKind: 'legacy',
    fields: { invoiceNumber, invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '合成销方', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: 100, taxRate: '', remark: '' },
    items: [],
    unrecognizedPageIndexes: [],
    ocrStatus: 'pending',
    completionMethod: 'legacy',
    reviewStatus: 'unreviewed',
    accountStatus: 'archived',
    duplicateStatus: 'normal',
    printCount: 0,
    printRotation: 0,
    ownerKind: null,
    projectId: null,
    supplierId: null,
    contract: null,
    archivedAt: '2026-01-01T00:00:00.000Z',
    original: null,
    legacy: { source: 'excel', originalState: 'no-original-recorded', ambiguousZeroFields: [], ambiguousItemNumbers: false },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  }
  const memory = new Map<string, string>()
  const storage = {
    get length() { return memory.size },
    key: (i: number) => [...memory.keys()][i] ?? null,
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => { memory.set(k, v) },
    removeItem: (k: string) => { memory.delete(k) },
  }
  const execute = vi.fn(async (command: CentralInvoiceCommand) => {
    if (command.action !== 'confirm-legacy' || command.workspaceId !== workspaceId || command.actorId !== 'synthetic-actor' || command.invoiceId !== current.id || command.baseVersion !== current.version || !command.confirmed || current.sourceKind !== 'legacy' || current.accountStatus !== 'archived' || current.completionMethod !== 'legacy')
      throw new Error('合成旧票 sink 拒绝')
    current = { ...current, version: '2', completionMethod: 'manual' }
    return { invoiceId: current.id, commandId: command.commandId, version: current.version, updatedAt: current.updatedAt, originalId: null }
  })
  const get = vi.fn(async () => ({ record: structuredClone(current), sourceVersion: 'invoices:2', meta: { sources: [{ key: 'invoices', sourceVersion: 'invoices:2' }] } }))
  const workspace = createCentralInvoiceWorkspace({
    identity: { workspaceId, actorId: 'synthetic-actor' },
    context: async () => ({ workspaceId, actorId: 'synthetic-actor', capabilities: ['finance-invoice:read', 'finance-invoice:write'] }),
    client: { list: async () => ({ items: [structuredClone(current)], pagination: { total: 1 }, sourceVersion: 'invoices:1', meta: { sources: [{ key: 'invoices', sourceVersion: 'invoices:1' }] } }), execute, get } as never,
    recognizeLocal: vi.fn() as never,
    storage: () => storage,
    commandId: () => `synthetic-command-${workspaceId}`,
  })
  await workspace.load()
  return { workspace, execute, get, memory, current: () => current }
}
async function startLegacy() {
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '校对' }).click()
  const button = page.getByRole('button', { name: '核对旧发票后用于新付款' })
  await expect.element(button).toBeEnabled()
  button.element().focus()
  await expect.element(button).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => confirm.mock.calls.length).toBe(1)
  return button
}
it('键盘确认期间切换来源，旧核对不作用于新票', async ({ task }) => {
  const width = /^chromium-(390|768|1024|1280|1440)$/.exec(task.file.projectName ?? '')
  expect(window.innerWidth).toBe(Number(width?.[1]))
  const a = await fixture('synthetic-a', 'SYN-A')
  const b = await fixture('synthetic-b', 'SYN-B')
  const current = shallowRef(a.workspace)
  const confirmation = deferred<boolean>()
  confirm.mockReturnValueOnce(confirmation.promise)
  const Host = defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceScreen, { workspace: current.value, projects: [], suppliers: [], signatories: [], initialSelectedId: 'same-invoice' }) })
  await render(Host, { global: { stubs: { NuxtLink: true } } })
  const button = await startLegacy()
  current.value = b.workspace
  await nextTick()
  confirmation.resolve(true)
  await expect.element(page.getByRole('alert')).toHaveTextContent('旧发票核对未提交')
  expect(a.execute).not.toHaveBeenCalled()
  expect(b.execute).not.toHaveBeenCalled()
  expect(a.current().completionMethod).toBe('legacy')
  expect(b.current().completionMethod).toBe('legacy')
  await expect.element(button).toHaveFocus()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})
it('键盘确认期间卸载，迟到确认不能核对旧票', async () => {
  const a = await fixture('synthetic-a', 'SYN-A')
  const confirmation = deferred<boolean>()
  confirm.mockReturnValueOnce(confirmation.promise)
  const view = await render(CentralInvoiceWorkspaceScreen, { props: { workspace: a.workspace, projects: [], suppliers: [], signatories: [], initialSelectedId: 'same-invoice' }, global: { stubs: { NuxtLink: true } } })
  await startLegacy()
  view.unmount()
  confirmation.resolve(true)
  await confirmation.promise
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  expect(a.execute).not.toHaveBeenCalled()
  expect(a.memory.size).toBe(0)
})
it('同源键盘确认后恰好核对一次并回读', async () => {
  const a = await fixture('synthetic-a', 'SYN-A')
  confirm.mockResolvedValueOnce(true)
  await render(CentralInvoiceWorkspaceScreen, { props: { workspace: a.workspace, projects: [], suppliers: [], signatories: [], initialSelectedId: 'same-invoice' }, global: { stubs: { NuxtLink: true } } })
  await startLegacy()
  await expect.poll(() => a.execute.mock.calls.length).toBe(1)
  await expect.poll(() => a.get.mock.calls.length).toBe(1)
  await expect.poll(() => a.memory.size).toBe(0)
  expect(a.current().completionMethod).toBe('manual')
  expect(a.workspace.records.value[0]?.completionMethod).toBe('manual')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})
