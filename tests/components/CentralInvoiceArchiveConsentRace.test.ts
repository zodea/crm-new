import type { CentralInvoiceCommand, CentralInvoiceRecord } from '~/lib/invoice/central-contract'
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
const projects = [{ id: 'synthetic-project', label: '合成项目' }]
const suppliers = [{ id: 'synthetic-supplier', label: '合成销方', version: '1' }]
const signatories = [{ id: 'synthetic-buyer', label: '合成购方', version: '1' }]

function fixture(workspaceId: string, invoiceNumber: string, amount: number, additional: CentralInvoiceRecord[] = []) {
  const identity = { workspaceId, actorId: 'synthetic-actor' }
  const capabilities = ['finance-invoice:read', 'finance-invoice:write']
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
  const get = vi.fn(async () => ({ record: structuredClone(current), sourceVersion: 'invoices:2', capabilities: [...capabilities], meta: { sources: [{ key: 'invoices', sourceVersion: 'invoices:2' }] } }))
  const list = vi.fn(async () => ({ items: structuredClone([current, ...additional]), pagination: { total: 1 + additional.length }, sourceVersion: 'invoices:1', capabilities: [...capabilities], meta: { sources: [{ key: 'invoices', sourceVersion: 'invoices:1' }] } }))
  let contextHook: () => Promise<void> = async () => {}
  const workspace = createCentralInvoiceWorkspace({
    identity,
    context: async () => {
      await contextHook()
      return { ...identity, capabilities: [...capabilities] }
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

async function chooseArchive() {
  const owner = await screen.findByLabelText('归属类型')
  await waitFor(() => expect((owner as HTMLSelectElement).disabled).toBe(false))
  await fireEvent.update(owner, 'project')
  await fireEvent.update(screen.getByLabelText('项目'), 'synthetic-project')
  await fireEvent.update(screen.getByLabelText('我方购买公司'), 'synthetic-buyer')
  await fireEvent.update(screen.getByLabelText('分供方公司'), 'synthetic-supplier')
  const button = screen.getByRole('button', { name: '归档发票' })
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  await fireEvent.click(button)
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce())
}

it('归档确认期间同 ID 同版本切换工作区，不应提交到新来源', async () => {
  const a = fixture('synthetic-a', 'SYN-A', 100)
  const b = fixture('synthetic-b', 'SYN-B', 200)
  await a.workspace.load()
  await b.workspace.load()
  const activeWorkspace = shallowRef(a.workspace)
  const Host = defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceScreen, { workspace: activeWorkspace.value, projects, suppliers, signatories, initialSelectedId: 'same-invoice' }) })
  const confirmation = deferred<boolean>()
  confirm.mockReturnValueOnce(confirmation.promise)
  render(Host, { global: { stubs: { NuxtLink: true } } })
  await chooseArchive()
  activeWorkspace.value = b.workspace
  await nextTick()
  await waitFor(() => expect(screen.getByRole('button', { name: /SYN-B/ })).toBeTruthy())
  confirmation.resolve(true)
  await flushPromises()
  expect(a.execute).not.toHaveBeenCalled()
  expect(b.execute).not.toHaveBeenCalled()
  expect(a.current().accountStatus).toBe('none')
  expect(b.current().accountStatus).toBe('none')
  expect(a.memory.size).toBe(0)
  expect(b.memory.size).toBe(0)
})

it('归档确认期间页面卸载，迟到确认不应提交旧来源', async () => {
  const a = fixture('synthetic-a', 'SYN-A', 100)
  await a.workspace.load()
  const confirmation = deferred<boolean>()
  confirm.mockReturnValueOnce(confirmation.promise)
  const view = render(CentralInvoiceWorkspaceScreen, { props: { workspace: a.workspace, projects, suppliers, signatories, initialSelectedId: 'same-invoice' }, global: { stubs: { NuxtLink: true } } })
  await chooseArchive()
  view.unmount()
  confirmation.resolve(true)
  await flushPromises()
  expect(a.execute).not.toHaveBeenCalled()
  expect(a.current().accountStatus).toBe('none')
  expect(a.memory.size).toBe(0)
})

it('同源明确确认后真实 session 提交一次并回读合成归档结果', async () => {
  const a = fixture('synthetic-a', 'SYN-A', 100)
  await a.workspace.load()
  confirm.mockResolvedValueOnce(true)
  render(CentralInvoiceWorkspaceScreen, { props: { workspace: a.workspace, projects, suppliers, signatories, initialSelectedId: 'same-invoice' }, global: { stubs: { NuxtLink: true } } })
  await chooseArchive()
  await waitFor(() => expect(a.execute).toHaveBeenCalledOnce())
  await waitFor(() => expect(a.workspace.pending('same-invoice')).toBeNull())
  expect(a.execute).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'synthetic-a', actorId: 'synthetic-actor', action: 'archive', invoiceId: 'same-invoice', baseVersion: '1', ownerKind: 'project', projectId: 'synthetic-project', supplierId: 'synthetic-supplier', taxNumbersConfirmed: true, taxVerification: { buyerId: 'synthetic-buyer', buyerVersion: '1', supplierVersion: '1' } }))
  expect(a.current().accountStatus).toBe('archived')
  expect(a.get).toHaveBeenCalledOnce()
  expect(a.workspace.records.value[0]?.accountStatus).toBe('archived')
  expect(a.memory.size).toBe(0)
})

it('归档确认后 session 授权等待期间卸载，不应写入或留下原编号', async () => {
  const a = fixture('synthetic-a', 'SYN-A', 100)
  await a.workspace.load()
  const confirmation = deferred<boolean>()
  const entered = deferred<void>()
  const release = deferred<void>()
  confirm.mockReturnValueOnce(confirmation.promise)
  const view = render(CentralInvoiceWorkspaceScreen, { props: { workspace: a.workspace, projects, suppliers, signatories, initialSelectedId: 'same-invoice' }, global: { stubs: { NuxtLink: true } } })
  await chooseArchive()
  let calls = 0
  a.setContextHook(async () => {
    if (++calls === 2) {
      entered.resolve()
      await release.promise
    }
  })
  confirmation.resolve(true)
  await entered.promise
  expect(a.execute).not.toHaveBeenCalled()
  expect(a.memory.size).toBe(0)
  view.unmount()
  release.resolve()
  await flushPromises()
  expect(a.execute).not.toHaveBeenCalled()
  expect(a.current().accountStatus).toBe('none')
  expect(a.memory.size).toBe(0)
})

it('取消归档确认，不提交或留下原编号', async () => {
  const a = fixture('synthetic-a', 'SYN-A', 100)
  await a.workspace.load()
  confirm.mockResolvedValueOnce(false)
  render(CentralInvoiceWorkspaceScreen, { props: { workspace: a.workspace, projects, suppliers, signatories, initialSelectedId: 'same-invoice' }, global: { stubs: { NuxtLink: true } } })
  await chooseArchive()
  await flushPromises()
  expect(a.execute).not.toHaveBeenCalled()
  expect(a.current().accountStatus).toBe('none')
  expect(a.memory.size).toBe(0)
})

it('归档确认期间切换所选发票，旧确认不归档先前票据', async () => {
  const original = fixture('synthetic-a', 'SYN-A', 100).current()
  const other = { ...original, id: 'other-invoice', fields: { ...original.fields, invoiceNumber: 'SYN-OTHER' } }
  const a = fixture('synthetic-a', 'SYN-A', 100, [other])
  await a.workspace.load()
  const confirmation = deferred<boolean>()
  confirm.mockReturnValueOnce(confirmation.promise)
  render(CentralInvoiceWorkspaceScreen, { props: { workspace: a.workspace, projects, suppliers, signatories, initialSelectedId: 'same-invoice' }, global: { stubs: { NuxtLink: true } } })
  await chooseArchive()
  const otherButton = screen.getByRole('button', { name: /SYN-OTHER/ })
  await fireEvent.click(otherButton)
  await waitFor(() => expect(otherButton.getAttribute('aria-pressed')).toBe('true'))
  confirmation.resolve(true)
  await flushPromises()
  expect(a.execute).not.toHaveBeenCalled()
  expect(a.current().accountStatus).toBe('none')
  expect(a.memory.size).toBe(0)
})

it('归档确认期间来源失效并恢复，旧确认不能提交', async () => {
  const a = fixture('synthetic-a', 'SYN-A', 100)
  await a.workspace.load()
  const confirmation = deferred<boolean>()
  confirm.mockReturnValueOnce(confirmation.promise)
  render(CentralInvoiceWorkspaceScreen, { props: { workspace: a.workspace, projects, suppliers, signatories, initialSelectedId: 'same-invoice' }, global: { stubs: { NuxtLink: true } } })
  await chooseArchive()
  a.list.mockRejectedValueOnce(new Error('合成读取失败'))
  await expect(a.workspace.load()).rejects.toThrow('合成读取失败')
  await a.workspace.load()
  await nextTick()
  confirmation.resolve(true)
  await flushPromises()
  expect(a.execute).not.toHaveBeenCalled()
  expect(a.current().accountStatus).toBe('none')
  expect(a.memory.size).toBe(0)
})

it('归档确认期间分供方版本变化，旧确认不能提交', async () => {
  const a = fixture('synthetic-a', 'SYN-A', 100)
  await a.workspace.load()
  const currentSuppliers = shallowRef(suppliers)
  const Host = defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceScreen, { workspace: a.workspace, projects, suppliers: currentSuppliers.value, signatories, initialSelectedId: 'same-invoice' }) })
  const confirmation = deferred<boolean>()
  confirm.mockReturnValueOnce(confirmation.promise)
  render(Host, { global: { stubs: { NuxtLink: true } } })
  await chooseArchive()
  currentSuppliers.value = [{ ...suppliers[0]!, version: '2' }]
  await nextTick()
  confirmation.resolve(true)
  await flushPromises()
  expect(a.execute).not.toHaveBeenCalled()
  expect(a.current().accountStatus).toBe('none')
  expect(a.memory.size).toBe(0)
})
