import type { CentralInvoiceCommand, CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { computed, defineComponent, h, shallowRef, useTemplateRef, watch } from 'vue'
import CentralInvoiceWorkspaceScreen from '~/components/invoice/CentralInvoiceWorkspaceScreen.vue'
import ConfirmDialog from '~/components/shared/ConfirmDialog.vue'
import KitUIHost from '~/components/shared/KitUIHost.vue'
import Button from '~/components/ui/button/Button.vue'
import Dialog from '~/components/ui/dialog/Dialog.vue'
import DialogContent from '~/components/ui/dialog/DialogContent.vue'
import DialogDescription from '~/components/ui/dialog/DialogDescription.vue'
import DialogTitle from '~/components/ui/dialog/DialogTitle.vue'
import { confirm as realConfirm, useKitUIHostState } from '~/composables/useKitUI'
import { createCentralInvoiceWorkspace } from '~/lib/invoice/central-workspace'

vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/composables/useKitUI')>()
  return { ...actual, useKitUI: () => ({ confirm: actual.confirm, undoToast: () => {} }) }
})
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))
beforeEach(() => {
  vi.stubGlobal('useKitUIHostState', useKitUIHostState)
  for (const [name, value] of Object.entries({ computed, shallowRef, useTemplateRef, watch }))
    vi.stubGlobal(name, value)
  vi.stubGlobal('useEventListener', vi.fn())
})
afterEach(() => {
  useKitUIHostState().resolveConfirm(false)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
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
function host(a: Awaited<ReturnType<typeof fixture>>) {
  return defineComponent({
    setup: () => () => h('div', [
      h(CentralInvoiceWorkspaceScreen, { workspace: a.workspace, projects: [], suppliers: [], signatories: [], initialSelectedId: 'same-invoice' }),
      h(KitUIHost),
    ]),
  })
}
const global = {
  components: { Button, ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogTitle },
  stubs: { NuxtLink: true, InvoiceRegionViewer: true, ToastHost: true, KitFormModal: true, KitTypeSelectDialog: true },
}
it('真实确认宿主以 Escape 取消并恢复焦点，重读后的旧确认不丢草稿', async ({ task }) => {
  const width = /^chromium-(390|768|1024|1280|1440)$/.exec(task.file.projectName ?? '')
  expect(window.innerWidth).toBe(Number(width?.[1]))
  const a = await fixture('synthetic-a', 'SYN-A')
  await render(host(a), { global })
  await createDraft()
  const trigger = page.getByRole('button', { name: '放弃识别草稿' })
  trigger.element().focus()
  await expect.element(trigger).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  const dialog = page.getByRole('dialog', { name: '放弃未保存的发票修改' })
  await expect.element(dialog).toBeVisible()
  await expect.element(page.getByRole('button', { name: '取消' })).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  await expect.element(page.getByText(/重新识别结果为未保存草稿/)).toBeVisible()
  await userEvent.keyboard('{Enter}')
  await expect.element(dialog).toBeVisible()
  await a.workspace.load()
  await page.getByRole('button', { name: '放弃修改' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(page.getByText(/重新识别结果为未保存草稿/)).toBeVisible()
  expect(a.execute).not.toHaveBeenCalled()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})
it('真实单宿主收到第二次确认时取消第一次，第二次取消不丢草稿', async () => {
  const a = await fixture('synthetic-a', 'SYN-A')
  await render(host(a), { global })
  await createDraft()
  await page.getByRole('button', { name: '放弃识别草稿' }).click()
  await expect.element(page.getByRole('dialog', { name: '放弃未保存的发票修改' })).toBeVisible()
  const second = realConfirm({ title: '第二次确认', message: '合成测试' })
  await expect.element(page.getByRole('dialog', { name: '第二次确认' })).toBeVisible()
  await page.getByRole('button', { name: '取消' }).click()
  expect(await second).toBe(false)
  await expect.element(page.getByText(/重新识别结果为未保存草稿/)).toBeVisible()
  expect(a.execute).not.toHaveBeenCalled()
})
