import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
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
async function fixture(workspaceId: string) {
  const data = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII='), char => char.charCodeAt(0))
  const digest = await crypto.subtle.digest('SHA-256', data)
  const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  const record: CentralInvoiceRecord = { id: 'same-id', version: '3', sourceKind: 'scan', fields: { invoiceNumber: 'SYN-001', invoiceDate: '', invoiceType: '', buyer: '原购买方', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' }, items: [], unrecognizedPageIndexes: [], ocrStatus: 'done', completionMethod: 'ocr', reviewStatus: 'reviewed', accountStatus: 'none', duplicateStatus: 'normal', printCount: 0, printRotation: 0, ownerKind: null, projectId: null, supplierId: null, contract: null, archivedAt: null, original: { id: 'same-original', fileName: 'synthetic.png', fileSize: data.length, mimeType: 'image/png', sha256 }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
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
    list: vi.fn(async () => ({ items: [structuredClone(record)], pagination: { total: 1 }, sourceVersion: 'invoices:1', meta: { sources: [{ key: 'invoices', sourceVersion: 'invoices:1' }] } })),
    original: vi.fn(async () => new Blob([data], { type: 'image/png' })),
  }
  const workspace = createCentralInvoiceWorkspace({ identity: { workspaceId, actorId: 'actor' }, context: async () => ({ workspaceId, actorId: 'actor', capabilities: ['finance-invoice:read', 'finance-invoice:write'] }), client: client as never, recognizeLocal: vi.fn() as never, recognizeCloud: cloud as never, storage: () => storage })
  await workspace.load()
  return { workspace, cloud, record, data }
}
async function focusCloud() {
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '原件' }).click()
  const button = page.getByRole('button', { name: '云识别' })
  await expect.element(button).toBeEnabled()
  button.element().focus()
  await expect.element(button).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  return button
}

it('来源切换撤销旧确认，键盘焦点与页面布局可用', async ({ task }) => {
  const expected = /^chromium-(390|768|1024|1280|1440)$/.exec(task.file.projectName ?? '')
  expect(window.innerWidth).toBe(Number(expected?.[1]))
  const a = await fixture('synthetic-a')
  const b = await fixture('synthetic-b')
  const current = shallowRef(a.workspace)
  const Host = defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceScreen, { workspace: current.value, projects: [], suppliers: [], signatories: [], cloudAvailable: true, initialSelectedId: a.record.id }) })
  const pending = deferred<boolean>()
  confirm.mockReturnValueOnce(pending.promise)
  await render(Host, { global: { stubs: { NuxtLink: true } } })
  const button = await focusCloud()
  await expect.poll(() => confirm.mock.calls.length).toBe(1)
  current.value = b.workspace
  await nextTick()
  pending.resolve(true)
  await expect.element(page.getByRole('alert')).toHaveTextContent('发票或权限已变化')
  expect(a.cloud).not.toHaveBeenCalled()
  expect(b.cloud).not.toHaveBeenCalled()
  await expect.element(button).toHaveFocus()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})

it('同一来源明确确认后发送合成原件并展示待核对草稿', async () => {
  const a = await fixture('synthetic-a')
  confirm.mockResolvedValueOnce(true)
  await render(CentralInvoiceWorkspaceScreen, { props: { workspace: a.workspace, projects: [], suppliers: [], signatories: [], cloudAvailable: true, initialSelectedId: a.record.id }, global: { stubs: { NuxtLink: true } } })
  await focusCloud()
  await expect.poll(() => a.cloud.mock.calls.length).toBe(1)
  const file = a.cloud.mock.calls[0]![0]
  expect(file.name).toBe('synthetic.png')
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(a.data)
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '校对' }).click()
  await expect.element(page.getByText(/重新识别结果为未保存草稿/)).toBeVisible()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})
