import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import InvoiceMigrationPanel from '~/components/migration/InvoiceMigrationPanel.vue'
import { createInvoiceMigrationSession } from '~/lib/invoice/central-migration'

const ui = vi.hoisted(() => ({ invalidate: (_problem: { message: string }) => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true }) }))
vi.mock('~/lib/read-model/authority', () => ({ bindReadAuthority: (callback: typeof ui.invalidate) => {
  ui.invalidate = callback
} }))

type Action = 'publish' | 'retire'
type Outcome = 'applied' | 'not-applied'
type Phase = 'authorization' | 'resolve' | 'reauthorization' | 'readback'

function fixture(action: Action, outcome: Outcome) {
  const actor = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'finance-invoice:write', 'finance-invoice:import'] }
  const asOf = '2026-01-01T00:00:00.000Z'
  const sha256 = 'a'.repeat(64)
  const values = new Map<string, string>()
  const storage = () => ({
    get length() { return values.size },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  })
  const original = { commandId: 'original-command', batchId: 'batch-one', sourceSha256: sha256, invoiceIds: ['invoice-one'], createdAt: asOf, ...(action === 'retire' ? { retired: true as const } : {}) }
  const existing = { commandId: 'prior-command', batchId: 'batch-one', sourceSha256: sha256, invoiceIds: ['invoice-one'], createdAt: asOf, retiredAt: outcome === 'applied' && action === 'retire' ? asOf : null }
  const batches = action === 'retire' ? [existing] : outcome === 'applied' ? [{ ...original, retiredAt: null }] : []
  let desiredPhase: Phase | null = null
  let releasePhase: (() => void) | undefined
  let recoverActive = false
  let authCount = 0
  let capabilities = actor.capabilities
  let capabilityMode: 'additional' | 'reordered' | null = null
  let settled = 0
  const resolutions: unknown[] = []
  async function pause(phase: Phase) {
    if (desiredPhase === phase) {
      desiredPhase = null
      await new Promise<void>((resolve) => {
        releasePhase = resolve
      })
    }
  }
  const session = createInvoiceMigrationSession({ identity: actor, verifiedIdentity: actor, storage, commandId: () => 'original-command', context: async () => {
    if (recoverActive) {
      authCount++
      if (authCount === 1)
        await pause('authorization')
      if (authCount === 2)
        await pause('reauthorization')
      if (capabilityMode && authCount >= 3)
        capabilities = capabilityMode === 'additional' ? [...actor.capabilities, 'project:list:read'] : [...actor.capabilities].reverse()
    }
    return { ...actor, capabilities }
  }, fetcher: async (url, options) => {
    if (url.endsWith('/migration-publish') || url.endsWith('/migration-retire'))
      throw new Error('合成原提交响应丢失')
    if (url.endsWith('/migration-resolve')) {
      resolutions.push(options?.body)
      await pause('resolve')
      return outcome === 'applied' ? { outcome: 'applied', result: original } : { outcome: 'not-applied', commandId: 'original-command' }
    }
    if (url.endsWith('/migration-state')) {
      if (recoverActive && authCount >= 3)
        await pause('readback')
      const meta = { schemaVersion: 'invoice-read-v1', workspaceId: actor.workspaceId, actorId: actor.actorId, dataOrigin: 'real', asOf, sourceVersion: 'invoices:1', sources: [{ key: 'invoices', state: 'readable', sourceVersion: 'invoices:1', asOf }], authorizedScope: { coverage: 'complete', fingerprint: 'scope' }, capabilities }
      return { dataOrigin: 'real', asOf, sourceVersion: meta.sourceVersion, capabilities, meta, batches }
    }
    throw new Error(`未预期的合成请求 ${url}`)
  } })
  const recover = session.recover
  session.recover = (targetId, isCurrent) => {
    recoverActive = true
    const pending = recover(targetId, isCurrent)
    pending.then(() => {
      settled++
    }, () => {
      settled++
    })
    return pending
  }
  return {
    session,
    resolutions,
    values,
    target: action === 'retire' ? 'batch-one' : null,
    seed: () => action === 'retire' ? session.retire('batch-one') : session.publish({ sha256, payloadBase64: 'AA==' }, { projects: [], suppliers: [], contracts: [] }),
    arm: (phase: Phase) => { desiredPhase = phase },
    paused: () => !!releasePhase,
    release: () => {
      if (!releasePhase)
        throw new Error('目标阶段尚未开始')
      releasePhase()
    },
    settled: () => settled,
    changeCapabilities: (mode: 'additional' | 'reordered') => { capabilityMode = mode },
  }
}

async function mountFixture(f: ReturnType<typeof fixture>) {
  const view = render(InvoiceMigrationPanel, { props: { session: f.session, previewClient: {} as never, catalogClient: {} as never } })
  await screen.findByText('原提交 original-command 尚未核对。')
  await waitFor(() => expect((screen.getByRole('button', { name: '核对原提交' }) as HTMLButtonElement).disabled).toBe(false))
  return view
}

for (const action of ['publish', 'retire'] as const) {
  for (const outcome of ['applied', 'not-applied'] as const) {
    const phases: Phase[] = outcome === 'applied' ? ['authorization', 'resolve', 'reauthorization', 'readback'] : ['authorization', 'resolve', 'reauthorization']
    for (const phase of phases) {
      for (const invalidation of ['失权', '换会话'] as const) {
        it(`${action}/${outcome} 在 ${phase} 等待期间${invalidation}时保留原编号`, async () => {
          const f = fixture(action, outcome)
          await expect(f.seed()).rejects.toThrow('合成原提交响应丢失')
          const view = await mountFixture(f)
          f.arm(phase)
          await fireEvent.click(screen.getByRole('button', { name: '核对原提交' }))
          await waitFor(() => expect(f.paused()).toBe(true))
          if (invalidation === '失权')
            ui.invalidate({ message: '来源不可用' })
          else
            await view.rerender({ session: { ...f.session } })
          f.release()
          await waitFor(() => expect(f.settled()).toBe(1))
          await flushPromises()
          expect(f.session.pending(f.target)?.commandId).toBe('original-command')
          expect(screen.queryByText(/原提交已核对，批次|已核对原提交未生效/)).toBeNull()
          view.unmount()
          const restored = await mountFixture(f)
          await fireEvent.click(screen.getByRole('button', { name: '核对原提交' }))
          await screen.findByText(outcome === 'applied' ? '原提交已核对，批次 batch-one。' : '已核对原提交未生效，可以重新预检。')
          expect(f.session.pending(f.target)).toBeNull()
          expect(f.resolutions.every(body => (body as { commandId: string }).commandId === 'original-command')).toBe(true)
          restored.unmount()
        })
      }
    }
  }
  for (const mode of ['additional', 'reordered'] as const) {
    it(`${action}/applied 回读能力${mode === 'additional' ? '变化时保留原编号' : '仅重排时正常核对'}`, async () => {
      const f = fixture(action, 'applied')
      await expect(f.seed()).rejects.toThrow('合成原提交响应丢失')
      const view = await mountFixture(f)
      f.changeCapabilities(mode)
      await fireEvent.click(screen.getByRole('button', { name: '核对原提交' }))
      await waitFor(() => expect(f.settled()).toBe(1))
      if (mode === 'additional') {
        expect(f.session.pending(f.target)?.commandId).toBe('original-command')
        expect(screen.queryByText('原提交已核对，批次 batch-one。')).toBeNull()
      }
      else {
        await screen.findByText('原提交已核对，批次 batch-one。')
        expect(f.session.pending(f.target)).toBeNull()
      }
      view.unmount()
    })
  }
}
