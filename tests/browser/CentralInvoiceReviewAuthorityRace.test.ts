import type { CentralInvoiceCommand, CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { computed, defineComponent, h, nextTick, shallowRef, useTemplateRef, watch } from 'vue'
import CentralInvoiceWorkspaceScreen from '~/components/invoice/CentralInvoiceWorkspaceScreen.vue'
import { createCentralInvoiceWorkspace } from '~/lib/invoice/central-workspace'

vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: vi.fn(async () => true), undoToast: () => {} }) }))
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
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function fixture(workspaceId: string) {
  const identity = { workspaceId, actorId: 'synthetic-actor' }
  let current: CentralInvoiceRecord = {
    id: `invoice-${workspaceId}`,
    version: '1',
    sourceKind: 'manual',
    fields: { invoiceNumber: `SYN-${workspaceId}`, invoiceDate: '2026-01-01', invoiceType: '', buyer: `购方-${workspaceId}`, buyerTaxNo: '', seller: '合成销方', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: 100, taxRate: '', remark: '' },
    items: [],
    unrecognizedPageIndexes: [],
    ocrStatus: 'pending',
    completionMethod: null,
    reviewStatus: 'unreviewed',
    accountStatus: 'none',
    duplicateStatus: 'normal',
    printCount: 0,
    printRotation: 0,
    ownerKind: null,
    projectId: null,
    supplierId: null,
    contract: null,
    archivedAt: null,
    original: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  }
  const memory = new Map<string, string>()
  let storageAvailable = true
  const storage = {
    get length() {
      if (!storageAvailable)
        throw new Error('合成存储不可读')
      return memory.size
    },
    key: (index: number) => [...memory.keys()][index] ?? null,
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value) },
    removeItem: (key: string) => { memory.delete(key) },
  }
  let contextHook: () => Promise<void> = async () => {}
  const execute = vi.fn(async (command: CentralInvoiceCommand) => {
    if (command.action !== 'review' || command.workspaceId !== identity.workspaceId || command.actorId !== identity.actorId || command.invoiceId !== current.id || command.baseVersion !== current.version || command.manualCompletion !== true)
      throw new Error('合成写入拒绝身份、版本或核对方式不一致')
    current = { ...current, reviewStatus: 'reviewed', completionMethod: 'manual', version: '2', updatedAt: '2026-01-02T00:00:00.000Z' }
    return { invoiceId: current.id, commandId: command.commandId, version: current.version, updatedAt: current.updatedAt, originalId: null }
  })
  const get = vi.fn(async () => ({ record: structuredClone(current), sourceVersion: 'read-synthetic-2', meta: { sources: [{ key: 'invoices', sourceVersion: 'invoices:2' }] } }))
  const list = vi.fn(async () => ({ items: [structuredClone(current)], pagination: { total: 1 }, sourceVersion: 'read-synthetic-1', meta: { sources: [{ key: 'invoices', sourceVersion: 'invoices:1' }] } }))
  const workspace = createCentralInvoiceWorkspace({
    identity,
    context: async () => {
      await contextHook()
      return { ...identity, capabilities: ['finance-invoice:read', 'finance-invoice:write'] }
    },
    client: { list, execute, get } as never,
    recognizeLocal: vi.fn() as never,
    storage: () => storage,
    commandId: () => `synthetic-command-${workspaceId}`,
  })
  return {
    workspace,
    execute,
    get,
    memory,
    current: () => current,
    setContextHook: (hook: () => Promise<void>) => { contextHook = hook },
    setStorageAvailable: (available: boolean) => { storageAvailable = available },
  }
}
async function prepare() {
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '校对' }).click()
  const button = page.getByRole('button', { name: '确认人工补全' })
  await expect.element(button).toBeEnabled()
  button.element().focus()
  await expect.element(button).toHaveFocus()
  return button
}
function pauseSecondAuthorization(a: ReturnType<typeof fixture>) {
  const entered = deferred<void>()
  const release = deferred<void>()
  let calls = 0
  a.setContextHook(async () => {
    if (++calls === 2) {
      entered.resolve()
      await release.promise
    }
  })
  return { entered, release }
}
it('键盘核对等待授权时切换来源，不发送旧操作', async ({ task }) => {
  const width = /^chromium-(390|768|1024|1280|1440)$/.exec(task.file.projectName ?? '')
  expect(window.innerWidth).toBe(Number(width?.[1]))
  const a = fixture('synthetic-a')
  const b = fixture('synthetic-b')
  await a.workspace.load()
  await b.workspace.load()
  const selectedWorkspace = shallowRef(a.workspace)
  const Host = defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceScreen, { workspace: selectedWorkspace.value, projects: [], suppliers: [], signatories: [], initialSelectedId: a.current().id }) })
  await render(Host, { global: { stubs: { NuxtLink: true, InvoiceRegionViewer: true } } })
  await prepare()
  const { entered, release } = pauseSecondAuthorization(a)
  await userEvent.keyboard('{Enter}')
  await entered.promise
  expect(a.memory.size).toBe(0)
  selectedWorkspace.value = b.workspace
  await nextTick()
  release.resolve()
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '队列' }).click()
  await expect.element(page.getByRole('button', { name: 'SYN-synthetic-b' })).toBeEnabled()
  expect(a.execute).not.toHaveBeenCalled()
  expect(b.execute).not.toHaveBeenCalled()
  expect(a.memory.size).toBe(0)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})
it('同源键盘核对写入一次并回读', async () => {
  const a = fixture('synthetic-a')
  await a.workspace.load()
  await render(CentralInvoiceWorkspaceScreen, { props: { workspace: a.workspace, projects: [], suppliers: [], signatories: [], initialSelectedId: a.current().id }, global: { stubs: { NuxtLink: true, InvoiceRegionViewer: true } } })
  await prepare()
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => a.execute.mock.calls.length).toBe(1)
  await expect.poll(() => a.get.mock.calls.length).toBe(1)
  await expect.poll(() => a.memory.size).toBe(0)
  expect(a.current().reviewStatus).toBe('reviewed')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})
it('授权等待后存储不可读时优先说明缺口并阻止核对', async () => {
  const a = fixture('synthetic-a')
  await a.workspace.load()
  await render(CentralInvoiceWorkspaceScreen, { props: { workspace: a.workspace, projects: [], suppliers: [], signatories: [], initialSelectedId: a.current().id }, global: { stubs: { NuxtLink: true, InvoiceRegionViewer: true } } })
  const button = await prepare()
  const { entered, release } = pauseSecondAuthorization(a)
  await userEvent.keyboard('{Enter}')
  await entered.promise
  a.setStorageAvailable(false)
  await a.workspace.load()
  release.resolve()
  await expect.element(page.getByRole('alert')).toHaveTextContent('无法可靠核对原提交编号，请恢复浏览器存储')
  await expect.element(button).toBeDisabled()
  expect(a.execute).not.toHaveBeenCalled()
  expect(a.memory.size).toBe(0)
  a.setStorageAvailable(true)
  await a.workspace.load()
  await expect.element(button).toBeEnabled()
})
it('核对授权等待时页面卸载，迟到授权不提交', async () => {
  const a = fixture('synthetic-a')
  const review = vi.spyOn(a.workspace, 'review')
  await a.workspace.load()
  const view = await render(CentralInvoiceWorkspaceScreen, { props: { workspace: a.workspace, projects: [], suppliers: [], signatories: [], initialSelectedId: a.current().id }, global: { stubs: { NuxtLink: true, InvoiceRegionViewer: true } } })
  await prepare()
  const { entered, release } = pauseSecondAuthorization(a)
  await userEvent.keyboard('{Enter}')
  await entered.promise
  view.unmount()
  release.resolve()
  expect(review).toHaveBeenCalledOnce()
  await expect(review.mock.results[0]!.value).rejects.toThrow('未提交')
  expect(a.execute).not.toHaveBeenCalled()
  expect(a.memory.size).toBe(0)
})
