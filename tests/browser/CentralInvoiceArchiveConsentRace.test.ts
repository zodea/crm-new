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
const projects = [{ id: 'synthetic-project', label: '合成项目' }]
const suppliers = [{ id: 'synthetic-supplier', label: '合成销方', version: '1' }]
const signatories = [{ id: 'synthetic-buyer', label: '合成购方', version: '1' }]

function fixture(workspaceId: string, invoiceNumber: string, amount: number, additional: CentralInvoiceRecord[] = []) {
  const identity = { workspaceId, actorId: 'synthetic-actor' }
  let current: CentralInvoiceRecord = {
    id: 'same-invoice',
    version: '1',
    sourceKind: 'manual',
    fields: { invoiceNumber, invoiceDate: '2026-01-01', invoiceType: '', buyer: '合成购方', buyerTaxNo: 'BUYER', seller: '合成销方', sellerTaxNo: 'SELLER', amount: null, taxAmount: null, totalAmount: amount, taxRate: '', remark: '' },
    items: [],
    unrecognizedPageIndexes: [],
    ocrStatus: 'pending',
    completionMethod: 'manual',
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
  // 合成 sink 只核验本测试所需的身份与引用，不代表服务端完整业务校验。
  const execute = vi.fn(async (command: CentralInvoiceCommand) => {
    if (command.action !== 'archive' || command.workspaceId !== workspaceId || command.invoiceId !== current.id || command.baseVersion !== current.version
      || command.ownerKind !== 'project' || command.projectId !== 'synthetic-project' || command.supplierId !== 'synthetic-supplier'
      || command.taxNumbersConfirmed !== true || command.taxVerification?.buyerId !== 'synthetic-buyer') {
      throw new Error('合成 sink 拒绝身份、版本或来源不一致')
    }
    current = { ...current, accountStatus: 'archived', ownerKind: 'project', projectId: command.projectId, supplierId: command.supplierId, archivedAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', version: '2' }
    return { invoiceId: current.id, commandId: command.commandId, version: current.version, updatedAt: current.updatedAt, originalId: null }
  })
  const get = vi.fn(async () => ({ record: structuredClone(current), sourceVersion: 'invoices:2', meta: { sources: [{ key: 'invoices', sourceVersion: 'invoices:2' }] } }))
  const list = vi.fn(async () => ({ items: structuredClone([current, ...additional]), pagination: { total: 1 + additional.length }, sourceVersion: 'invoices:1', meta: { sources: [{ key: 'invoices', sourceVersion: 'invoices:1' }] } }))
  let contextHook: () => Promise<void> = async () => {}
  const workspace = createCentralInvoiceWorkspace({
    identity,
    context: async () => {
      await contextHook()
      return { ...identity, capabilities: ['finance-invoice:read', 'finance-invoice:write'] }
    },
    client: { list, execute, get } as never,
    recognizeLocal: vi.fn() as never,
    storage: () => storage,
    commandId: () => `synthetic-command-${workspaceId}`,
  })
  return {
    workspace,
    execute,
    get,
    list,
    memory,
    current: () => current,
    setContextHook: (hook: () => Promise<void>) => {
      contextHook = hook
    },
  }
}

async function focusArchive() {
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '校对' }).click()
  await page.getByLabelText('归属类型').selectOptions('project')
  const project = page.getByRole('region', { name: '发票归属' }).getByRole('combobox').nth(1)
  await expect.element(project).toBeVisible()
  expect(project.element().closest('label')?.textContent).toContain('项目')
  await project.selectOptions('synthetic-project')
  await page.getByLabelText('我方购买公司').selectOptions('synthetic-buyer')
  await page.getByLabelText('分供方公司').selectOptions('synthetic-supplier')
  const button = page.getByRole('button', { name: '归档发票' })
  await expect.element(button).toBeEnabled()
  button.element().focus()
  await expect.element(button).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  return button
}

it('键盘确认期间切来源，旧确认不归档新来源', async ({ task }) => {
  const width = /^chromium-(390|768|1024|1280|1440)$/.exec(task.file.projectName ?? '')
  expect(window.innerWidth).toBe(Number(width?.[1]))
  const a = fixture('synthetic-a', 'SYN-A', 100)
  const b = fixture('synthetic-b', 'SYN-B', 200)
  await a.workspace.load()
  await b.workspace.load()
  const selectedWorkspace = shallowRef(a.workspace)
  const Host = defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceScreen, { workspace: selectedWorkspace.value, projects, suppliers, signatories, initialSelectedId: 'same-invoice' }) })
  const confirmation = deferred<boolean>()
  confirm.mockReturnValueOnce(confirmation.promise)
  await render(Host, { global: { stubs: { NuxtLink: true } } })
  const button = await focusArchive()
  await expect.poll(() => confirm.mock.calls.length).toBe(1)
  selectedWorkspace.value = b.workspace
  await nextTick()
  confirmation.resolve(true)
  await expect.element(page.getByRole('alert')).toHaveTextContent('归档操作未提交')
  expect(a.execute).not.toHaveBeenCalled()
  expect(b.execute).not.toHaveBeenCalled()
  expect(a.current().accountStatus).toBe('none')
  expect(b.current().accountStatus).toBe('none')
  await expect.element(button).toHaveFocus()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})

it('键盘归档确认期间页面卸载，迟到确认不写入', async () => {
  const a = fixture('synthetic-a', 'SYN-A', 100)
  await a.workspace.load()
  const confirmation = deferred<boolean>()
  confirm.mockReturnValueOnce(confirmation.promise)
  const view = await render(CentralInvoiceWorkspaceScreen, { props: { workspace: a.workspace, projects, suppliers, signatories, initialSelectedId: 'same-invoice' }, global: { stubs: { NuxtLink: true } } })
  await focusArchive()
  await expect.poll(() => confirm.mock.calls.length).toBe(1)
  view.unmount()
  confirmation.resolve(true)
  await confirmation.promise
  // 放行一次事件循环，合成授权和写入链均仅使用 Promise 微任务。
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  expect(a.execute).not.toHaveBeenCalled()
  expect(a.current().accountStatus).toBe('none')
  expect(a.memory.size).toBe(0)
})

it('同源键盘确认后恰好归档一次并回读', async () => {
  const a = fixture('synthetic-a', 'SYN-A', 100)
  await a.workspace.load()
  confirm.mockResolvedValueOnce(true)
  await render(CentralInvoiceWorkspaceScreen, { props: { workspace: a.workspace, projects, suppliers, signatories, initialSelectedId: 'same-invoice' }, global: { stubs: { NuxtLink: true } } })
  await focusArchive()
  await expect.poll(() => a.execute.mock.calls.length).toBe(1)
  await expect.poll(() => a.get.mock.calls.length).toBe(1)
  await expect.poll(() => a.memory.size).toBe(0)
  expect(a.current().accountStatus).toBe('archived')
  expect(a.workspace.records.value[0]?.accountStatus).toBe('archived')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})
