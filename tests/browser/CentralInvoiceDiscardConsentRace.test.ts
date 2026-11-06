import type { CentralInvoiceCommand, CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { computed, shallowRef, useTemplateRef, watch } from 'vue'
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
async function fixture() {
  const identity = { workspaceId: 'synthetic-workspace', actorId: 'synthetic-actor' }
  let current: CentralInvoiceRecord = { id: 'synthetic-invoice', version: '1', sourceKind: 'manual', fields: { invoiceNumber: 'SYN-001', invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: null, taxRate: '', remark: '' }, items: [], unrecognizedPageIndexes: [], ocrStatus: 'pending', completionMethod: null, reviewStatus: 'unreviewed', accountStatus: 'none', duplicateStatus: 'normal', printCount: 0, printRotation: 0, ownerKind: null, projectId: null, supplierId: null, contract: null, archivedAt: null, original: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
  const memory = new Map<string, string>()
  const storage = {
    get length() { return memory.size },
    key: (index: number) => [...memory.keys()][index] ?? null,
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value) },
    removeItem: (key: string) => { memory.delete(key) },
  }
  const execute = vi.fn(async (command: CentralInvoiceCommand) => {
    if (command.action !== 'discard' || command.invoiceId !== current.id || command.baseVersion !== current.version)
      throw new Error('合成 sink 拒绝身份或版本不一致')
    current = { ...current, deletedAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', version: '2' }
    return { invoiceId: current.id, commandId: command.commandId, version: current.version, updatedAt: current.updatedAt, originalId: null }
  })
  const get = vi.fn(async () => ({ record: structuredClone(current), sourceVersion: 'invoices:2', meta: { sources: [{ key: 'invoices', sourceVersion: 'invoices:2' }] } }))
  const list = vi.fn(async () => ({ items: [structuredClone(current)], pagination: { total: 1 }, sourceVersion: 'invoices:1', meta: { sources: [{ key: 'invoices', sourceVersion: 'invoices:1' }] } }))
  const workspace = createCentralInvoiceWorkspace({ identity, context: async () => ({ ...identity, capabilities: ['finance-invoice:read', 'finance-invoice:write'] }), client: { list, execute, get } as never, recognizeLocal: vi.fn() as never, storage: () => storage, commandId: () => 'synthetic-command-001' })
  await workspace.load()
  return { workspace, execute, get, memory, current: () => current }
}
async function focusDiscard() {
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '校对' }).click()
  const button = page.getByRole('button', { name: '废弃发票' })
  await expect.element(button).toBeEnabled()
  button.element().focus()
  await expect.element(button).toHaveFocus()
  await userEvent.keyboard('{Enter}')
}

it('键盘触发废弃后页面卸载，迟到确认不写入', async ({ task }) => {
  const width = /^chromium-(390|768|1024|1280|1440)$/.exec(task.file.projectName ?? '')
  expect(window.innerWidth).toBe(Number(width?.[1]))
  const f = await fixture()
  const confirmation = deferred<boolean>()
  confirm.mockReturnValueOnce(confirmation.promise)
  const view = await render(CentralInvoiceWorkspaceScreen, { props: { workspace: f.workspace, projects: [], suppliers: [], signatories: [], initialSelectedId: 'synthetic-invoice' }, global: { stubs: { NuxtLink: true } } })
  await focusDiscard()
  await expect.poll(() => confirm.mock.calls.length).toBe(1)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
  view.unmount()
  confirmation.resolve(true)
  await confirmation.promise
  // 让确认后的 Promise 微任务完全排空；合成 context 和 sink 均不含外部异步任务。
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  expect(f.execute).not.toHaveBeenCalled()
  expect(f.current().deletedAt).toBeNull()
  expect(f.memory.size).toBe(0)
})

it('同源键盘确认后恰好写入一次并回读', async () => {
  const f = await fixture()
  confirm.mockResolvedValueOnce(true)
  await render(CentralInvoiceWorkspaceScreen, { props: { workspace: f.workspace, projects: [], suppliers: [], signatories: [], initialSelectedId: 'synthetic-invoice' }, global: { stubs: { NuxtLink: true } } })
  await focusDiscard()
  await expect.poll(() => f.execute.mock.calls.length).toBe(1)
  await expect.poll(() => f.get.mock.calls.length).toBe(1)
  await expect.poll(() => f.memory.size).toBe(0)
  expect(f.current().deletedAt).toBe('2026-01-02T00:00:00.000Z')
  expect(f.workspace.records.value).toHaveLength(0)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})
