import type { CentralInvoiceCommand, CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import CentralInvoiceWorkspaceScreen from '~/components/invoice/CentralInvoiceWorkspaceScreen.vue'
import { createCentralInvoiceWorkspace } from '~/lib/invoice/central-workspace'

const confirm = vi.hoisted(() => vi.fn<() => Promise<boolean>>())
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm, undoToast: () => {} }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))
beforeEach(() => confirm.mockReset())
afterEach(() => vi.restoreAllMocks())

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function fixture(workspaceId: string, invoiceNumber: string, additional: CentralInvoiceRecord[] = []) {
  const identity = { workspaceId, actorId: 'synthetic-actor' }
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
    key: (index: number) => [...memory.keys()][index] ?? null,
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value) },
    removeItem: (key: string) => { memory.delete(key) },
  }
  let contextHook: () => Promise<void> = async () => {}
  let lostResponse = false
  let receipt: { invoiceId: string, commandId: string, version: string, updatedAt: string, originalId: null } | undefined
  const execute = vi.fn(async (command: CentralInvoiceCommand) => {
    if (command.action !== 'confirm-legacy' || command.workspaceId !== identity.workspaceId || command.actorId !== identity.actorId
      || command.invoiceId !== current.id || command.baseVersion !== current.version || command.confirmed !== true
      || current.sourceKind !== 'legacy' || current.accountStatus !== 'archived' || current.completionMethod !== 'legacy') {
      throw new Error('合成 sink 拒绝身份、版本或旧票状态不一致')
    }
    current = { ...current, completionMethod: 'manual', version: '2', updatedAt: '2026-01-02T00:00:00.000Z' }
    receipt = { invoiceId: current.id, commandId: command.commandId, version: current.version, updatedAt: current.updatedAt, originalId: null }
    if (lostResponse)
      throw new Error('合成响应丢失')
    return receipt
  })
  const get = vi.fn(async () => ({ record: structuredClone(current), sourceVersion: 'invoices:2', meta: { sources: [{ key: 'invoices', sourceVersion: 'invoices:2' }] } }))
  const resolve = vi.fn(async (commandId: string) => {
    if (!receipt || commandId !== receipt.commandId)
      throw new Error('合成原编号不存在')
    return { outcome: 'applied' as const, result: receipt }
  })
  const list = vi.fn(async () => ({ items: structuredClone([current, ...additional]), pagination: { total: 1 + additional.length }, sourceVersion: 'invoices:1', meta: { sources: [{ key: 'invoices', sourceVersion: 'invoices:1' }] } }))
  const workspace = createCentralInvoiceWorkspace({
    identity,
    context: async () => {
      await contextHook()
      return { ...identity, capabilities: ['finance-invoice:read', 'finance-invoice:write'] }
    },
    client: { list, execute, get, resolve } as never,
    recognizeLocal: vi.fn() as never,
    storage: () => storage,
    commandId: () => `synthetic-command-${workspaceId}`,
  })
  return {
    workspace,
    execute,
    get,
    resolve,
    list,
    memory,
    current: () => current,
    setContextHook: (hook: () => Promise<void>) => { contextHook = hook },
    loseResponse: () => { lostResponse = true },
  }
}

async function show(f: ReturnType<typeof fixture>) {
  await f.workspace.load()
  const view = render(CentralInvoiceWorkspaceScreen, { props: { workspace: f.workspace, projects: [], suppliers: [], signatories: [], initialSelectedId: 'same-invoice' }, global: { stubs: { NuxtLink: true, InvoiceRegionViewer: true } } })
  const button = await screen.findByRole('button', { name: '核对旧发票后用于新付款' })
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  return { view, button }
}
async function start(button: HTMLElement) {
  await fireEvent.click(button)
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce())
}
async function showHost(a: ReturnType<typeof fixture>) {
  const selectedWorkspace = shallowRef(a.workspace)
  const Host = defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceScreen, { workspace: selectedWorkspace.value, projects: [], suppliers: [], signatories: [], initialSelectedId: 'same-invoice' }) })
  const view = render(Host, { global: { stubs: { NuxtLink: true, InvoiceRegionViewer: true } } })
  const button = await screen.findByRole('button', { name: '核对旧发票后用于新付款' })
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  return { view, button, selectedWorkspace }
}
it('同源确认只写入一次并回读', async () => {
  const f = fixture('synthetic-a', 'SYN-A')
  confirm.mockResolvedValueOnce(true)
  const { button } = await show(f)
  await start(button)
  await waitFor(() => expect(f.execute).toHaveBeenCalledOnce())
  await waitFor(() => expect(f.workspace.pending('same-invoice')).toBeNull())
  expect(f.execute).toHaveBeenCalledWith(expect.objectContaining({ action: 'confirm-legacy', workspaceId: 'synthetic-a', invoiceId: 'same-invoice', baseVersion: '1', confirmed: true }))
  expect(f.get).toHaveBeenCalledOnce()
  expect(f.current().completionMethod).toBe('manual')
  expect(f.memory.size).toBe(0)
})
it('确认期间切换工作区，旧确认不可核对新来源', async () => {
  const a = fixture('synthetic-a', 'SYN-A')
  const b = fixture('synthetic-b', 'SYN-B')
  await a.workspace.load()
  await b.workspace.load()
  const pending = deferred<boolean>()
  confirm.mockReturnValueOnce(pending.promise)
  const { button, selectedWorkspace } = await showHost(a)
  await start(button)
  selectedWorkspace.value = b.workspace
  await nextTick()
  await screen.findByRole('button', { name: /SYN-B/ })
  pending.resolve(true)
  await flushPromises()
  expect(a.execute).not.toHaveBeenCalled()
  expect(b.execute).not.toHaveBeenCalled()
  expect(a.current().completionMethod).toBe('legacy')
  expect(b.current().completionMethod).toBe('legacy')
})
it('确认期间卸载，旧确认不能提交', async () => {
  const a = fixture('synthetic-a', 'SYN-A')
  const pending = deferred<boolean>()
  confirm.mockReturnValueOnce(pending.promise)
  const { view, button } = await show(a)
  await start(button)
  view.unmount()
  pending.resolve(true)
  await flushPromises()
  expect(a.execute).not.toHaveBeenCalled()
  expect(a.memory.size).toBe(0)
})
it('确认期间切换所选发票，旧确认不能提交', async () => {
  const first = fixture('synthetic-a', 'SYN-A').current()
  const other = { ...first, id: 'other-invoice', fields: { ...first.fields, invoiceNumber: 'SYN-OTHER' } }
  const a = fixture('synthetic-a', 'SYN-A', [other])
  const pending = deferred<boolean>()
  confirm.mockReturnValueOnce(pending.promise)
  const { button } = await show(a)
  await start(button)
  const next = screen.getByRole('button', { name: /SYN-OTHER/ })
  await fireEvent.click(next)
  await waitFor(() => expect(next.getAttribute('aria-pressed')).toBe('true'))
  pending.resolve(true)
  await flushPromises()
  expect(a.execute).not.toHaveBeenCalled()
  expect(a.memory.size).toBe(0)
})
it('确认期间来源失效后恢复，旧确认不能提交', async () => {
  const a = fixture('synthetic-a', 'SYN-A')
  const pending = deferred<boolean>()
  confirm.mockReturnValueOnce(pending.promise)
  const { button } = await show(a)
  await start(button)
  a.list.mockRejectedValueOnce(new Error('合成读取失败'))
  await expect(a.workspace.load()).rejects.toThrow('合成读取失败')
  await a.workspace.load()
  await nextTick()
  pending.resolve(true)
  await flushPromises()
  expect(a.execute).not.toHaveBeenCalled()
  expect(a.memory.size).toBe(0)
})
for (const mode of ['卸载', '切换来源'] as const) {
  it(`session 授权等待期间${mode}，不得保存原编号或提交`, async () => {
    const a = fixture('synthetic-a', 'SYN-A')
    const b = fixture('synthetic-b', 'SYN-B')
    await a.workspace.load()
    await b.workspace.load()
    const confirmation = deferred<boolean>()
    const entered = deferred<void>()
    const release = deferred<void>()
    confirm.mockReturnValueOnce(confirmation.promise)
    const { view, button, selectedWorkspace } = await showHost(a)
    await start(button)
    let calls = 0
    a.setContextHook(async () => {
      if (++calls === 2) {
        entered.resolve()
        await release.promise
      }
    })
    confirmation.resolve(true)
    await entered.promise
    expect(a.execute).not.toHaveBeenCalled()
    expect(a.memory.size).toBe(0)
    if (mode === '卸载') {
      view.unmount()
    }
    else {
      selectedWorkspace.value = b.workspace
      await nextTick()
    }
    release.resolve()
    await flushPromises()
    expect(a.execute).not.toHaveBeenCalled()
    expect(b.execute).not.toHaveBeenCalled()
    expect(a.memory.size).toBe(0)
  })
}
it('取消确认不会提交', async () => {
  const a = fixture('synthetic-a', 'SYN-A')
  confirm.mockResolvedValueOnce(false)
  const { button } = await show(a)
  await start(button)
  await flushPromises()
  expect(a.execute).not.toHaveBeenCalled()
  expect(a.memory.size).toBe(0)
})
it('提交结果未知时只按原编号恢复，不重复核对', async () => {
  const a = fixture('synthetic-a', 'SYN-A')
  a.loseResponse()
  confirm.mockResolvedValueOnce(true)
  const { button } = await show(a)
  await start(button)
  await waitFor(() => expect(a.execute).toHaveBeenCalledOnce())
  const retry = await screen.findByRole('button', { name: '核对上次提交' })
  expect(a.workspace.pending('same-invoice')).toMatchObject({ commandId: 'synthetic-command-synthetic-a', action: 'confirm-legacy' })
  await fireEvent.click(retry)
  await waitFor(() => expect(a.workspace.pending('same-invoice')).toBeNull())
  expect(a.resolve).toHaveBeenCalledWith('synthetic-command-synthetic-a')
  expect(a.execute).toHaveBeenCalledOnce()
  expect(a.current().completionMethod).toBe('manual')
  expect(a.memory.size).toBe(0)
})
it('命令发出后切换来源，迟到错误不污染新界面并保留原编号', async () => {
  const a = fixture('synthetic-a', 'SYN-A')
  const b = fixture('synthetic-b', 'SYN-B')
  await a.workspace.load()
  await b.workspace.load()
  const release = deferred<void>()
  a.execute.mockImplementationOnce(async () => {
    await release.promise
    throw new Error('合成旧来源迟到错误')
  })
  confirm.mockResolvedValueOnce(true)
  const { button, selectedWorkspace } = await showHost(a)
  await start(button)
  await waitFor(() => expect(a.execute).toHaveBeenCalledOnce())
  expect(a.workspace.pending('same-invoice')?.commandId).toBe('synthetic-command-synthetic-a')
  selectedWorkspace.value = b.workspace
  await nextTick()
  await screen.findByRole('button', { name: /SYN-B/ })
  release.resolve()
  await flushPromises()
  expect(screen.queryByText('合成旧来源迟到错误')).toBeNull()
  expect(b.execute).not.toHaveBeenCalled()
  expect(a.workspace.pending('same-invoice')?.commandId).toBe('synthetic-command-synthetic-a')
})
