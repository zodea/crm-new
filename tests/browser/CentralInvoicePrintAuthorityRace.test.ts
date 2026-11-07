import type { CentralInvoicePrintCommand, CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { computed, defineComponent, h, nextTick, shallowRef, useTemplateRef, watch } from 'vue'
import CentralInvoiceLedgerScreen from '~/components/invoice/CentralInvoiceLedgerScreen.vue'
import { createCentralInvoiceWorkspace } from '~/lib/invoice/central-workspace'

vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true, undoToast: () => {}, exportFile: vi.fn() }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))
beforeEach(() => {
  for (const [name, value] of Object.entries({ computed, shallowRef, useTemplateRef, watch }))
    vi.stubGlobal(name, value)
  vi.stubGlobal('useEventListener', vi.fn())
  vi.spyOn(window, 'print').mockImplementation(() => window.dispatchEvent(new Event('afterprint')))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function fixture(workspaceId: string) {
  const identity = { workspaceId, actorId: 'synthetic-actor' }
  const capabilities = ['finance-invoice:read', 'finance-invoice:write']
  let current: CentralInvoiceRecord = {
    id: 'invoice-one',
    version: '3',
    sourceKind: 'scan',
    fields: { invoiceNumber: 'SYN-001', invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '合成销售方', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' },
    items: [],
    unrecognizedPageIndexes: [],
    ocrStatus: 'done',
    completionMethod: 'ocr',
    reviewStatus: 'reviewed',
    accountStatus: 'archived',
    duplicateStatus: 'normal',
    printCount: 0,
    printRotation: 0,
    ownerKind: 'personal',
    projectId: null,
    supplierId: null,
    contract: null,
    archivedAt: '2026-01-01T00:00:00.000Z',
    original: { id: 'original-one', fileName: '合成.pdf', fileSize: 3, mimeType: 'application/pdf', sha256: 'a'.repeat(64) },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  }
  let revision = 1
  let contextHook: () => Promise<void> = async () => {}
  let receiptHook: () => Promise<void> = async () => {}
  const memory = new Map<string, string>()
  const storage = () => ({
    get length() { return memory.size },
    key: (index: number) => [...memory.keys()][index] ?? null,
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value) },
    removeItem: (key: string) => { memory.delete(key) },
  })
  const list = async () => ({ items: [structuredClone(current)], pagination: { total: 1 }, sourceVersion: `read-synthetic-${revision}`, capabilities: [...capabilities], meta: { sources: [{ key: 'invoices', sourceVersion: `invoices:${revision}` }] } })
  const get = async () => ({ record: structuredClone(current), sourceVersion: `read-synthetic-${revision}`, capabilities: [...capabilities], meta: { sources: [{ key: 'invoices', sourceVersion: `invoices:${revision}` }] } })
  const recordPrinted = vi.fn(async (command: CentralInvoicePrintCommand) => {
    if (command.workspaceId !== identity.workspaceId || command.actorId !== identity.actorId || command.targets[0]?.invoiceId !== current.id || command.targets[0]?.baseVersion !== current.version)
      throw new Error('合成登记拒绝身份或版本不符')
    revision++
    current = { ...current, version: '4', printCount: 1 }
    await receiptHook()
    return { commandId: command.commandId, updatedAt: current.updatedAt, records: [{ invoiceId: current.id, version: current.version, printCount: 1, printRotation: 0 }] }
  })
  const workspace = createCentralInvoiceWorkspace({
    identity,
    client: { list, get, recordPrinted } as never,
    context: async () => {
      await contextHook()
      return { ...identity, capabilities: [...capabilities] }
    },
    storage,
    commandId: () => `synthetic-${workspaceId}`,
    recognizeLocal: vi.fn() as never,
  })
  vi.spyOn(workspace, 'verifiedOriginal').mockResolvedValue(new Blob(['synthetic']))
  return {
    workspace,
    recordPrinted,
    memory,
    setContextHook: (hook: () => Promise<void>) => { contextHook = hook },
    setReceiptHook: (hook: () => Promise<void>) => { receiptHook = hook },
  }
}
async function prepare() {
  await page.getByLabelText('选择发票 SYN-001').click()
  const open = page.getByRole('button', { name: '打印所选' })
  open.element().focus()
  await userEvent.keyboard('{Enter}')
  await page.getByRole('button', { name: /打印选中/ }).click()
  const confirmed = page.getByRole('button', { name: '已打印' })
  await expect.element(confirmed).toBeVisible()
  confirmed.element().focus()
  await expect.element(confirmed).toHaveFocus()
}

it('键盘确认后授权等待期间切源，旧工作区不发送登记', async ({ task }) => {
  const width = /^chromium-(390|1280)$/.exec(task.file.projectName ?? '')
  expect(window.innerWidth).toBe(Number(width?.[1]))
  const a = fixture('workspace-a')
  const b = fixture('workspace-b')
  await a.workspace.load()
  await b.workspace.load()
  const selected = shallowRef(a.workspace)
  const Host = defineComponent({ setup: () => () => h(CentralInvoiceLedgerScreen, { workspace: selected.value, projects: [] }) })
  await render(Host, { global: { stubs: { NuxtLink: true, InvoicePreviewSvg: true } } })
  await prepare()
  const entered = deferred()
  const gate = deferred()
  const operation = vi.spyOn(a.workspace, 'recordPrinted')
  a.setContextHook(async () => {
    entered.resolve()
    await gate.promise
  })
  await userEvent.keyboard('{Enter}')
  await entered.promise
  selected.value = b.workspace
  await nextTick()
  gate.resolve()
  await expect(operation.mock.results[0]!.value).rejects.toThrow('打印记录未提交')
  expect(a.recordPrinted).not.toHaveBeenCalled()
  expect(b.recordPrinted).not.toHaveBeenCalled()
  expect(a.memory.size).toBe(0)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})

it('键盘确认同源授权成功后只登记一次', async () => {
  const a = fixture('workspace-a')
  await a.workspace.load()
  await render(CentralInvoiceLedgerScreen, { props: { workspace: a.workspace, projects: [] }, global: { stubs: { NuxtLink: true, InvoicePreviewSvg: true } } })
  await prepare()
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => a.recordPrinted.mock.calls.length).toBe(1)
  await expect.poll(() => a.memory.size).toBe(0)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})

it('键盘确认已发送后切源，旧成功回执不能清除原编号', async () => {
  const a = fixture('workspace-a')
  const b = fixture('workspace-b')
  await a.workspace.load()
  await b.workspace.load()
  const selected = shallowRef(a.workspace)
  const Host = defineComponent({ setup: () => () => h(CentralInvoiceLedgerScreen, { workspace: selected.value, projects: [] }) })
  await render(Host, { global: { stubs: { NuxtLink: true, InvoicePreviewSvg: true } } })
  await prepare()
  const entered = deferred()
  const gate = deferred()
  const operation = vi.spyOn(a.workspace, 'recordPrinted')
  a.setReceiptHook(async () => {
    entered.resolve()
    await gate.promise
  })
  await userEvent.keyboard('{Enter}')
  await entered.promise
  expect(a.workspace.pendingPrint()?.commandId).toBe('synthetic-workspace-a')
  selected.value = b.workspace
  await nextTick()
  gate.resolve()
  await expect(operation.mock.results[0]!.value).rejects.toThrow('打印登记已发送，原编号仍保留，请回原来源核对。')
  expect(a.workspace.pendingPrint()?.commandId).toBe('synthetic-workspace-a')
  expect(a.recordPrinted).toHaveBeenCalledOnce()
  expect(b.recordPrinted).not.toHaveBeenCalled()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})
