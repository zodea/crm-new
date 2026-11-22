import type { CentralInvoiceCommand, CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { createHash } from 'node:crypto'
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
const originalBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])
const originalSha = createHash('sha256').update(originalBytes).digest('hex')
function syntheticFile(read?: Promise<ArrayBuffer>) {
  const file = new File([originalBytes], 'synthetic.png', { type: 'image/png' })
  const readFile = vi.fn(() => read ?? Promise.resolve(Uint8Array.from(originalBytes).buffer))
  Object.defineProperty(file, 'arrayBuffer', { configurable: true, value: readFile })
  return { file, readFile }
}

function fixture(workspaceId: string, invoiceNumber: string, additional: CentralInvoiceRecord[] = []) {
  const identity = { workspaceId, actorId: 'synthetic-actor' }
  const capabilities = ['finance-invoice:read', 'finance-invoice:write']
  let current: CentralInvoiceRecord = {
    id: 'same-invoice',
    version: '1',
    sourceKind: 'manual',
    fields: { invoiceNumber, invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: null, taxRate: '', remark: '' },
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
  let lostResponse = false
  let receipt: { invoiceId: string, commandId: string, version: string, updatedAt: string, originalId: string } | undefined
  const execute = vi.fn(async (command: CentralInvoiceCommand) => {
    if (command.action !== 'attach-original' || command.workspaceId !== identity.workspaceId || command.actorId !== identity.actorId
      || command.invoiceId !== current.id || command.baseVersion !== current.version || command.confirmed !== true || current.original) {
      throw new Error('合成 sink 拒绝身份、版本或原件状态不一致')
    }
    if (command.original.fileName !== 'synthetic.png' || command.original.mimeType !== 'image/png'
      || command.original.fileSize !== originalBytes.length || command.original.contentBase64 !== btoa(String.fromCharCode(...originalBytes))) {
      throw new Error('合成 sink 拒绝原始字节不一致')
    }
    current = { ...current, version: '2', updatedAt: '2026-01-02T00:00:00.000Z', original: { id: 'synthetic-original', fileName: 'synthetic.png', fileSize: originalBytes.length, mimeType: 'image/png', sha256: originalSha } }
    receipt = { invoiceId: current.id, commandId: command.commandId, version: current.version, updatedAt: current.updatedAt, originalId: 'synthetic-original' }
    if (lostResponse)
      throw new Error('合成响应丢失')
    return receipt
  })
  const get = vi.fn(async () => ({ record: structuredClone(current), sourceVersion: 'invoices:2', capabilities: [...capabilities], meta: { sources: [{ key: 'invoices', sourceVersion: 'invoices:2' }] } }))
  const resolve = vi.fn(async (commandId: string) => {
    if (!receipt || commandId !== receipt.commandId)
      throw new Error('合成原编号不存在')
    return { outcome: 'applied' as const, result: receipt }
  })
  const list = vi.fn(async () => ({ items: structuredClone([current, ...additional]), pagination: { total: 1 + additional.length }, sourceVersion: 'invoices:1', capabilities: [...capabilities], meta: { sources: [{ key: 'invoices', sourceVersion: 'invoices:1' }] } }))
  const workspace = createCentralInvoiceWorkspace({
    identity,
    context: async () => {
      await contextHook()
      return { ...identity, capabilities: [...capabilities] }
    },
    client: { list, execute, get, resolve, original: async () => new Blob([originalBytes], { type: 'image/png' }) } as never,
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
  const input = await screen.findByLabelText('关联原件') as HTMLInputElement
  await waitFor(() => expect(input.disabled).toBe(false))
  return { view, input }
}
async function chooseFile(input: HTMLInputElement, file: File) {
  await fireEvent.change(input, { target: { files: [file] } })
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce())
}

it('确认期间切换同 ID 同版本工作区，不向旧或新来源关联原件', async () => {
  const a = fixture('synthetic-a', 'SYN-A')
  const b = fixture('synthetic-b', 'SYN-B')
  await a.workspace.load()
  await b.workspace.load()
  const selectedWorkspace = shallowRef(a.workspace)
  const Host = defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceScreen, { workspace: selectedWorkspace.value, projects: [], suppliers: [], signatories: [], initialSelectedId: 'same-invoice' }) })
  const confirmation = deferred<boolean>()
  confirm.mockReturnValueOnce(confirmation.promise)
  render(Host, { global: { stubs: { NuxtLink: true, InvoiceRegionViewer: true } } })
  const input = await screen.findByLabelText('关联原件') as HTMLInputElement
  await waitFor(() => expect(input.disabled).toBe(false))
  const file = syntheticFile()
  await chooseFile(input, file.file)
  selectedWorkspace.value = b.workspace
  await nextTick()
  await screen.findByRole('button', { name: /SYN-B/ })
  confirmation.resolve(true)
  await flushPromises()
  expect(a.execute).not.toHaveBeenCalled()
  expect(b.execute).not.toHaveBeenCalled()
  expect(file.readFile).not.toHaveBeenCalled()
  expect(a.memory.size).toBe(0)
  expect(b.memory.size).toBe(0)
  expect(a.current().original).toBeNull()
  expect(b.current().original).toBeNull()
})

it('确认期间卸载，迟到确认不能读取文件、发送或留下原编号', async () => {
  const f = fixture('synthetic-a', 'SYN-A')
  const confirmation = deferred<boolean>()
  confirm.mockReturnValueOnce(confirmation.promise)
  const { view, input } = await show(f)
  const file = syntheticFile()
  await chooseFile(input, file.file)
  view.unmount()
  confirmation.resolve(true)
  await flushPromises()
  expect(file.readFile).not.toHaveBeenCalled()
  expect(f.execute).not.toHaveBeenCalled()
  expect(f.memory.size).toBe(0)
  expect(f.current().original).toBeNull()
})

it('确认期间切换所选发票，不能把原件关联到旧票', async () => {
  const first = fixture('synthetic-a', 'SYN-A').current()
  const other = { ...first, id: 'other-invoice', fields: { ...first.fields, invoiceNumber: 'SYN-OTHER' } }
  const f = fixture('synthetic-a', 'SYN-A', [other])
  const confirmation = deferred<boolean>()
  confirm.mockReturnValueOnce(confirmation.promise)
  const { input } = await show(f)
  const file = syntheticFile()
  await chooseFile(input, file.file)
  const button = screen.getByRole('button', { name: /SYN-OTHER/ })
  await fireEvent.click(button)
  await waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('true'))
  confirmation.resolve(true)
  await flushPromises()
  expect(file.readFile).not.toHaveBeenCalled()
  expect(f.execute).not.toHaveBeenCalled()
  expect(f.memory.size).toBe(0)
})

it('确认期间来源失效再恢复，旧确认不能关联', async () => {
  const f = fixture('synthetic-a', 'SYN-A')
  const confirmation = deferred<boolean>()
  confirm.mockReturnValueOnce(confirmation.promise)
  const { input } = await show(f)
  const file = syntheticFile()
  await chooseFile(input, file.file)
  f.list.mockRejectedValueOnce(new Error('合成读取失败'))
  await expect(f.workspace.load()).rejects.toThrow('合成读取失败')
  await f.workspace.load()
  await nextTick()
  confirmation.resolve(true)
  await flushPromises()
  expect(file.readFile).not.toHaveBeenCalled()
  expect(f.execute).not.toHaveBeenCalled()
  expect(f.memory.size).toBe(0)
})

it('取消确认不读取文件、不发送且不留下原编号', async () => {
  const f = fixture('synthetic-a', 'SYN-A')
  confirm.mockResolvedValueOnce(false)
  const { input } = await show(f)
  const file = syntheticFile()
  await chooseFile(input, file.file)
  await flushPromises()
  expect(file.readFile).not.toHaveBeenCalled()
  expect(f.execute).not.toHaveBeenCalled()
  expect(f.memory.size).toBe(0)
})

it('文件读取期间卸载，完成读取后不得发送或留下原编号', async () => {
  const f = fixture('synthetic-a', 'SYN-A')
  const reading = deferred<ArrayBuffer>()
  confirm.mockResolvedValueOnce(true)
  const { view, input } = await show(f)
  const file = syntheticFile(reading.promise)
  await chooseFile(input, file.file)
  await waitFor(() => expect(file.readFile).toHaveBeenCalledOnce())
  view.unmount()
  reading.resolve(Uint8Array.from(originalBytes).buffer)
  await flushPromises()
  expect(f.execute).not.toHaveBeenCalled()
  expect(f.memory.size).toBe(0)
  expect(f.current().original).toBeNull()
})

it('文件读取期间替换工作区，完成读取后不得向任一来源发送', async () => {
  const a = fixture('synthetic-a', 'SYN-A')
  const b = fixture('synthetic-b', 'SYN-B')
  await a.workspace.load()
  await b.workspace.load()
  const selectedWorkspace = shallowRef(a.workspace)
  const Host = defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceScreen, { workspace: selectedWorkspace.value, projects: [], suppliers: [], signatories: [], initialSelectedId: 'same-invoice' }) })
  const reading = deferred<ArrayBuffer>()
  confirm.mockResolvedValueOnce(true)
  render(Host, { global: { stubs: { NuxtLink: true, InvoiceRegionViewer: true } } })
  const input = await screen.findByLabelText('关联原件') as HTMLInputElement
  await waitFor(() => expect(input.disabled).toBe(false))
  const file = syntheticFile(reading.promise)
  await chooseFile(input, file.file)
  await waitFor(() => expect(file.readFile).toHaveBeenCalledOnce())
  selectedWorkspace.value = b.workspace
  await nextTick()
  reading.resolve(Uint8Array.from(originalBytes).buffer)
  await flushPromises()
  expect(a.execute).not.toHaveBeenCalled()
  expect(b.execute).not.toHaveBeenCalled()
  expect(a.memory.size).toBe(0)
  expect(b.memory.size).toBe(0)
})

it('确认后 session 授权等待期间卸载，不发送也不留下原编号', async () => {
  const f = fixture('synthetic-a', 'SYN-A')
  const confirmation = deferred<boolean>()
  const entered = deferred<void>()
  const release = deferred<void>()
  confirm.mockReturnValueOnce(confirmation.promise)
  const { view, input } = await show(f)
  await chooseFile(input, syntheticFile().file)
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
  expect(f.memory.size).toBe(0)
  expect(f.current().original).toBeNull()
})

it('确认后 session 授权等待期间替换工作区，旧任务不得发送', async () => {
  const a = fixture('synthetic-a', 'SYN-A')
  const b = fixture('synthetic-b', 'SYN-B')
  await a.workspace.load()
  await b.workspace.load()
  const selectedWorkspace = shallowRef(a.workspace)
  const Host = defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceScreen, { workspace: selectedWorkspace.value, projects: [], suppliers: [], signatories: [], initialSelectedId: 'same-invoice' }) })
  const confirmation = deferred<boolean>()
  const entered = deferred<void>()
  const release = deferred<void>()
  confirm.mockReturnValueOnce(confirmation.promise)
  render(Host, { global: { stubs: { NuxtLink: true, InvoiceRegionViewer: true } } })
  const input = await screen.findByLabelText('关联原件') as HTMLInputElement
  await waitFor(() => expect(input.disabled).toBe(false))
  await chooseFile(input, syntheticFile().file)
  let calls = 0
  a.setContextHook(async () => {
    if (++calls === 2) {
      entered.resolve()
      await release.promise
    }
  })
  confirmation.resolve(true)
  await entered.promise
  selectedWorkspace.value = b.workspace
  await nextTick()
  release.resolve()
  await flushPromises()
  expect(a.execute).not.toHaveBeenCalled()
  expect(b.execute).not.toHaveBeenCalled()
  expect(a.memory.size).toBe(0)
  expect(b.memory.size).toBe(0)
  expect(a.current().original).toBeNull()
  expect(b.current().original).toBeNull()
})

it('同源确认后真实 session 只关联一次并回读合成原始字节', async () => {
  const f = fixture('synthetic-a', 'SYN-A')
  confirm.mockResolvedValueOnce(true)
  const { input } = await show(f)
  const file = syntheticFile()
  await chooseFile(input, file.file)
  await waitFor(() => expect(f.execute).toHaveBeenCalledOnce())
  await waitFor(() => expect(f.workspace.pending('same-invoice')).toBeNull())
  expect(file.readFile).toHaveBeenCalledOnce()
  expect(f.execute).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'synthetic-a', actorId: 'synthetic-actor', action: 'attach-original', invoiceId: 'same-invoice', baseVersion: '1', commandId: 'synthetic-command-synthetic-a', confirmed: true, original: { fileName: 'synthetic.png', fileSize: originalBytes.length, mimeType: 'image/png', contentBase64: btoa(String.fromCharCode(...originalBytes)) } }))
  expect(f.get).toHaveBeenCalledOnce()
  expect(f.current().original).toMatchObject({ fileName: 'synthetic.png', fileSize: originalBytes.length, sha256: originalSha })
  expect(f.memory.size).toBe(0)
})

it('提交结果未知时保留原编号，恢复只查原回执并回读，不重复关联', async () => {
  const f = fixture('synthetic-a', 'SYN-A')
  f.loseResponse()
  confirm.mockResolvedValueOnce(true)
  const { input } = await show(f)
  await chooseFile(input, syntheticFile().file)
  await waitFor(() => expect(f.execute).toHaveBeenCalledOnce())
  const recover = await screen.findByRole('button', { name: '核对上次提交' })
  expect(f.workspace.pending('same-invoice')).toMatchObject({ commandId: 'synthetic-command-synthetic-a', action: 'attach-original' })
  expect(f.memory.size).toBe(1)
  await fireEvent.click(recover)
  await waitFor(() => expect(f.workspace.pending('same-invoice')).toBeNull())
  expect(f.resolve).toHaveBeenCalledWith('synthetic-command-synthetic-a')
  expect(f.execute).toHaveBeenCalledOnce()
  expect(f.get).toHaveBeenCalledOnce()
  expect(f.current().original).toMatchObject({ fileName: 'synthetic.png', sha256: originalSha })
  expect(f.memory.size).toBe(0)
})

it('命令发出后切换来源，旧响应失败不污染新来源并保留原编号', async () => {
  const a = fixture('synthetic-a', 'SYN-A')
  const b = fixture('synthetic-b', 'SYN-B')
  await a.workspace.load()
  await b.workspace.load()
  const selectedWorkspace = shallowRef(a.workspace)
  const Host = defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceScreen, { workspace: selectedWorkspace.value, projects: [], suppliers: [], signatories: [], initialSelectedId: 'same-invoice' }) })
  const release = deferred<void>()
  a.execute.mockImplementationOnce(async () => {
    await release.promise
    throw new Error('合成旧来源迟到错误')
  })
  confirm.mockResolvedValueOnce(true)
  render(Host, { global: { stubs: { NuxtLink: true, InvoiceRegionViewer: true } } })
  const input = await screen.findByLabelText('关联原件') as HTMLInputElement
  await waitFor(() => expect(input.disabled).toBe(false))
  await chooseFile(input, syntheticFile().file)
  await waitFor(() => expect(a.execute).toHaveBeenCalledOnce())
  expect(a.workspace.pending('same-invoice')?.commandId).toBe('synthetic-command-synthetic-a')
  selectedWorkspace.value = b.workspace
  await nextTick()
  await screen.findByRole('button', { name: /SYN-B/ })
  release.resolve()
  await flushPromises()
  expect(screen.queryByText('合成旧来源迟到错误')).toBeNull()
  expect(b.execute).not.toHaveBeenCalled()
  expect(b.memory.size).toBe(0)
  expect(a.workspace.pending('same-invoice')?.commandId).toBe('synthetic-command-synthetic-a')
})
