import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, shallowRef, useTemplateRef, watch } from 'vue'
import CentralInvoiceLedgerScreen from '~/components/invoice/CentralInvoiceLedgerScreen.vue'
import { commandRecoveryKey } from '~/lib/forms/command-recovery'
import { CentralInvoiceProblem } from '~/lib/invoice/central-contract'
import { createCentralInvoiceHttp } from '~/lib/invoice/central-http'
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

const identity = { workspaceId: 'synthetic-workspace', actorId: 'synthetic-actor' }
const caps = ['finance-invoice:read', 'finance-invoice:write']
const at = '2026-01-01T00:00:00.000Z'
function record(): CentralInvoiceRecord {
  return {
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
    archivedAt: at,
    original: { id: 'original-one', fileName: '合成.pdf', fileSize: 3, mimeType: 'application/pdf', sha256: 'a'.repeat(64) },
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  }
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function fixture() {
  let current = record()
  let revision = 1
  const capabilities = [...caps]
  let contextHook: () => Promise<void> = async () => {}
  let writeFailure = false
  let storageAvailable = true
  let sent = false
  let heldPhase: 'receipt' | 'detail' | 'final-authority' | null = null
  const phaseEntered = deferred()
  const phaseGate = deferred()
  async function pausePhase(phase: typeof heldPhase) {
    if (heldPhase === phase) {
      heldPhase = null
      phaseEntered.resolve()
      await phaseGate.promise
    }
  }
  const memory = new Map<string, string>()
  const storage = () => ({
    get length() { return memory.size },
    key: (index: number) => [...memory.keys()][index] ?? null,
    getItem: (key: string) => {
      if (!storageAvailable)
        throw new Error('合成存储不可读')
      return memory.get(key) ?? null
    },
    setItem: (key: string, value: string) => { memory.set(key, value) },
    removeItem: (key: string) => { memory.delete(key) },
  })
  function evidence(scope: string) {
    const sourceVersion = `read-synthetic-${revision}`
    const meta = { schemaVersion: 'invoice-read-v1', ...identity, dataOrigin: 'real', asOf: at, sourceVersion, sources: [{ key: 'invoices', state: 'readable', sourceVersion: `invoices:${revision}`, asOf: at }], authorizedScope: { coverage: 'complete', fingerprint: scope }, capabilities: [...capabilities] }
    return { dataOrigin: 'real', asOf: at, sourceVersion, capabilities: [...capabilities], meta }
  }
  const fetcher = vi.fn<Parameters<typeof createCentralInvoiceHttp>[0]>(async (url, options) => {
    if (url === '/api/read/invoices')
      return { ...evidence('scope-list'), items: [structuredClone(current)], pagination: { requestedPage: 1, page: 1, pageSize: 100, total: 1 } }
    if (url === '/api/read/invoices/invoice-one') {
      if (sent)
        await pausePhase('detail')
      return { ...evidence('scope-detail'), record: structuredClone(current) }
    }
    if (url === '/api/commands/invoices/print') {
      if (writeFailure)
        throw new Error('合成已发送后结果未知')
      revision++
      current = { ...current, version: '4', printCount: 1 }
      sent = true
      await pausePhase('receipt')
      return { commandId: (options!.body as { commandId: string }).commandId, updatedAt: at, records: [{ invoiceId: current.id, version: '4', printCount: 1, printRotation: 0 }] }
    }
    throw new Error(`拒绝未知合成请求 ${url}`)
  })
  const workspace = createCentralInvoiceWorkspace({
    identity,
    client: createCentralInvoiceHttp(fetcher, identity),
    context: async () => {
      await contextHook()
      if (sent)
        await pausePhase('final-authority')
      return { ...identity, capabilities: [...capabilities] }
    },
    storage,
    commandId: () => 'synthetic-print-command',
    recognizeLocal: async () => { throw new Error('未使用识别') },
  })
  // 只替代打印前原件字节核验；回执、权限、工作区、session 均走真实实现。
  vi.spyOn(workspace, 'verifiedOriginal').mockResolvedValue(new Blob(['synthetic']))
  return {
    workspace,
    fetcher,
    memory,
    setContextHook: (hook: () => Promise<void>) => { contextHook = hook },
    failWrite: () => { writeFailure = true },
    failStorage: () => { storageAvailable = false },
    holdPhase: (phase: 'receipt' | 'detail' | 'final-authority') => { heldPhase = phase },
    phaseEntered,
    phaseGate,
  }
}
async function open(f: ReturnType<typeof fixture>) {
  await f.workspace.load()
  const selected = shallowRef(f.workspace)
  const Host = defineComponent({ setup: () => () => h(CentralInvoiceLedgerScreen, { workspace: selected.value, projects: [] }) })
  const view = render(Host, { global: { stubs: { NuxtLink: true, InvoicePreviewSvg: true } } })
  await nextTick()
  await waitFor(() => expect(f.workspace.readState.value).toBe('ready'))
  await fireEvent.click(await screen.findByLabelText('选择发票 SYN-001'))
  await waitFor(() => expect((screen.getByRole('button', { name: '打印所选' }) as HTMLButtonElement).disabled).toBe(false))
  await fireEvent.click(screen.getByRole('button', { name: '打印所选' }))
  await fireEvent.click(screen.getByRole('button', { name: /打印选中/ }))
  await screen.findByRole('button', { name: '已打印' })
  return { view, selected }
}

it.each(['switch', 'switch-back', 'unmount', 'unavailable-recovered'] as const)('打印确认等待授权期间 %s，不能发送旧登记或保存编号', async (kind) => {
  const f = fixture()
  const { view, selected } = await open(f)
  const entered = deferred()
  const gate = deferred()
  const recordPrinted = vi.spyOn(f.workspace, 'recordPrinted')
  f.setContextHook(async () => {
    entered.resolve()
    await gate.promise
  })
  await fireEvent.click(screen.getByRole('button', { name: '已打印' }))
  await entered.promise
  expect(f.memory.size).toBe(0)
  if (kind === 'switch' || kind === 'switch-back') {
    const other = fixture()
    await other.workspace.load()
    selected.value = other.workspace
    await nextTick()
    if (kind === 'switch-back') {
      selected.value = f.workspace
      await nextTick()
    }
  }
  else if (kind === 'unmount') {
    view.unmount()
  }
  else {
    f.setContextHook(async () => {
      throw new Error('合成身份不可核验')
    })
    await expect(f.workspace.load()).rejects.toThrow('合成身份不可核验')
    expect(f.workspace.readState.value).toBe('unavailable')
    f.setContextHook(async () => {})
    await f.workspace.load()
  }
  gate.resolve()
  await recordPrinted.mock.results[0]!.value.catch(() => {})
  expect(f.fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices/print')).toHaveLength(0)
  expect(f.memory.size).toBe(0)
})

it('同源打印确认在授权后登记一次并回读', async () => {
  const f = fixture()
  await open(f)
  const recordPrinted = vi.spyOn(f.workspace, 'recordPrinted')
  await fireEvent.click(screen.getByRole('button', { name: '已打印' }))
  await waitFor(() => expect(recordPrinted).toHaveBeenCalledOnce())
  await recordPrinted.mock.results[0]!.value
  expect(f.fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices/print')).toHaveLength(1)
  expect(f.workspace.pendingPrint()).toBeNull()
})

it.each((['receipt', 'detail', 'final-authority'] as const).flatMap(phase => (['switch', 'unmount', 'revoked-recovered'] as const).map(change => ({ phase, change }))))('已发送后在 $phase 等待期间 $change，旧成功回包不得清除原编号', async ({ phase, change }) => {
  const f = fixture()
  const { selected, view } = await open(f)
  f.holdPhase(phase)
  const operation = vi.spyOn(f.workspace, 'recordPrinted')
  await fireEvent.click(screen.getByRole('button', { name: '已打印' }))
  await f.phaseEntered.promise
  expect(f.workspace.pendingPrint()?.commandId).toBe('synthetic-print-command')
  if (change === 'switch') {
    const other = fixture()
    await other.workspace.load()
    selected.value = other.workspace
    await nextTick()
  }
  else if (change === 'unmount') {
    view.unmount()
  }
  else {
    f.setContextHook(async () => {
      throw new CentralInvoiceProblem('forbidden', '合成会话失权')
    })
    await expect(f.workspace.load()).rejects.toThrow('合成会话失权')
    expect(f.workspace.readState.value).toBe('unavailable')
    f.setContextHook(async () => {})
    await f.workspace.load()
  }
  f.phaseGate.resolve()
  await expect(operation.mock.results[0]!.value).rejects.toThrow('打印登记已发送，原编号仍保留，请回原来源核对。')
  expect(f.workspace.pendingPrint()?.commandId).toBe('synthetic-print-command')
  expect(f.fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices/print')).toHaveLength(1)
  expect(screen.queryByText(/打印记录未提交/)).toBeNull()
})

it('最后授权期间出现其他原打印编号时不覆盖原号或发送新登记', async () => {
  const f = fixture()
  await open(f)
  const entered = deferred()
  const gate = deferred()
  const recordPrinted = vi.spyOn(f.workspace, 'recordPrinted')
  f.setContextHook(async () => {
    entered.resolve()
    await gate.promise
  })
  await fireEvent.click(screen.getByRole('button', { name: '已打印' }))
  await entered.promise
  const key = commandRecoveryKey({ ...identity, family: 'finance-invoice-print', targetId: null })
  const original = JSON.stringify({ ...identity, family: 'finance-invoice-print', targetId: null, action: 'record-printed', commandId: 'other-print-command' })
  f.memory.set(key, original)
  gate.resolve()
  await expect(recordPrinted.mock.results[0]!.value).rejects.toThrow('打印记录未提交')
  expect(f.memory.get(key)).toBe(original)
  expect(f.fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices/print')).toHaveLength(0)
})

it('授权请求失败不能误称发送前守卫已拒绝', async () => {
  const f = fixture()
  await open(f)
  const recordPrinted = vi.spyOn(f.workspace, 'recordPrinted')
  f.setContextHook(async () => {
    throw new Error('合成授权不可核验')
  })
  await fireEvent.click(screen.getByRole('button', { name: '已打印' }))
  await expect(recordPrinted.mock.results[0]!.value).rejects.toThrow('合成授权不可核验')
  expect(f.fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices/print')).toHaveLength(0)
  expect(f.memory.size).toBe(0)
  expect(screen.queryByText(/打印记录未提交/)).toBeNull()
})

it('最后授权期间原号存储不可核验时优先提示存储缺口', async () => {
  const f = fixture()
  await open(f)
  const entered = deferred()
  const gate = deferred()
  const recordPrinted = vi.spyOn(f.workspace, 'recordPrinted')
  f.setContextHook(async () => {
    entered.resolve()
    await gate.promise
  })
  await fireEvent.click(screen.getByRole('button', { name: '已打印' }))
  await entered.promise
  f.failStorage()
  gate.resolve()
  await expect(recordPrinted.mock.results[0]!.value).rejects.toThrow('打印记录未提交')
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('打印记录存储暂不可核验'))
  expect(f.fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices/print')).toHaveLength(0)
  expect(f.memory.size).toBe(0)
})

it('已发送后结果未知时保留原编号，不能误称登记未提交', async () => {
  const f = fixture()
  await open(f)
  const recordPrinted = vi.spyOn(f.workspace, 'recordPrinted')
  f.failWrite()
  await fireEvent.click(screen.getByRole('button', { name: '已打印' }))
  await expect(recordPrinted.mock.results[0]!.value).rejects.toThrow('合成已发送后结果未知')
  expect(f.fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices/print')).toHaveLength(1)
  expect(f.workspace.pendingPrint()?.commandId).toBe('synthetic-print-command')
  expect(screen.queryByText(/打印记录未提交/)).toBeNull()
})
