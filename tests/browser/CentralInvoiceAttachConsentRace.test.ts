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
const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII='), char => char.charCodeAt(0))
const file = () => new File([bytes], 'synthetic.png', { type: 'image/png' })
async function fixture(workspaceId: string, invoiceNumber: string) {
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
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
    key: (i: number) => [...memory.keys()][i] ?? null,
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => { memory.set(k, v) },
    removeItem: (k: string) => { memory.delete(k) },
  }
  const execute = vi.fn(async (command: CentralInvoiceCommand) => {
    if (command.action !== 'attach-original' || command.workspaceId !== workspaceId || command.actorId !== 'synthetic-actor' || command.invoiceId !== current.id || command.baseVersion !== current.version || !command.confirmed || command.original.contentBase64 !== btoa(String.fromCharCode(...bytes)))
      throw new Error('合成原件 sink 拒绝')
    current = { ...current, version: '2', original: { id: 'synthetic-original', fileName: 'synthetic.png', fileSize: bytes.length, mimeType: 'image/png', sha256: sha } }
    return { invoiceId: current.id, commandId: command.commandId, version: current.version, updatedAt: current.updatedAt, originalId: current.original!.id }
  })
  const get = vi.fn(async () => ({ record: structuredClone(current), sourceVersion: 'invoices:2', meta: { sources: [{ key: 'invoices', sourceVersion: 'invoices:2' }] } }))
  const workspace = createCentralInvoiceWorkspace({
    identity: { workspaceId, actorId: 'synthetic-actor' },
    context: async () => ({ workspaceId, actorId: 'synthetic-actor', capabilities: ['finance-invoice:read', 'finance-invoice:write'] }),
    client: { list: async () => ({ items: [structuredClone(current)], pagination: { total: 1 }, sourceVersion: 'invoices:1', meta: { sources: [{ key: 'invoices', sourceVersion: 'invoices:1' }] } }), execute, get, original: async () => new Blob([bytes], { type: 'image/png' }) } as never,
    recognizeLocal: vi.fn() as never,
    storage: () => storage,
    commandId: () => `synthetic-command-${workspaceId}`,
  })
  await workspace.load()
  return { workspace, execute, get, memory, current: () => current }
}
async function selectOriginal() {
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '原件' }).click()
  const input = page.getByLabelText('关联原件')
  await expect.element(input).toBeEnabled()
  input.element().focus()
  await expect.element(input).toHaveFocus()
  await userEvent.keyboard('{Tab}')
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
  await expect.element(input).toHaveFocus()
  await input.upload(file())
  await expect.poll(() => confirm.mock.calls.length).toBe(1)
}
it('确认期间切换来源，原件不关联旧票或新票', async ({ task }) => {
  const width = /^chromium-(390|768|1024|1280|1440)$/.exec(task.file.projectName ?? '')
  expect(window.innerWidth).toBe(Number(width?.[1]))
  const a = await fixture('synthetic-a', 'SYN-A')
  const b = await fixture('synthetic-b', 'SYN-B')
  const current = shallowRef(a.workspace)
  const confirmation = deferred<boolean>()
  confirm.mockReturnValueOnce(confirmation.promise)
  const Host = defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceScreen, { workspace: current.value, projects: [], suppliers: [], signatories: [], initialSelectedId: 'same-invoice' }) })
  await render(Host, { global: { stubs: { NuxtLink: true } } })
  await selectOriginal()
  current.value = b.workspace
  await nextTick()
  confirmation.resolve(true)
  await expect.element(page.getByRole('alert')).toHaveTextContent('原件关联未提交')
  expect(a.execute).not.toHaveBeenCalled()
  expect(b.execute).not.toHaveBeenCalled()
  expect(a.current().original).toBeNull()
  expect(b.current().original).toBeNull()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})
it('确认期间卸载，迟到确认不关联原件', async () => {
  const a = await fixture('synthetic-a', 'SYN-A')
  const confirmation = deferred<boolean>()
  confirm.mockReturnValueOnce(confirmation.promise)
  const view = await render(CentralInvoiceWorkspaceScreen, { props: { workspace: a.workspace, projects: [], suppliers: [], signatories: [], initialSelectedId: 'same-invoice' }, global: { stubs: { NuxtLink: true } } })
  await selectOriginal()
  view.unmount()
  confirmation.resolve(true)
  await confirmation.promise
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  expect(a.execute).not.toHaveBeenCalled()
  expect(a.memory.size).toBe(0)
})
it('同源确认后关联一次并回读合成原件', async () => {
  const a = await fixture('synthetic-a', 'SYN-A')
  confirm.mockResolvedValueOnce(true)
  await render(CentralInvoiceWorkspaceScreen, { props: { workspace: a.workspace, projects: [], suppliers: [], signatories: [], initialSelectedId: 'same-invoice' }, global: { stubs: { NuxtLink: true } } })
  await selectOriginal()
  await expect.poll(() => a.execute.mock.calls.length).toBe(1)
  await expect.poll(() => a.get.mock.calls.length).toBe(1)
  await expect.poll(() => a.memory.size).toBe(0)
  expect(a.current().original?.fileName).toBe('synthetic.png')
  expect(a.workspace.records.value[0]?.original?.fileSize).toBe(bytes.length)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})
