import type { CentralInvoiceCommand, CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { webcrypto } from 'node:crypto'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import CentralInvoiceWorkspaceScreen from '~/components/invoice/CentralInvoiceWorkspaceScreen.vue'
import { createCentralInvoiceWorkspace } from '~/lib/invoice/central-workspace'

vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: vi.fn(async () => true), undoToast: () => {} }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))
beforeEach(() => vi.stubGlobal('crypto', webcrypto))
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
function fixture(workspaceId: string, recognized = false) {
  const identity = { workspaceId, actorId: 'synthetic-actor' }
  let current: CentralInvoiceRecord = {
    id: `invoice-${workspaceId}`,
    version: '1',
    sourceKind: 'manual',
    fields: { invoiceNumber: `SYN-${workspaceId}`, invoiceDate: '2026-01-01', invoiceType: '', buyer: `购方-${workspaceId}`, buyerTaxNo: '', seller: '合成销方', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: 100, taxRate: '', remark: '' },
    items: [],
    unrecognizedPageIndexes: [],
    ocrStatus: recognized ? 'done' : 'pending',
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
  let afterApply: () => Promise<void> = async () => {}
  let capabilities = ['finance-invoice:read', 'finance-invoice:write']
  let receipt: { invoiceId: string, commandId: string, version: string, updatedAt: string, originalId: null } | undefined
  const execute = vi.fn(async (command: CentralInvoiceCommand) => {
    if (command.action !== 'review' || command.workspaceId !== identity.workspaceId || command.actorId !== identity.actorId || command.invoiceId !== current.id || command.baseVersion !== current.version || command.manualCompletion !== !recognized)
      throw new Error('合成写入拒绝身份、版本或核对方式不一致')
    current = { ...current, reviewStatus: 'reviewed', completionMethod: recognized ? 'ocr' : 'manual', version: '2', updatedAt: '2026-01-02T00:00:00.000Z' }
    receipt = { invoiceId: current.id, commandId: command.commandId, version: current.version, updatedAt: current.updatedAt, originalId: null }
    await afterApply()
    return receipt
  })
  const get = vi.fn(async () => ({ record: structuredClone(current), sourceVersion: 'read-synthetic-2', capabilities: [...capabilities], meta: { sources: [{ key: 'invoices', sourceVersion: 'invoices:2' }] } }))
  const resolve = vi.fn(async (commandId: string) => {
    if (!receipt || receipt.commandId !== commandId)
      throw new Error('合成原编号不存在')
    return { outcome: 'applied' as const, result: receipt }
  })
  const list = vi.fn(async () => {
    const revision = current.version === '2' ? '2' : '1'
    return { items: [structuredClone(current)], pagination: { total: 1 }, sourceVersion: `read-synthetic-${revision}`, capabilities: [...capabilities], meta: { sources: [{ key: 'invoices', sourceVersion: `invoices:${revision}` }] } }
  })
  const workspace = createCentralInvoiceWorkspace({
    identity,
    context: async () => {
      await contextHook()
      return { ...identity, capabilities: [...capabilities] }
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
    memory,
    current: () => current,
    setContextHook: (hook: () => Promise<void>) => { contextHook = hook },
    setAfterApply: (hook: () => Promise<void>) => { afterApply = hook },
    setStorageAvailable: (available: boolean) => { storageAvailable = available },
    setCapabilities: (value: string[]) => { capabilities = [...value] },
  }
}
async function open(a: ReturnType<typeof fixture>) {
  const selectedWorkspace = shallowRef(a.workspace)
  const Host = defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceScreen, { workspace: selectedWorkspace.value, projects: [], suppliers: [], signatories: [], initialSelectedId: a.current().id }) })
  const view = render(Host, { global: { stubs: { NuxtLink: true, InvoiceRegionViewer: true } } })
  await waitFor(() => expect(a.workspace.readState.value).toBe('ready'))
  const name = a.current().ocrStatus === 'done' ? '确认已核对' : '确认人工补全'
  await waitFor(() => expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(false))
  return { view, selectedWorkspace, button: name }
}
for (const mode of ['卸载', '切换来源'] as const) {
  it(`核对的 session 授权等待期间${mode}，不记原编号或发送旧操作`, async () => {
    const a = fixture('synthetic-a')
    const b = fixture('synthetic-b')
    await a.workspace.load()
    await b.workspace.load()
    const { view, selectedWorkspace, button } = await open(a)
    const entered = deferred<void>()
    const release = deferred<void>()
    let calls = 0
    a.setContextHook(async () => {
      if (++calls === 2) {
        entered.resolve()
        await release.promise
      }
    })
    await fireEvent.click(screen.getByRole('button', { name: button }))
    await entered.promise
    expect(a.execute).not.toHaveBeenCalled()
    expect(a.memory.size).toBe(0)
    if (mode === '卸载')
      view.unmount()
    else
      selectedWorkspace.value = b.workspace
    await nextTick()
    release.resolve()
    await flushPromises()
    expect(a.execute).not.toHaveBeenCalled()
    expect(a.memory.size).toBe(0)
    expect(b.execute).not.toHaveBeenCalled()
  })
}
for (const recognized of [false, true]) {
  it(`同源${recognized ? '识别后核对' : '人工补全'}成功后写入一次并回读`, async () => {
    const a = fixture('synthetic-a', recognized)
    await a.workspace.load()
    const { button } = await open(a)
    await fireEvent.click(screen.getByRole('button', { name: button }))
    await waitFor(() => expect(a.execute).toHaveBeenCalledOnce())
    await waitFor(() => expect(a.workspace.pending(a.current().id)).toBeNull())
    expect(a.execute).toHaveBeenCalledWith(expect.objectContaining({ action: 'review', manualCompletion: !recognized, workspaceId: 'synthetic-a', baseVersion: '1' }))
    expect(a.current().reviewStatus).toBe('reviewed')
    expect(a.get).toHaveBeenCalledOnce()
    expect(a.memory.size).toBe(0)
  })
}
it('核对授权等待中同源重读，旧操作不发送并提示未提交', async () => {
  const a = fixture('synthetic-a')
  await a.workspace.load()
  const { button } = await open(a)
  const entered = deferred<void>()
  const release = deferred<void>()
  let calls = 0
  a.setContextHook(async () => {
    if (++calls === 2) {
      entered.resolve()
      await release.promise
    }
  })
  await fireEvent.click(screen.getByRole('button', { name: button }))
  await entered.promise
  await a.workspace.load()
  release.resolve()
  await flushPromises()
  expect(a.execute).not.toHaveBeenCalled()
  expect(a.memory.size).toBe(0)
  expect(screen.getByRole('alert').textContent).toContain('未提交')
})
it('核对授权等待中存储不可读时优先显示存储缺口并阻止操作', async () => {
  const a = fixture('synthetic-a')
  await a.workspace.load()
  const { button } = await open(a)
  const entered = deferred<void>()
  const release = deferred<void>()
  let calls = 0
  a.setContextHook(async () => {
    if (++calls === 2) {
      entered.resolve()
      await release.promise
    }
  })
  await fireEvent.click(screen.getByRole('button', { name: button }))
  await entered.promise
  a.setStorageAvailable(false)
  await a.workspace.load()
  release.resolve()
  await flushPromises()
  expect(screen.getByRole('alert').textContent).toContain('无法可靠核对原提交编号')
  expect((screen.getByRole('button', { name: button }) as HTMLButtonElement).disabled).toBe(true)
  expect(a.execute).not.toHaveBeenCalled()
  expect(a.memory.size).toBe(0)
  a.setStorageAvailable(true)
  await a.workspace.load()
  await waitFor(() => expect((screen.getByRole('button', { name: button }) as HTMLButtonElement).disabled).toBe(false))
})
for (const outcome of ['成功', '失败'] as const) {
  it(`核对已发送后切源，A 迟到${outcome}不污染 B，未知结果保留原编号`, async () => {
    const a = fixture('synthetic-a')
    const b = fixture('synthetic-b')
    await a.workspace.load()
    await b.workspace.load()
    const { selectedWorkspace, button } = await open(a)
    const entered = deferred<void>()
    const release = deferred<void>()
    a.setAfterApply(async () => {
      entered.resolve()
      await release.promise
      if (outcome === '失败')
        throw new Error('合成 A 核对迟到错误')
    })
    await fireEvent.click(screen.getByRole('button', { name: button }))
    await entered.promise
    expect(a.workspace.pending(a.current().id)?.commandId).toBe('synthetic-command-synthetic-a')
    selectedWorkspace.value = b.workspace
    await nextTick()
    release.resolve()
    await flushPromises()
    expect(screen.queryByText('合成 A 核对迟到错误')).toBeNull()
    expect(b.execute).not.toHaveBeenCalled()
    if (outcome === '失败') {
      expect(a.workspace.pending(a.current().id)?.commandId).toBe('synthetic-command-synthetic-a')
      selectedWorkspace.value = a.workspace
      await nextTick()
      await fireEvent.click(await screen.findByRole('button', { name: '核对上次提交' }))
      await waitFor(() => expect(a.workspace.pending(a.current().id)).toBeNull())
      expect(a.resolve).toHaveBeenCalledWith('synthetic-command-synthetic-a')
      expect(a.execute).toHaveBeenCalledOnce()
    }
    else {
      await waitFor(() => expect(a.workspace.pending(a.current().id)).toBeNull())
    }
  })
}
it('核对已发送后失去读取权限，保留原编号并遮蔽旧来源', async () => {
  const a = fixture('synthetic-a')
  await a.workspace.load()
  const { button } = await open(a)
  const entered = deferred<void>()
  const release = deferred<void>()
  a.setAfterApply(async () => {
    entered.resolve()
    await release.promise
  })
  await fireEvent.click(screen.getByRole('button', { name: button }))
  await entered.promise
  expect(a.workspace.pending(a.current().id)?.commandId).toBe('synthetic-command-synthetic-a')
  a.setCapabilities(['finance-invoice:write'])
  release.resolve()
  await waitFor(() => expect(a.workspace.readState.value).toBe('unavailable'))
  expect(a.workspace.records.value).toEqual([])
  expect(a.workspace.pending(a.current().id)?.commandId).toBe('synthetic-command-synthetic-a')
  expect(a.execute).toHaveBeenCalledOnce()
  a.setCapabilities(['finance-invoice:read', 'finance-invoice:write'])
  await a.workspace.load()
  await fireEvent.click(await screen.findByRole('button', { name: '核对上次提交' }))
  await waitFor(() => expect(a.workspace.pending(a.current().id)).toBeNull())
  expect(a.resolve).toHaveBeenCalledWith('synthetic-command-synthetic-a')
  expect(a.execute).toHaveBeenCalledOnce()
})
