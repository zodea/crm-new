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
async function fixture(workspaceId: string, invoiceNumber: string, additional: CentralInvoiceRecord[] = []) {
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
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
    original: { id: 'same-original', fileName: 'synthetic.png', fileSize: bytes.length, mimeType: 'image/png', sha256: sha },
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
    if (command.action !== 'rerecognize' || command.workspaceId !== workspaceId || command.actorId !== 'synthetic-actor' || command.invoiceId !== current.id || command.baseVersion !== current.version || !command.confirmed)
      throw new Error('合成重识别 sink 拒绝')
    current = { ...current, fields: command.currentFields, items: command.currentItems, version: '2', reviewStatus: 'unreviewed' }
    return { invoiceId: current.id, commandId: command.commandId, version: current.version, updatedAt: current.updatedAt, originalId: 'same-original' }
  })
  const get = vi.fn(async () => ({ record: structuredClone(current), sourceVersion: 'invoices:2', meta: { sources: [{ key: 'invoices', sourceVersion: 'invoices:2' }] } }))
  const candidate = { source: 'local' as const, fields: { ...current.fields, buyer: `识别购方-${workspaceId}`, items: [], projectHint: '', balanced: false }, textPages: ['合成'], unrecognizedPageIndexes: [], requiresReview: true as const }
  const workspace = createCentralInvoiceWorkspace({
    identity: { workspaceId, actorId: 'synthetic-actor' },
    context: async () => ({ workspaceId, actorId: 'synthetic-actor', capabilities: ['finance-invoice:read', 'finance-invoice:write'] }),
    client: { list: async () => ({ items: structuredClone([current, ...additional]), pagination: { total: 1 + additional.length }, sourceVersion: 'invoices:1', meta: { sources: [{ key: 'invoices', sourceVersion: 'invoices:1' }] } }), execute, get, original: async () => new Blob([bytes], { type: 'image/png' }) } as never,
    recognizeLocal: vi.fn(async () => candidate) as never,
    storage: () => storage,
    commandId: () => `synthetic-command-${workspaceId}`,
  })
  await workspace.load()
  return { workspace, execute, get, memory, current: () => current }
}
async function createDraft() {
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '原件' }).click()
  const button = page.getByRole('button', { name: '本机重新识别' })
  await expect.element(button).toBeEnabled()
  button.element().focus()
  await expect.element(button).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '校对' }).click()
  await expect.element(page.getByText(/重新识别结果为未保存草稿/)).toBeVisible()
}
async function saveDraft() {
  const button = page.getByRole('button', { name: '保存识别草稿' })
  await expect.element(button).toBeEnabled()
  button.element().focus()
  await expect.element(button).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  return button
}
it('键盘取消、来源重读后的迟到确认和正常放弃草稿', async ({ task }) => {
  const width = /^chromium-(390|768|1024|1280|1440)$/.exec(task.file.projectName ?? '')
  expect(window.innerWidth).toBe(Number(width?.[1]))
  const a = await fixture('synthetic-a', 'SYN-A')
  await render(CentralInvoiceWorkspaceScreen, { props: { workspace: a.workspace, projects: [], suppliers: [], signatories: [], initialSelectedId: 'same-invoice' }, global: { stubs: { NuxtLink: true, InvoiceRegionViewer: true } } })
  await createDraft()
  const discard = page.getByRole('button', { name: '放弃识别草稿' })
  confirm.mockResolvedValueOnce(false)
  discard.element().focus()
  await expect.element(discard).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText(/重新识别结果为未保存草稿/)).toBeVisible()
  const pending = deferred<boolean>()
  confirm.mockReturnValueOnce(pending.promise)
  discard.element().focus()
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => confirm.mock.calls.length).toBe(2)
  await a.workspace.load()
  pending.resolve(true)
  await pending.promise
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  await expect.element(page.getByText(/重新识别结果为未保存草稿/)).toBeVisible()
  expect(a.execute).not.toHaveBeenCalled()
  confirm.mockResolvedValueOnce(true)
  discard.element().focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText(/重新识别结果为未保存草稿/)).not.toBeInTheDocument()
  await expect.element(page.getByLabelText('购买方', { exact: true })).toHaveValue('购方-synthetic-a')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})
it('键盘确认切票前来源重读不清草稿，重新确认后正常切票', async ({ task }) => {
  const width = /^chromium-(390|768|1024|1280|1440)$/.exec(task.file.projectName ?? '')
  expect(window.innerWidth).toBe(Number(width?.[1]))
  const second = { ...(await fixture('other', 'SYN-B')).current(), id: 'second-invoice' }
  const a = await fixture('synthetic-a', 'SYN-A', [second])
  await render(CentralInvoiceWorkspaceScreen, { props: { workspace: a.workspace, projects: [], suppliers: [], signatories: [], initialSelectedId: 'same-invoice' }, global: { stubs: { NuxtLink: true, InvoiceRegionViewer: true } } })
  await createDraft()
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '队列' }).click()
  const next = page.getByRole('button', { name: /SYN-B/ })
  const pending = deferred<boolean>()
  confirm.mockReturnValueOnce(pending.promise)
  next.element().focus()
  await expect.element(next).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => confirm.mock.calls.length).toBe(1)
  await a.workspace.load()
  pending.resolve(true)
  await pending.promise
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '校对' }).click()
  await expect.element(page.getByText(/重新识别结果为未保存草稿/)).toBeVisible()
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '队列' }).click()
  confirm.mockResolvedValueOnce(true)
  next.element().focus()
  await userEvent.keyboard('{Enter}')
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '校对' }).click()
  await expect.element(page.getByLabelText('购买方', { exact: true })).toHaveValue('购方-other')
  expect(a.execute).not.toHaveBeenCalled()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})
it('草稿生成后切换来源再保存，不向任何来源提交', async ({ task }) => {
  const width = /^chromium-(390|768|1024|1280|1440)$/.exec(task.file.projectName ?? '')
  expect(window.innerWidth).toBe(Number(width?.[1]))
  const a = await fixture('synthetic-a', 'SYN-A')
  const b = await fixture('synthetic-b', 'SYN-B')
  const current = shallowRef(a.workspace)
  const Host = defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceScreen, { workspace: current.value, projects: [], suppliers: [], signatories: [], initialSelectedId: 'same-invoice' }) })
  await render(Host, { global: { stubs: { NuxtLink: true, InvoiceRegionViewer: true } } })
  await createDraft()
  current.value = b.workspace
  await nextTick()
  await saveDraft()
  await expect.element(page.getByRole('alert')).toHaveTextContent('发票来源已变化，识别草稿未提交')
  expect(confirm).not.toHaveBeenCalled()
  expect(a.execute).not.toHaveBeenCalled()
  expect(b.execute).not.toHaveBeenCalled()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})
it('确认期间切换来源，迟到确认不提交', async () => {
  const a = await fixture('synthetic-a', 'SYN-A')
  const b = await fixture('synthetic-b', 'SYN-B')
  const current = shallowRef(a.workspace)
  const confirmation = deferred<boolean>()
  confirm.mockReturnValueOnce(confirmation.promise)
  const Host = defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceScreen, { workspace: current.value, projects: [], suppliers: [], signatories: [], initialSelectedId: 'same-invoice' }) })
  await render(Host, { global: { stubs: { NuxtLink: true, InvoiceRegionViewer: true } } })
  await createDraft()
  await saveDraft()
  await expect.poll(() => confirm.mock.calls.length).toBe(1)
  current.value = b.workspace
  await nextTick()
  confirmation.resolve(true)
  await confirmation.promise
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  expect(a.execute).not.toHaveBeenCalled()
  expect(b.execute).not.toHaveBeenCalled()
  expect(a.memory.size).toBe(0)
  expect(b.memory.size).toBe(0)
})
it('确认期间页面卸载，迟到确认不提交', async () => {
  const a = await fixture('synthetic-a', 'SYN-A')
  const confirmation = deferred<boolean>()
  confirm.mockReturnValueOnce(confirmation.promise)
  const view = await render(CentralInvoiceWorkspaceScreen, { props: { workspace: a.workspace, projects: [], suppliers: [], signatories: [], initialSelectedId: 'same-invoice' }, global: { stubs: { NuxtLink: true, InvoiceRegionViewer: true } } })
  await createDraft()
  await saveDraft()
  await expect.poll(() => confirm.mock.calls.length).toBe(1)
  view.unmount()
  confirmation.resolve(true)
  await confirmation.promise
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  expect(a.execute).not.toHaveBeenCalled()
  expect(a.memory.size).toBe(0)
})
it('同源键盘确认后恰好提交一次并回读', async () => {
  const a = await fixture('synthetic-a', 'SYN-A')
  confirm.mockResolvedValueOnce(true)
  await render(CentralInvoiceWorkspaceScreen, { props: { workspace: a.workspace, projects: [], suppliers: [], signatories: [], initialSelectedId: 'same-invoice' }, global: { stubs: { NuxtLink: true, InvoiceRegionViewer: true } } })
  await createDraft()
  await saveDraft()
  await expect.poll(() => a.execute.mock.calls.length).toBe(1)
  await expect.poll(() => a.get.mock.calls.length).toBe(1)
  await expect.poll(() => a.memory.size).toBe(0)
  expect(a.current().fields.buyer).toBe('识别购方-synthetic-a')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})
