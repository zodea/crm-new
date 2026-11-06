import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { Blob, File } from 'node:buffer'
import { createHash } from 'node:crypto'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, shallowRef, useTemplateRef, watch } from 'vue'
import CentralInvoiceWorkspaceScreen from '~/components/invoice/CentralInvoiceWorkspaceScreen.vue'
import { createCentralInvoiceSession } from '~/lib/invoice/central-session'
import { createCentralInvoiceWorkspace } from '~/lib/invoice/central-workspace'

const consent = vi.hoisted(() => vi.fn<() => Promise<boolean>>())
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: consent, undoToast: () => {} }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))

beforeEach(() => {
  consent.mockReset()
  for (const [name, value] of Object.entries({ computed, shallowRef, useTemplateRef, watch, File }))
    vi.stubGlobal(name, value)
  // 真正计算 SHA-256，但避免原生 WebCrypto 工作线程在 flushPromises 后才完成。
  vi.stubGlobal('crypto', { subtle: { digest: async (_algorithm: string, data: ArrayBuffer) => Uint8Array.from(createHash('sha256').update(new Uint8Array(data)).digest()).buffer } })
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
const bytes = 'synthetic-image'
const record: CentralInvoiceRecord = {
  id: 'same-id',
  version: '3',
  sourceKind: 'scan',
  fields: { invoiceNumber: 'SYN-001', invoiceDate: '', invoiceType: '', buyer: '原购买方', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' },
  items: [],
  unrecognizedPageIndexes: [],
  ocrStatus: 'done',
  completionMethod: 'ocr',
  reviewStatus: 'reviewed',
  accountStatus: 'none',
  duplicateStatus: 'normal',
  printCount: 0,
  printRotation: 0,
  ownerKind: null,
  projectId: null,
  supplierId: null,
  contract: null,
  archivedAt: null,
  original: { id: 'same-original', fileName: 'synthetic.png', fileSize: bytes.length, mimeType: 'image/png', sha256: createHash('sha256').update(bytes).digest('hex') },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
}
function fixture(workspaceId: string, invoice = record, additional: CentralInvoiceRecord[] = []) {
  let capabilities = ['finance-invoice:read', 'finance-invoice:write']
  const memory = new Map<string, string>()
  const storage = {
    get length() { return memory.size },
    key: (index: number) => [...memory.keys()][index] ?? null,
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value) },
    removeItem: (key: string) => { memory.delete(key) },
  }
  const candidate = { source: 'cloud' as const, fields: { ...record.fields, buyer: '云识别购方', items: [], projectHint: '', balanced: false }, textPages: ['synthetic'], unrecognizedPageIndexes: [], requiresReview: true as const }
  const cloud = vi.fn(async (_file: File) => candidate)
  const client = {
    list: vi.fn(async () => ({ items: structuredClone([invoice, ...additional]), pagination: { total: 1 + additional.length }, sourceVersion: 'invoices:1', meta: { sources: [{ key: 'invoices', sourceVersion: 'invoices:1' }] } })),
    original: vi.fn(async () => new Blob([bytes], { type: 'image/png' })),
    execute: vi.fn(),
  }
  const workspace = createCentralInvoiceWorkspace({
    identity: { workspaceId, actorId: 'actor' },
    context: async () => ({ workspaceId, actorId: 'actor', capabilities }),
    client: client as never,
    recognizeLocal: vi.fn() as never,
    recognizeCloud: cloud as never,
    storage: () => storage,
  })
  return {
    workspace,
    client,
    cloud,
    candidate,
    setCapabilities: (value: string[]) => {
      capabilities = value
    },
  }
}

it('云确认期间切换到同票号同版本的另一工作区，不得发送新来源原件', async () => {
  const a = fixture('synthetic-a')
  const b = fixture('synthetic-b')
  await a.workspace.load()
  await b.workspace.load()
  const current = shallowRef(a.workspace)
  const Host = defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceScreen, { workspace: current.value, projects: [], suppliers: [], signatories: [], cloudAvailable: true, initialSelectedId: record.id }) })
  const confirmation = deferred<boolean>()
  consent.mockReturnValueOnce(confirmation.promise)
  render(Host, { global: { stubs: { InvoiceRegionViewer: true, NuxtLink: true } } })
  const button = await screen.findByRole('button', { name: '云识别' })
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  await fireEvent.click(button)
  await waitFor(() => expect(consent).toHaveBeenCalledOnce())
  current.value = b.workspace
  await nextTick()
  confirmation.resolve(true)
  await flushPromises()
  expect(a.cloud).not.toHaveBeenCalled()
  expect(b.cloud).not.toHaveBeenCalled()
  expect(screen.queryByText(/重新识别结果为未保存草稿/)).toBeNull()
})

it('云确认期间页面卸载，迟到确认不得发送原件', async () => {
  const a = fixture('synthetic-a', { ...record, ocrStatus: 'pending', completionMethod: null })
  await a.workspace.load()
  const confirmation = deferred<boolean>()
  consent.mockReturnValueOnce(confirmation.promise)
  const mounted = render(CentralInvoiceWorkspaceScreen, { props: { workspace: a.workspace, projects: [], suppliers: [], signatories: [], cloudAvailable: true, initialSelectedId: record.id }, global: { stubs: { InvoiceRegionViewer: true, NuxtLink: true } } })
  const button = await screen.findByRole('button', { name: '云识别' })
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  await fireEvent.click(button)
  await waitFor(() => expect(consent).toHaveBeenCalledOnce())
  mounted.unmount()
  confirmation.resolve(true)
  await flushPromises()
  expect(a.cloud).not.toHaveBeenCalled()
})

it('确认后回读原件期间切换工作区，旧原件尚未发送时不得发往云端', async () => {
  const a = fixture('synthetic-a')
  const b = fixture('synthetic-b')
  await a.workspace.load()
  await b.workspace.load()
  const current = shallowRef(a.workspace)
  const Host = defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceScreen, { workspace: current.value, projects: [], suppliers: [], signatories: [], cloudAvailable: true, initialSelectedId: record.id }) })
  consent.mockResolvedValueOnce(true)
  render(Host, { global: { stubs: { InvoiceRegionViewer: true, NuxtLink: true } } })
  const button = await screen.findByRole('button', { name: '云识别' })
  await waitFor(() => expect(a.client.original).toHaveBeenCalledOnce())
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  const original = deferred<Blob>()
  a.client.original.mockImplementationOnce(() => original.promise)
  await fireEvent.click(button)
  await waitFor(() => expect(a.client.original).toHaveBeenCalledTimes(2))
  current.value = b.workspace
  await nextTick()
  original.resolve(new Blob([bytes], { type: 'image/png' }))
  await flushPromises()
  expect(a.cloud).not.toHaveBeenCalled()
  expect(b.cloud).not.toHaveBeenCalled()
})

it('确认期间来源失效又恢复，旧确认不得继续发送', async () => {
  const a = fixture('synthetic-a')
  await a.workspace.load()
  const confirmation = deferred<boolean>()
  consent.mockReturnValueOnce(confirmation.promise)
  render(CentralInvoiceWorkspaceScreen, { props: { workspace: a.workspace, projects: [], suppliers: [], signatories: [], cloudAvailable: true, initialSelectedId: record.id }, global: { stubs: { InvoiceRegionViewer: true, NuxtLink: true } } })
  const button = await screen.findByRole('button', { name: '云识别' })
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  await fireEvent.click(button)
  await waitFor(() => expect(consent).toHaveBeenCalledOnce())
  a.client.list.mockRejectedValueOnce(new Error('合成读取失败'))
  await expect(a.workspace.load()).rejects.toThrow('合成读取失败')
  await a.workspace.load()
  await nextTick()
  confirmation.resolve(true)
  await flushPromises()
  expect(a.cloud).not.toHaveBeenCalled()
})

it('同一来源明确确认后只发送一次并生成待核对草稿', async () => {
  const a = fixture('synthetic-a')
  await a.workspace.load()
  consent.mockResolvedValueOnce(true)
  render(CentralInvoiceWorkspaceScreen, { props: { workspace: a.workspace, projects: [], suppliers: [], signatories: [], cloudAvailable: true, initialSelectedId: record.id }, global: { stubs: { InvoiceRegionViewer: true, NuxtLink: true } } })
  const button = await screen.findByRole('button', { name: '云识别' })
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  await fireEvent.click(button)
  await waitFor(() => expect(a.cloud).toHaveBeenCalledOnce())
  expect(await screen.findByText(/重新识别结果为未保存草稿/)).toBeTruthy()
})

it('确认期间切换所选发票，旧确认不发送任何原件', async () => {
  const second = { ...record, id: 'other-id', fields: { ...record.fields, invoiceNumber: 'SYN-002' } }
  const a = fixture('synthetic-a', record, [second])
  await a.workspace.load()
  const confirmation = deferred<boolean>()
  consent.mockReturnValueOnce(confirmation.promise)
  render(CentralInvoiceWorkspaceScreen, { props: { workspace: a.workspace, projects: [], suppliers: [], signatories: [], cloudAvailable: true, initialSelectedId: record.id }, global: { stubs: { InvoiceRegionViewer: true, NuxtLink: true } } })
  const button = await screen.findByRole('button', { name: '云识别' })
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  await fireEvent.click(button)
  await waitFor(() => expect(consent).toHaveBeenCalledOnce())
  await fireEvent.click(screen.getByRole('button', { name: /SYN-002/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: /SYN-002/ }).getAttribute('aria-pressed')).toBe('true'))
  confirmation.resolve(true)
  await flushPromises()
  expect(a.cloud).not.toHaveBeenCalled()
})

it('确认后原件摘要不匹配时仍由真实 workspace 阻止云发送', async () => {
  const a = fixture('synthetic-a')
  await a.workspace.load()
  consent.mockResolvedValueOnce(true)
  render(CentralInvoiceWorkspaceScreen, { props: { workspace: a.workspace, projects: [], suppliers: [], signatories: [], cloudAvailable: true, initialSelectedId: record.id }, global: { stubs: { InvoiceRegionViewer: true, NuxtLink: true } } })
  const button = await screen.findByRole('button', { name: '云识别' })
  await waitFor(() => expect(a.client.original).toHaveBeenCalledOnce())
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  a.client.original.mockResolvedValueOnce(new Blob(['wrong-image----'], { type: 'image/png' }))
  await fireEvent.click(button)
  await screen.findByText(/发票原件已变化/)
  expect(a.cloud).not.toHaveBeenCalled()
})

it('确认后回读原件时写权限撤销，仍由真实 workspace 阻止云发送', async () => {
  const a = fixture('synthetic-a')
  await a.workspace.load()
  consent.mockResolvedValueOnce(true)
  render(CentralInvoiceWorkspaceScreen, { props: { workspace: a.workspace, projects: [], suppliers: [], signatories: [], cloudAvailable: true, initialSelectedId: record.id }, global: { stubs: { InvoiceRegionViewer: true, NuxtLink: true } } })
  const button = await screen.findByRole('button', { name: '云识别' })
  await waitFor(() => expect(a.client.original).toHaveBeenCalledOnce())
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  const original = deferred<Blob>()
  a.client.original.mockImplementationOnce(() => original.promise)
  await fireEvent.click(button)
  await waitFor(() => expect(a.client.original).toHaveBeenCalledTimes(2))
  a.setCapabilities(['finance-invoice:read'])
  original.resolve(new Blob([bytes], { type: 'image/png' }))
  await waitFor(() => expect(a.workspace.readState.value).toBe('unavailable'))
  expect(a.cloud).not.toHaveBeenCalled()
})

it('首次云识别已发送后切换来源，迟到结果不得写入旧工作区', async () => {
  const a = fixture('synthetic-a', { ...record, ocrStatus: 'pending', completionMethod: null })
  const b = fixture('synthetic-b', { ...record, ocrStatus: 'pending', completionMethod: null })
  await a.workspace.load()
  await b.workspace.load()
  const current = shallowRef(a.workspace)
  const Host = defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceScreen, { workspace: current.value, projects: [], suppliers: [], signatories: [], cloudAvailable: true, initialSelectedId: record.id }) })
  const result = deferred<typeof a.candidate>()
  a.cloud.mockImplementationOnce(() => result.promise)
  consent.mockResolvedValueOnce(true)
  render(Host, { global: { stubs: { InvoiceRegionViewer: true, NuxtLink: true } } })
  const button = await screen.findByRole('button', { name: '云识别' })
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  await fireEvent.click(button)
  await waitFor(() => expect(a.cloud).toHaveBeenCalledOnce())
  current.value = b.workspace
  await nextTick()
  result.resolve(a.candidate)
  await flushPromises()
  expect(a.client.execute).not.toHaveBeenCalled()
  expect(b.client.execute).not.toHaveBeenCalled()
  expect(a.workspace.pending(record.id)).toBeNull()
})

it('首次识别提交权限核对期间来源切换，真实 session 不留编号且不发送写入', async () => {
  const context = deferred<{ workspaceId: string, actorId: string, capabilities: string[] }>()
  const contextRead = vi.fn(() => context.promise)
  const memory = new Map<string, string>()
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value)
    },
    removeItem: (key: string) => {
      memory.delete(key)
    },
  }
  const execute = vi.fn()
  const session = createCentralInvoiceSession({ identity: { workspaceId: 'synthetic-a', actorId: 'actor' }, targetId: record.id, context: contextRead, repository: { execute } as never, storage: () => storage })
  let current = true
  const command = { workspaceId: 'synthetic-a', actorId: 'actor', commandId: 'synthetic-command', action: 'recognize', invoiceId: record.id } as never
  const pending = session.submit(command, () => current)
  await waitFor(() => expect(contextRead).toHaveBeenCalledOnce())
  current = false
  context.resolve({ workspaceId: 'synthetic-a', actorId: 'actor', capabilities: ['finance-invoice:read', 'finance-invoice:write'] })
  await expect(pending).rejects.toThrow('识别结果未提交')
  expect(execute).not.toHaveBeenCalled()
  expect(memory.size).toBe(0)
})
