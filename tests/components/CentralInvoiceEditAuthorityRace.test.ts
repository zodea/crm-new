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
function fixture(workspaceId: string) {
  const identity = { workspaceId, actorId: 'synthetic-actor' }
  let current: CentralInvoiceRecord = {
    id: `invoice-${workspaceId}`,
    version: '1',
    sourceKind: 'manual',
    fields: { invoiceNumber: `SYN-${workspaceId}`, invoiceDate: '', invoiceType: '', buyer: `购方-${workspaceId}`, buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: null, taxRate: '', remark: '' },
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
  let afterApply: () => Promise<void> = async () => {}
  let receipt: { invoiceId: string, commandId: string, version: string, updatedAt: string, originalId: null } | undefined
  const execute = vi.fn(async (command: CentralInvoiceCommand) => {
    if (command.action !== 'edit' || command.workspaceId !== identity.workspaceId || command.actorId !== identity.actorId || command.invoiceId !== current.id || command.baseVersion !== current.version)
      throw new Error('合成写入拒绝身份或版本不一致')
    current = { ...current, fields: command.fields, items: command.items, version: '2', updatedAt: '2026-01-02T00:00:00.000Z' }
    receipt = { invoiceId: current.id, commandId: command.commandId, version: current.version, updatedAt: current.updatedAt, originalId: null }
    await afterApply()
    return receipt
  })
  const get = vi.fn(async () => ({ record: structuredClone(current), sourceVersion: 'read-synthetic-2', capabilities: ['finance-invoice:read', 'finance-invoice:write'], meta: { sources: [{ key: 'invoices', sourceVersion: 'invoices:2' }] } }))
  const resolve = vi.fn(async (commandId: string) => {
    if (!receipt || receipt.commandId !== commandId)
      throw new Error('合成原编号不存在')
    return { outcome: 'applied' as const, result: receipt }
  })
  const list = vi.fn(async () => {
    const revision = current.version === '2' ? '2' : '1'
    return { items: [structuredClone(current)], pagination: { total: 1 }, sourceVersion: `read-synthetic-${revision}`, capabilities: ['finance-invoice:read', 'finance-invoice:write'], meta: { sources: [{ key: 'invoices', sourceVersion: `invoices:${revision}` }] } }
  })
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
    memory,
    current: () => current,
    setContextHook: (hook: () => Promise<void>) => { contextHook = hook },
    setAfterApply: (hook: () => Promise<void>) => { afterApply = hook },
    setStorageAvailable: (available: boolean) => { storageAvailable = available },
  }
}
async function open(a: ReturnType<typeof fixture>) {
  const selectedWorkspace = shallowRef(a.workspace)
  const Host = defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceScreen, { workspace: selectedWorkspace.value, projects: [], suppliers: [], signatories: [], initialSelectedId: a.current().id }) })
  const view = render(Host, { global: { stubs: { NuxtLink: true, InvoiceRegionViewer: true } } })
  await waitFor(() => expect(a.workspace.readState.value).toBe('ready'))
  const buyer = await screen.findByDisplayValue(`购方-${a.current().id.slice('invoice-'.length)}`)
  await fireEvent.update(buyer, '合成未保存购方')
  await waitFor(() => expect((screen.getByRole('button', { name: '保存修改' }) as HTMLButtonElement).disabled).toBe(false))
  return { view, selectedWorkspace }
}
async function save() {
  await fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
}

for (const mode of ['卸载', '切换来源'] as const) {
  it(`普通保存的 session 授权等待期间${mode}，不记录原编号或发送旧操作`, async () => {
    const a = fixture('synthetic-a')
    const b = fixture('synthetic-b')
    await a.workspace.load()
    await b.workspace.load()
    const { view, selectedWorkspace } = await open(a)
    const entered = deferred<void>()
    const release = deferred<void>()
    let calls = 0
    a.setContextHook(async () => {
      if (++calls === 2) {
        entered.resolve()
        await release.promise
      }
    })
    await save()
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
it('同源普通保存成功后只写入一次并回读', async () => {
  const a = fixture('synthetic-a')
  await a.workspace.load()
  await open(a)
  await save()
  await waitFor(() => expect(a.execute).toHaveBeenCalledOnce())
  await waitFor(() => expect(a.workspace.pending(a.current().id)).toBeNull())
  expect(a.current().fields.buyer).toBe('合成未保存购方')
  expect(a.get).toHaveBeenCalledOnce()
  expect(a.memory.size).toBe(0)
})
it('授权等待期间同一来源重读，旧操作不发送且输入保留', async () => {
  const a = fixture('synthetic-a')
  await a.workspace.load()
  await open(a)
  const entered = deferred<void>()
  const release = deferred<void>()
  let calls = 0
  a.setContextHook(async () => {
    if (++calls === 2) {
      entered.resolve()
      await release.promise
    }
  })
  await save()
  await entered.promise
  await a.workspace.load()
  release.resolve()
  await flushPromises()
  expect(a.execute).not.toHaveBeenCalled()
  expect(a.memory.size).toBe(0)
  expect(screen.getByDisplayValue('合成未保存购方')).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toContain('未提交')
})
it('授权等待期间重读且原编号存储不可读时保留存储缺口提示', async () => {
  const a = fixture('synthetic-a')
  await a.workspace.load()
  await open(a)
  const entered = deferred<void>()
  const release = deferred<void>()
  let calls = 0
  a.setContextHook(async () => {
    if (++calls === 2) {
      entered.resolve()
      await release.promise
    }
  })
  await save()
  await entered.promise
  a.setStorageAvailable(false)
  await a.workspace.load()
  release.resolve()
  await flushPromises()
  expect(screen.getByRole('alert').textContent).toContain('无法可靠核对原提交编号')
  expect(screen.getByRole('alert').textContent).toContain('存储')
  expect((screen.getByRole('button', { name: '保存修改' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByDisplayValue('合成未保存购方')).toBeTruthy()
  expect(a.execute).not.toHaveBeenCalled()
  expect(a.memory.size).toBe(0)
  a.setStorageAvailable(true)
  await a.workspace.load()
  await waitFor(() => expect((screen.getByRole('button', { name: '保存修改' }) as HTMLButtonElement).disabled).toBe(false))
})
it('已发送后同源重读，完整等版本详情一致时保留已读版本并完成原编号核对', async () => {
  const a = fixture('synthetic-a')
  await a.workspace.load()
  await open(a)
  const entered = deferred<void>()
  const release = deferred<void>()
  a.setAfterApply(async () => {
    entered.resolve()
    await release.promise
  })
  await save()
  await entered.promise
  expect(a.workspace.pending(a.current().id)?.commandId).toBe('synthetic-command-synthetic-a')
  await a.workspace.load()
  const reread = JSON.parse(JSON.stringify(a.workspace.records.value[0])) as CentralInvoiceRecord
  expect(reread.version).toBe('2')
  expect(reread).toEqual(a.current())
  expect(a.workspace.sourceVersion.value).toBe('read-synthetic-2')
  expect(await screen.findByRole('button', { name: '核对上次提交' })).toBeTruthy()
  release.resolve()
  await waitFor(() => expect(a.workspace.pending(a.current().id)).toBeNull())
  await waitFor(() => expect(screen.queryByRole('button', { name: '核对上次提交' })).toBeNull())
  expect(a.get).toHaveBeenCalledOnce()
  const detail = await a.get.mock.results[0]!.value
  expect(detail.record).toEqual(reread)
  expect(detail.sourceVersion).toBe('read-synthetic-2')
  expect(detail.meta.sources[0]?.sourceVersion).toBe('invoices:2')
  expect(detail.capabilities).toEqual(['finance-invoice:read', 'finance-invoice:write'])
  expect(a.workspace.readState.value).toBe('ready')
  expect(a.workspace.records.value).toEqual([reread])
  expect(a.workspace.sourceVersion.value).toBe('read-synthetic-2')
  expect(a.execute).toHaveBeenCalledOnce()
})
for (const outcome of ['成功', '失败'] as const) {
  it(`已发送后切换来源，A 的迟到${outcome}不污染 B，未知结果保留 A 原编号`, async () => {
    const a = fixture('synthetic-a')
    const b = fixture('synthetic-b')
    await a.workspace.load()
    await b.workspace.load()
    const { selectedWorkspace } = await open(a)
    const entered = deferred<void>()
    const release = deferred<void>()
    a.setAfterApply(async () => {
      entered.resolve()
      await release.promise
      if (outcome === '失败')
        throw new Error('合成 A 迟到错误')
    })
    await save()
    await entered.promise
    expect(a.workspace.pending(a.current().id)?.commandId).toBe('synthetic-command-synthetic-a')
    selectedWorkspace.value = b.workspace
    await nextTick()
    release.resolve()
    await flushPromises()
    expect(screen.queryByText('合成 A 迟到错误')).toBeNull()
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
