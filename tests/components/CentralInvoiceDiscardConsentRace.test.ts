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

function fixture(workspaceId = 'synthetic-workspace', additional: CentralInvoiceRecord[] = []) {
  const identity = { workspaceId, actorId: 'synthetic-actor' }
  let current: CentralInvoiceRecord = {
    id: 'synthetic-invoice',
    version: '1',
    sourceKind: 'manual',
    fields: { invoiceNumber: 'SYN-001', invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: null, taxRate: '', remark: '' },
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
  const storage = {
    get length() { return memory.size },
    key: (index: number) => [...memory.keys()][index] ?? null,
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value) },
    removeItem: (key: string) => { memory.delete(key) },
  }
  let contextHook: () => Promise<void> = async () => {}
  const context = vi.fn(async () => {
    await contextHook()
    return { ...identity, capabilities: ['finance-invoice:read', 'finance-invoice:write'] }
  })
  const execute = vi.fn(async (command: CentralInvoiceCommand) => {
    if (command.action !== 'discard' || command.invoiceId !== current.id || command.baseVersion !== current.version)
      throw new Error('合成 sink 拒绝身份或版本不一致')
    current = { ...current, deletedAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', version: '2' }
    return { invoiceId: current.id, commandId: command.commandId, version: current.version, updatedAt: current.updatedAt, originalId: null }
  })
  const get = vi.fn(async () => ({ record: structuredClone(current), sourceVersion: 'invoices:2', meta: { sources: [{ key: 'invoices', sourceVersion: 'invoices:2' }] } }))
  const list = vi.fn(async () => ({ items: structuredClone([current, ...additional]), pagination: { total: 1 + additional.length }, sourceVersion: 'invoices:1', meta: { sources: [{ key: 'invoices', sourceVersion: 'invoices:1' }] } }))
  const workspace = createCentralInvoiceWorkspace({ identity, context, client: { list, execute, get } as never, recognizeLocal: vi.fn() as never, storage: () => storage, commandId: () => 'synthetic-command-001' })
  return {
    workspace,
    execute,
    get,
    list,
    memory,
    current: () => current,
    setContextHook: (hook: () => Promise<void>) => {
      contextHook = hook
    },
  }
}

async function show(f: ReturnType<typeof fixture>) {
  await f.workspace.load()
  const view = render(CentralInvoiceWorkspaceScreen, { props: { workspace: f.workspace, projects: [], suppliers: [], signatories: [], initialSelectedId: 'synthetic-invoice' }, global: { stubs: { NuxtLink: true } } })
  const button = await screen.findByRole('button', { name: '废弃发票' })
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  return { view, button }
}

it('废弃确认期间页面卸载，迟到确认不能调用真实 session 的合成写入', async () => {
  const f = fixture()
  const confirmation = deferred<boolean>()
  confirm.mockReturnValueOnce(confirmation.promise)
  const { view, button } = await show(f)
  await fireEvent.click(button)
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce())
  view.unmount()
  confirmation.resolve(true)
  await flushPromises()
  expect(f.execute).not.toHaveBeenCalled()
  expect(f.current().deletedAt).toBeNull()
  expect(f.memory.size).toBe(0)
})

it('同源确认后通过真实 session 恰好废弃一次并可靠回读', async () => {
  const f = fixture()
  confirm.mockResolvedValueOnce(true)
  const { button } = await show(f)
  await fireEvent.click(button)
  await waitFor(() => expect(f.execute).toHaveBeenCalledOnce())
  await waitFor(() => expect(f.workspace.pending('synthetic-invoice')).toBeNull())
  expect(f.execute).toHaveBeenCalledWith(expect.objectContaining({ ...{ workspaceId: 'synthetic-workspace', actorId: 'synthetic-actor' }, action: 'discard', invoiceId: 'synthetic-invoice', baseVersion: '1', commandId: 'synthetic-command-001' }))
  expect(f.current().deletedAt).toBe('2026-01-02T00:00:00.000Z')
  expect(f.get).toHaveBeenCalledOnce()
  expect(f.workspace.records.value).toHaveLength(0)
  expect(f.memory.size).toBe(0)
})

it('确认后 session 授权期间卸载，不能写入或保留伪造原编号', async () => {
  const f = fixture()
  const confirmation = deferred<boolean>()
  const entered = deferred<void>()
  const release = deferred<void>()
  confirm.mockReturnValueOnce(confirmation.promise)
  const { view, button } = await show(f)
  await fireEvent.click(button)
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce())
  let calls = 0
  f.setContextHook(async () => {
    if (++calls === 2) {
      entered.resolve()
      await release.promise
    }
  })
  confirmation.resolve(true)
  await entered.promise
  expect(f.execute).not.toHaveBeenCalled()
  expect(f.memory.size).toBe(0)
  view.unmount()
  release.resolve()
  await flushPromises()
  expect(f.execute).not.toHaveBeenCalled()
  expect(f.current().deletedAt).toBeNull()
  expect(f.memory.size).toBe(0)
})

it('废弃提交守卫失败使用通用提示且不创建原编号', async () => {
  const f = fixture()
  await f.workspace.load()
  await expect(f.workspace.discard(f.current(), () => false)).rejects.toThrow('操作未提交')
  expect(f.execute).not.toHaveBeenCalled()
  expect(f.current().deletedAt).toBeNull()
  expect(f.memory.size).toBe(0)
})

it('取消废弃确认不会发送命令或留下原编号', async () => {
  const f = fixture()
  confirm.mockResolvedValueOnce(false)
  const { button } = await show(f)
  await fireEvent.click(button)
  await flushPromises()
  expect(confirm).toHaveBeenCalledOnce()
  expect(f.execute).not.toHaveBeenCalled()
  expect(f.current().deletedAt).toBeNull()
  expect(f.memory.size).toBe(0)
})

it('确认期间切换所选发票，不能废弃旧票', async () => {
  const prototype = fixture().current()
  const other = { ...prototype, id: 'synthetic-other', fields: { ...prototype.fields, invoiceNumber: 'SYN-002' } }
  const f = fixture('synthetic-workspace', [other])
  const confirmation = deferred<boolean>()
  confirm.mockReturnValueOnce(confirmation.promise)
  const { button } = await show(f)
  await fireEvent.click(button)
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce())
  const otherButton = screen.getByRole('button', { name: /SYN-002/ })
  await fireEvent.click(otherButton)
  await waitFor(() => expect(otherButton.getAttribute('aria-pressed')).toBe('true'))
  confirmation.resolve(true)
  await flushPromises()
  expect(f.execute).not.toHaveBeenCalled()
  expect(f.current().deletedAt).toBeNull()
  expect(f.memory.size).toBe(0)
})

it('确认期间切换同票号同版本的工作区，不能向新来源提交废弃', async () => {
  const a = fixture('synthetic-a')
  const b = fixture('synthetic-b')
  await a.workspace.load()
  await b.workspace.load()
  const selectedWorkspace = shallowRef(a.workspace)
  const Host = defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceScreen, { workspace: selectedWorkspace.value, projects: [], suppliers: [], signatories: [], initialSelectedId: 'synthetic-invoice' }) })
  const confirmation = deferred<boolean>()
  confirm.mockReturnValueOnce(confirmation.promise)
  render(Host, { global: { stubs: { NuxtLink: true } } })
  const button = await screen.findByRole('button', { name: '废弃发票' })
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  await fireEvent.click(button)
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce())
  selectedWorkspace.value = b.workspace
  await nextTick()
  confirmation.resolve(true)
  await flushPromises()
  expect(a.execute).not.toHaveBeenCalled()
  expect(b.execute).not.toHaveBeenCalled()
  expect(a.memory.size).toBe(0)
  expect(b.memory.size).toBe(0)
})

it('确认期间来源失效又恢复，旧确认不能继续提交废弃', async () => {
  const f = fixture()
  const confirmation = deferred<boolean>()
  confirm.mockReturnValueOnce(confirmation.promise)
  const { button } = await show(f)
  await fireEvent.click(button)
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce())
  f.list.mockRejectedValueOnce(new Error('合成读取失败'))
  await expect(f.workspace.load()).rejects.toThrow('合成读取失败')
  await f.workspace.load()
  await nextTick()
  confirmation.resolve(true)
  await flushPromises()
  expect(f.execute).not.toHaveBeenCalled()
  expect(f.current().deletedAt).toBeNull()
  expect(f.memory.size).toBe(0)
})
