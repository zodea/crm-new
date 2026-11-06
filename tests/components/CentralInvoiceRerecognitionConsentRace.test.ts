import type { CentralInvoiceCommand, CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { createHash, webcrypto } from 'node:crypto'
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
beforeEach(() => {
  confirm.mockReset()
  vi.stubGlobal('crypto', webcrypto)
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
const originalBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])
const originalSha = createHash('sha256').update(originalBytes).digest('hex')
function fixture(workspaceId: string, invoiceNumber: string, additional: CentralInvoiceRecord[] = []) {
  const identity = { workspaceId, actorId: 'synthetic-actor' }
  let current: CentralInvoiceRecord = {
    id: 'same-invoice',
    version: '1',
    sourceKind: 'scan',
    fields: { invoiceNumber, invoiceDate: '', invoiceType: '', buyer: `购方-${workspaceId}`, buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: null, taxRate: '', remark: '' },
    items: [],
    unrecognizedPageIndexes: [],
    ocrStatus: 'done',
    completionMethod: 'ocr',
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
    original: { id: 'same-original', fileName: 'synthetic.png', fileSize: originalBytes.length, mimeType: 'image/png', sha256: originalSha },
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
  let sinkHook: () => Promise<void> = async () => {}
  let receipt: { invoiceId: string, commandId: string, version: string, updatedAt: string, originalId: string } | undefined
  const execute = vi.fn(async (command: CentralInvoiceCommand) => {
    if (command.action !== 'rerecognize' || command.workspaceId !== identity.workspaceId || command.actorId !== identity.actorId
      || command.invoiceId !== current.id || command.baseVersion !== current.version || command.confirmed !== true) {
      throw new Error('合成 sink 拒绝身份或版本不一致')
    }
    await sinkHook()
    current = { ...current, fields: command.currentFields, items: command.currentItems, version: '2', reviewStatus: 'unreviewed', updatedAt: '2026-01-02T00:00:00.000Z' }
    receipt = { invoiceId: current.id, commandId: command.commandId, version: current.version, updatedAt: current.updatedAt, originalId: 'same-original' }
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
  const blob = new Blob([originalBytes], { type: 'image/png' })
  Object.defineProperty(blob, 'arrayBuffer', { value: async () => Uint8Array.from(originalBytes).buffer })
  const candidate = { source: 'local' as const, fields: { ...current.fields, buyer: `识别购方-${workspaceId}`, items: [], projectHint: '', balanced: false }, textPages: ['合成'], unrecognizedPageIndexes: [], requiresReview: true as const }
  const workspace = createCentralInvoiceWorkspace({
    identity,
    context: async () => {
      await contextHook()
      return { ...identity, capabilities: ['finance-invoice:read', 'finance-invoice:write'] }
    },
    client: { list, execute, get, resolve, original: async () => blob } as never,
    recognizeLocal: vi.fn(async () => candidate) as never,
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
    setSinkHook: (hook: () => Promise<void>) => { sinkHook = hook },
  }
}

async function open(a: ReturnType<typeof fixture>) {
  const selectedWorkspace = shallowRef(a.workspace)
  const Host = defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceScreen, { workspace: selectedWorkspace.value, projects: [], suppliers: [], signatories: [], initialSelectedId: 'same-invoice' }) })
  const view = render(Host, { global: { stubs: { NuxtLink: true, InvoiceRegionViewer: true } } })
  const recognize = await screen.findByRole('button', { name: '本机重新识别' }) as HTMLButtonElement
  await waitFor(() => expect(recognize.disabled).toBe(false))
  await fireEvent.click(recognize)
  await screen.findByText(/重新识别结果为未保存草稿/)
  return { view, selectedWorkspace }
}
async function save() {
  await fireEvent.click(screen.getByRole('button', { name: '保存识别草稿' }))
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce())
}
it('切换发票的确认期间来源重新读取，迟到确认不清除识别草稿或切换发票', async () => {
  const second = { ...fixture('other', 'SYN-B').current(), id: 'second-invoice' }
  const a = fixture('synthetic-a', 'SYN-A', [second])
  await a.workspace.load()
  await open(a)
  const pending = deferred<boolean>()
  confirm.mockReturnValueOnce(pending.promise)
  await fireEvent.click(screen.getByRole('button', { name: /SYN-B/ }))
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce())
  await a.workspace.load()
  pending.resolve(true)
  await flushPromises()
  expect(screen.getByText(/重新识别结果为未保存草稿/)).toBeTruthy()
  expect(screen.getByDisplayValue('识别购方-synthetic-a')).toBeTruthy()
  expect(a.execute).not.toHaveBeenCalled()
})
it('放弃草稿的确认期间来源重新读取，迟到确认不放弃识别结果', async () => {
  const a = fixture('synthetic-a', 'SYN-A')
  await a.workspace.load()
  await open(a)
  const pending = deferred<boolean>()
  confirm.mockReturnValueOnce(pending.promise)
  await fireEvent.click(screen.getByRole('button', { name: '放弃识别草稿' }))
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce())
  await a.workspace.load()
  pending.resolve(true)
  await flushPromises()
  expect(screen.getByText(/重新识别结果为未保存草稿/)).toBeTruthy()
  expect(screen.getByDisplayValue('识别购方-synthetic-a')).toBeTruthy()
  expect(a.execute).not.toHaveBeenCalled()
  confirm.mockResolvedValueOnce(true)
  await fireEvent.click(screen.getByRole('button', { name: '放弃识别草稿' }))
  await waitFor(() => expect(screen.queryByText(/重新识别结果为未保存草稿/)).toBeNull())
  expect(screen.getByDisplayValue('购方-synthetic-a')).toBeTruthy()
})
it('确认期间切换来源再切回，旧确认不能放弃原草稿', async () => {
  const a = fixture('synthetic-a', 'SYN-A')
  const b = fixture('synthetic-b', 'SYN-B')
  await a.workspace.load()
  await b.workspace.load()
  const { selectedWorkspace } = await open(a)
  const pending = deferred<boolean>()
  confirm.mockReturnValueOnce(pending.promise)
  await fireEvent.click(screen.getByRole('button', { name: '放弃识别草稿' }))
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce())
  selectedWorkspace.value = b.workspace
  await nextTick()
  selectedWorkspace.value = a.workspace
  await nextTick()
  pending.resolve(true)
  await flushPromises()
  expect(screen.getByText(/重新识别结果为未保存草稿/)).toBeTruthy()
  expect(screen.getByDisplayValue('识别购方-synthetic-a')).toBeTruthy()
  expect(a.execute).not.toHaveBeenCalled()
  expect(b.execute).not.toHaveBeenCalled()
})
it('确认期间表单再次变化，旧确认不能切换发票或清除新输入', async () => {
  const second = { ...fixture('other', 'SYN-B').current(), id: 'second-invoice' }
  const a = fixture('synthetic-a', 'SYN-A', [second])
  await a.workspace.load()
  await open(a)
  const pending = deferred<boolean>()
  confirm.mockReturnValueOnce(pending.promise)
  await fireEvent.click(screen.getByRole('button', { name: /SYN-B/ }))
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce())
  await fireEvent.update(screen.getByLabelText(/^购买方\s/), '确认期间的新输入')
  pending.resolve(true)
  await flushPromises()
  expect(screen.getByText(/重新识别结果为未保存草稿/)).toBeTruthy()
  expect(screen.getByDisplayValue('确认期间的新输入')).toBeTruthy()
  expect(a.execute).not.toHaveBeenCalled()
})
it('同源确认后提交一次并回读草稿', async () => {
  const a = fixture('synthetic-a', 'SYN-A')
  await a.workspace.load()
  await open(a)
  confirm.mockResolvedValueOnce(true)
  await save()
  await waitFor(() => expect(a.execute).toHaveBeenCalledOnce())
  await waitFor(() => expect(a.workspace.pending('same-invoice')).toBeNull())
  expect(a.execute).toHaveBeenCalledWith(expect.objectContaining({ action: 'rerecognize', workspaceId: 'synthetic-a', invoiceId: 'same-invoice', baseVersion: '1', confirmed: true }))
  expect(a.current().fields.buyer).toBe('识别购方-synthetic-a')
  expect(a.get).toHaveBeenCalledOnce()
  expect(a.memory.size).toBe(0)
})
it('确认期间换来源，同身份版本原件的 B 不接收 A 草稿', async () => {
  const a = fixture('synthetic-a', 'SYN-A')
  const b = fixture('synthetic-b', 'SYN-B')
  await a.workspace.load()
  await b.workspace.load()
  const { selectedWorkspace } = await open(a)
  const pending = deferred<boolean>()
  confirm.mockReturnValueOnce(pending.promise)
  await save()
  selectedWorkspace.value = b.workspace
  await nextTick()
  pending.resolve(true)
  await flushPromises()
  expect(a.execute).not.toHaveBeenCalled()
  expect(b.execute).not.toHaveBeenCalled()
})
it('先切换来源再点保存时，A 草稿不能被绑定为 B 草稿', async () => {
  const a = fixture('synthetic-a', 'SYN-A')
  const b = fixture('synthetic-b', 'SYN-B')
  await a.workspace.load()
  await b.workspace.load()
  const { selectedWorkspace } = await open(a)
  selectedWorkspace.value = b.workspace
  await nextTick()
  await screen.findByRole('button', { name: /SYN-B/ })
  confirm.mockResolvedValueOnce(true)
  await fireEvent.click(screen.getByRole('button', { name: '保存识别草稿' }))
  await flushPromises()
  expect(a.execute).not.toHaveBeenCalled()
  expect(b.execute).not.toHaveBeenCalled()
})
it('确认期间卸载，迟到确认不能提交', async () => {
  const a = fixture('synthetic-a', 'SYN-A')
  await a.workspace.load()
  const { view } = await open(a)
  const pending = deferred<boolean>()
  confirm.mockReturnValueOnce(pending.promise)
  await save()
  view.unmount()
  pending.resolve(true)
  await flushPromises()
  expect(a.execute).not.toHaveBeenCalled()
  expect(a.memory.size).toBe(0)
})
for (const mode of ['卸载', '切换来源'] as const) {
  it(`session 授权等待期间${mode}，不保存原编号或提交`, async () => {
    const a = fixture('synthetic-a', 'SYN-A')
    const b = fixture('synthetic-b', 'SYN-B')
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
    confirm.mockResolvedValueOnce(true)
    await save()
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
it('取消保存保留草稿并不提交', async () => {
  const a = fixture('synthetic-a', 'SYN-A')
  await a.workspace.load()
  await open(a)
  confirm.mockResolvedValueOnce(false)
  await save()
  expect(screen.getByText(/重新识别结果为未保存草稿/)).toBeTruthy()
  expect(a.execute).not.toHaveBeenCalled()
  expect(a.memory.size).toBe(0)
})
it('结果未知按原编号恢复且不重复提交', async () => {
  const a = fixture('synthetic-a', 'SYN-A')
  a.loseResponse()
  await a.workspace.load()
  await open(a)
  confirm.mockResolvedValueOnce(true)
  await save()
  const retry = await screen.findByRole('button', { name: '核对上次提交' })
  expect(a.workspace.pending('same-invoice')).toMatchObject({ commandId: 'synthetic-command-synthetic-a', action: 'rerecognize' })
  await fireEvent.click(retry)
  await waitFor(() => expect(a.workspace.pending('same-invoice')).toBeNull())
  expect(a.resolve).toHaveBeenCalledWith('synthetic-command-synthetic-a')
  expect(a.execute).toHaveBeenCalledOnce()
  expect(a.memory.size).toBe(0)
})
for (const outcome of ['成功', '失败'] as const) {
  it(`已提交后换来源，迟到${outcome}不污染 B 页并保护 A 原编号`, async () => {
    const a = fixture('synthetic-a', 'SYN-A')
    const b = fixture('synthetic-b', 'SYN-B')
    await a.workspace.load()
    await b.workspace.load()
    const { selectedWorkspace } = await open(a)
    const entered = deferred<void>()
    const release = deferred<void>()
    a.setSinkHook(async () => {
      entered.resolve()
      await release.promise
      if (outcome === '失败')
        throw new Error('合成 A 迟到错误')
    })
    confirm.mockResolvedValueOnce(true)
    await save()
    await entered.promise
    expect(a.workspace.pending('same-invoice')?.commandId).toBe('synthetic-command-synthetic-a')
    selectedWorkspace.value = b.workspace
    await nextTick()
    release.resolve()
    await flushPromises()
    expect(screen.queryByText('合成 A 迟到错误')).toBeNull()
    expect(b.execute).not.toHaveBeenCalled()
    if (outcome === '失败')
      expect(a.workspace.pending('same-invoice')?.commandId).toBe('synthetic-command-synthetic-a')
    else await waitFor(() => expect(a.workspace.pending('same-invoice')).toBeNull())
    selectedWorkspace.value = a.workspace
    await nextTick()
    expect(screen.getByText(/重新识别结果为未保存草稿/)).toBeTruthy()
  })
}
for (const outcome of ['成功', '失败'] as const) {
  it(`A 页面卸载后 B 已有新草稿，A 迟到${outcome}不清除 B 草稿`, async () => {
    const a = fixture('synthetic-a', 'SYN-A')
    const b = fixture('synthetic-b', 'SYN-B')
    await a.workspace.load()
    await b.workspace.load()
    const { view } = await open(a)
    const entered = deferred<void>()
    const release = deferred<void>()
    a.setSinkHook(async () => {
      entered.resolve()
      await release.promise
      if (outcome === '失败')
        throw new Error('合成 A 迟到错误')
    })
    confirm.mockResolvedValueOnce(true)
    await save()
    await entered.promise
    expect(a.workspace.pending('same-invoice')?.commandId).toBe('synthetic-command-synthetic-a')
    view.unmount()
    await open(b)
    expect(screen.getByDisplayValue('识别购方-synthetic-b')).toBeTruthy()
    release.resolve()
    await flushPromises()
    expect(screen.getByDisplayValue('识别购方-synthetic-b')).toBeTruthy()
    expect(screen.getByText(/重新识别结果为未保存草稿/)).toBeTruthy()
    expect(screen.queryByText('合成 A 迟到错误')).toBeNull()
    expect(b.execute).not.toHaveBeenCalled()
    if (outcome === '失败')
      expect(a.workspace.pending('same-invoice')?.commandId).toBe('synthetic-command-synthetic-a')
    else await waitFor(() => expect(a.workspace.pending('same-invoice')).toBeNull())
  })
}
