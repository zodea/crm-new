import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import InvoiceMigrationPanel from '~/components/migration/InvoiceMigrationPanel.vue'
import { createInvoiceMigrationSession } from '~/lib/invoice/central-migration'

const ui = vi.hoisted(() => ({ confirm: vi.fn(async () => true), invalidate: (_problem: { message: string }) => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: ui.confirm }) }))
vi.mock('~/lib/read-model/authority', () => ({ bindReadAuthority: (callback: typeof ui.invalidate) => {
  ui.invalidate = callback
} }))
vi.mock('~/lib/db/native-snapshot', () => ({ inspectNativeMigrationSnapshot: async () => ({ sha256: 'a'.repeat(64), schemaVersion: 60 }) }))

beforeEach(() => {
  ui.confirm.mockReset().mockResolvedValue(true)
})

function fixture(action: 'publish' | 'retire') {
  const actor = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'finance-invoice:write', 'finance-invoice:import'] }
  const asOf = '2026-01-01T00:00:00.000Z'
  const sha256 = 'a'.repeat(64)
  const stored = new Map<string, string>()
  const writes: unknown[] = []
  const storage = () => ({
    get length() { return stored.size },
    key: (index: number) => [...stored.keys()][index] ?? null,
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value) },
    removeItem: (key: string) => { stored.delete(key) },
  })
  const initial = { commandId: 'initial-command', batchId: 'batch-one', sourceSha256: sha256, invoiceIds: ['invoice-one'], createdAt: asOf, retiredAt: null as string | null }
  let batches = action === 'retire' ? [initial] : []
  let holdNext = false
  let resume: (() => void) | undefined
  let gateFinished = false
  let loseResponse = false
  let delayLostResponse = false
  let resumeResponse: (() => void) | undefined
  let pausedPhase: 'receipt' | 'authorization' | 'readback' | null = null
  let resumePhase: (() => void) | undefined
  let readbackObserved = false
  let readbackCapabilityMode: 'additional' | 'reordered' | null = null
  let currentCapabilities = actor.capabilities
  let postWriteAuthorizations = 0
  async function pause(phase: 'receipt' | 'authorization' | 'readback') {
    if (pausedPhase === phase) {
      pausedPhase = null
      await new Promise<void>((resolve) => {
        resumePhase = resolve
      })
    }
  }
  let applied: Record<string, unknown> | null = null
  const context = vi.fn(async () => {
    if (holdNext) {
      holdNext = false
      await new Promise<void>((resolve) => {
        resume = resolve
      })
      gateFinished = true
    }
    if (writes.length) {
      await pause('authorization')
      postWriteAuthorizations++
      if (readbackCapabilityMode && postWriteAuthorizations >= 2)
        currentCapabilities = readbackCapabilityMode === 'additional' ? [...actor.capabilities, 'project:list:read'] : [...actor.capabilities].reverse()
    }
    return { ...actor, capabilities: currentCapabilities }
  })
  const session = createInvoiceMigrationSession({ identity: actor, verifiedIdentity: actor, context, storage, commandId: () => 'race-command', fetcher: async (url, options) => {
    if (url.endsWith('/migration-state')) {
      if (writes.length) {
        readbackObserved = true
        await pause('readback')
      }
      const meta = { schemaVersion: 'invoice-read-v1', workspaceId: actor.workspaceId, actorId: actor.actorId, dataOrigin: 'real', asOf, sourceVersion: 'invoices:1', sources: [{ key: 'invoices', state: 'readable', sourceVersion: 'invoices:1', asOf }], authorizedScope: { coverage: 'complete', fingerprint: 'scope' }, capabilities: currentCapabilities }
      return { dataOrigin: 'real', asOf, sourceVersion: meta.sourceVersion, capabilities: currentCapabilities, meta, batches }
    }
    if (url.endsWith('/migration-resolve'))
      return { outcome: 'applied', result: applied }
    if (url.endsWith('/migration-publish') || url.endsWith('/migration-retire')) {
      writes.push(options?.body)
      const saved = { commandId: 'race-command', batchId: 'batch-one', sourceSha256: sha256, invoiceIds: ['invoice-one'], createdAt: asOf, ...(action === 'retire' ? { retired: true as const } : {}) }
      applied = saved
      batches = action === 'retire' ? [{ ...initial, retiredAt: asOf }] : [{ ...saved, retiredAt: null }]
      await pause('receipt')
      if (delayLostResponse) {
        await new Promise<void>((resolve) => {
          resumeResponse = resolve
        })
        throw new Error('合成迟到响应丢失')
      }
      if (loseResponse)
        throw new Error('合成响应丢失')
      return saved
    }
    throw new Error(`未预期的合成请求 ${url}`)
  } })
  const previewClient = { source: async () => ({ sourceSha256: sha256, schemaVersion: 60, invoices: [{ legacyId: 'invoice-one', invoiceNumber: '001', deleted: false, sourceState: 'session-original-unavailable', ambiguousZeroFields: [], historicalAllocationCount: 0, originalCount: 0, originalBodyStates: [] }], references: [], orphanLogCount: 0 }), mappings: async () => ({ sourceSha256: sha256, invoiceCount: 1, missingAllocationIds: [], orphanLogCount: 0 }) }
  const catalogClient = { load: async () => ({ projects: [], suppliers: [], contracts: [] }) }
  return {
    actor,
    session,
    previewClient,
    catalogClient,
    writes,
    stored,
    context,
    arm: () => {
      holdNext = true
      gateFinished = false
    },
    blocked: () => !!resume,
    release: () => {
      if (!resume)
        throw new Error('授权尚未开始')
      resume()
    },
    finished: () => gateFinished,
    lose: () => { loseResponse = true },
    delayResponse: () => { delayLostResponse = true },
    responseBlocked: () => !!resumeResponse,
    releaseResponse: () => {
      if (!resumeResponse)
        throw new Error('响应尚未开始')
      resumeResponse()
    },
    pauseAt: (phase: 'receipt' | 'authorization' | 'readback') => { pausedPhase = phase },
    phaseBlocked: () => !!resumePhase,
    releasePhase: () => {
      if (!resumePhase)
        throw new Error('目标阶段尚未开始')
      resumePhase()
    },
    readbackObserved: () => readbackObserved,
    changeReadbackCapabilities: (mode: 'additional' | 'reordered') => { readbackCapabilityMode = mode },
    readbackAuthorizations: () => postWriteAuthorizations,
  }
}

async function mountFixture(f: ReturnType<typeof fixture>, action: 'publish' | 'retire') {
  const view = render(InvoiceMigrationPanel, { props: { session: f.session, previewClient: f.previewClient as never, catalogClient: f.catalogClient as never } })
  await waitFor(() => expect((screen.getByLabelText('选择完整 SQLite 快照') as HTMLInputElement).disabled).toBe(false))
  if (action === 'publish') {
    const file = new File(['synthetic'], 'synthetic.sqlite')
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1]).buffer })
    await fireEvent.change(screen.getByLabelText('选择完整 SQLite 快照'), { target: { files: [file] } })
    await waitFor(() => expect((screen.getByRole('button', { name: '核对映射与历史付款' }) as HTMLButtonElement).disabled).toBe(false))
    await fireEvent.click(screen.getByRole('button', { name: '核对映射与历史付款' }))
    await waitFor(() => expect((screen.getByRole('button', { name: '确认迁入' }) as HTMLButtonElement).disabled).toBe(false))
  }
  return view
}

for (const action of ['publish', 'retire'] as const) {
  const button = action === 'publish' ? '确认迁入' : '撤回批次'
  for (const invalidation of ['卸载', '失权'] as const) {
    it(`${action} 授权等待期间${invalidation}时不发命令也不创建原编号`, async () => {
      const f = fixture(action)
      const view = await mountFixture(f, action)
      f.arm()
      await fireEvent.click(screen.getByRole('button', { name: button }))
      await waitFor(() => expect(f.blocked()).toBe(true))
      if (invalidation === '卸载')
        view.unmount()
      else
        ui.invalidate({ message: '来源不可用' })
      f.release()
      await waitFor(() => expect(f.finished()).toBe(true))
      await flushPromises()
      expect(f.writes).toHaveLength(0)
      expect(f.stored.size).toBe(0)
      if (invalidation === '失权')
        view.unmount()
    })
  }

  it(`${action} 授权等待期间替换会话不能发送旧命令`, async () => {
    const f = fixture(action)
    const next = fixture(action)
    const view = await mountFixture(f, action)
    f.arm()
    await fireEvent.click(screen.getByRole('button', { name: button }))
    await waitFor(() => expect(f.blocked()).toBe(true))
    await view.rerender({ session: next.session })
    f.release()
    await waitFor(() => expect(f.finished()).toBe(true))
    await flushPromises()
    expect(f.writes).toHaveLength(0)
    expect(next.writes).toHaveLength(0)
    expect(f.stored.size).toBe(0)
    view.unmount()
  })

  it(`${action} 取消确认不发命令`, async () => {
    const f = fixture(action)
    const view = await mountFixture(f, action)
    ui.confirm.mockResolvedValueOnce(false)
    await fireEvent.click(screen.getByRole('button', { name: button }))
    await flushPromises()
    expect(f.writes).toHaveLength(0)
    expect(f.stored.size).toBe(0)
    view.unmount()
  })

  it(`${action} 已发送后失权且响应丢失时保留原编号，不污染当前界面`, async () => {
    const f = fixture(action)
    f.delayResponse()
    const view = await mountFixture(f, action)
    await fireEvent.click(screen.getByRole('button', { name: button }))
    await waitFor(() => expect(f.responseBlocked()).toBe(true))
    expect(f.writes).toHaveLength(1)
    expect(f.session.pending(action === 'retire' ? 'batch-one' : null)?.commandId).toBe('race-command')
    ui.invalidate({ message: '来源不可用' })
    f.releaseResponse()
    await flushPromises()
    expect(f.session.pending(action === 'retire' ? 'batch-one' : null)?.commandId).toBe('race-command')
    expect(screen.getByRole('alert').textContent).toBe('来源不可用')
    expect(screen.queryByText(/合成迟到响应丢失/)).toBeNull()
    expect(f.writes).toHaveLength(1)
    view.unmount()
  })

  for (const phase of ['receipt', 'authorization', 'readback'] as const) {
    it(`${action} 已发送后在 ${phase} 等待期间失权，迟到成功不能清除原编号`, async () => {
      const f = fixture(action)
      f.pauseAt(phase)
      const view = await mountFixture(f, action)
      await fireEvent.click(screen.getByRole('button', { name: button }))
      await waitFor(() => expect(f.phaseBlocked()).toBe(true))
      expect(f.writes).toHaveLength(1)
      expect(f.session.pending(action === 'retire' ? 'batch-one' : null)?.commandId).toBe('race-command')
      ui.invalidate({ message: '来源不可用' })
      f.releasePhase()
      await waitFor(() => expect(f.readbackObserved()).toBe(true))
      await flushPromises()
      expect(f.session.pending(action === 'retire' ? 'batch-one' : null)?.commandId).toBe('race-command')
      expect(screen.getByRole('alert').textContent).toBe('来源不可用')
      expect(screen.queryByText(/已核对迁入批次|已核对撤回批次/)).toBeNull()
      expect(f.writes).toHaveLength(1)
      view.unmount()
    })
  }

  it(`${action} 授权后同源正常发送并可靠回读`, async () => {
    const f = fixture(action)
    const view = await mountFixture(f, action)
    f.arm()
    await fireEvent.click(screen.getByRole('button', { name: button }))
    await waitFor(() => expect(f.blocked()).toBe(true))
    f.release()
    await waitFor(() => expect(f.writes).toHaveLength(1))
    await waitFor(() => expect(f.stored.size).toBe(0))
    await screen.findByText(action === 'publish' ? '已核对迁入批次 batch-one，共 1 条发票。' : '已核对撤回批次 batch-one。')
    view.unmount()
  })

  it(`${action} 回读时能力集合发生变化，即使回读本身一致也保留原编号`, async () => {
    const f = fixture(action)
    f.changeReadbackCapabilities('additional')
    const view = await mountFixture(f, action)
    await fireEvent.click(screen.getByRole('button', { name: button }))
    await waitFor(() => expect(f.readbackAuthorizations()).toBeGreaterThanOrEqual(3))
    await flushPromises()
    expect(f.writes).toHaveLength(1)
    expect(f.session.pending(action === 'retire' ? 'batch-one' : null)?.commandId).toBe('race-command')
    expect(screen.queryByText(/已核对迁入批次|已核对撤回批次/)).toBeNull()
    view.unmount()
  })

  it(`${action} 回读能力仅调整顺序不误判变化`, async () => {
    const f = fixture(action)
    f.changeReadbackCapabilities('reordered')
    const view = await mountFixture(f, action)
    await fireEvent.click(screen.getByRole('button', { name: button }))
    await screen.findByText(action === 'publish' ? '已核对迁入批次 batch-one，共 1 条发票。' : '已核对撤回批次 batch-one。')
    expect(f.writes).toHaveLength(1)
    expect(f.stored.size).toBe(0)
    view.unmount()
  })

  it(`${action} 响应未知时保留原编号并可按原编号恢复`, async () => {
    const f = fixture(action)
    f.lose()
    const view = await mountFixture(f, action)
    await fireEvent.click(screen.getByRole('button', { name: button }))
    await screen.findByText('原提交 race-command 尚未核对。')
    expect(f.writes).toHaveLength(1)
    expect(f.session.pending(action === 'retire' ? 'batch-one' : null)?.commandId).toBe('race-command')
    await waitFor(() => expect((screen.getByRole('button', { name: '核对原提交' }) as HTMLButtonElement).disabled).toBe(false))
    await fireEvent.click(screen.getByRole('button', { name: '核对原提交' }))
    await screen.findByText('原提交已核对，批次 batch-one。')
    expect(f.stored.size).toBe(0)
    expect(f.writes).toHaveLength(1)
    view.unmount()
  })
}
