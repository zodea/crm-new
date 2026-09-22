// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePayrollAdjustmentsStore } from '~/stores/payroll-adjustments'
import { createPayrollAdjustmentFixture } from '../helpers/payroll-adjustment-service-fixture'

beforeEach(() => {
  sessionStorage.clear()
  setActivePinia(createPinia())
  vi.stubGlobal('crypto', webcrypto)
})
afterEach(() => vi.unstubAllGlobals())

it('退款已成功但响应丢失时，冷实例只重发原命令，后续合法冲销不妨碍确认原成功', async () => {
  const f = await createPayrollAdjustmentFixture()
  try {
    const correction = await f.correct()
    const command = await f.refundCommand(correction.adjustment.id, 40)
    const repo = { ...f.service, executeAdjustment: vi.fn(f.service.executeAdjustment), actualPaymentDetail: vi.fn(f.service.actualPaymentDetail) }
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { payroll: repo } }))
    const store = usePayrollAdjustmentsStore()
    const read = await store.loadActualPaymentForm({ origin: 'real' }, { target: command.target, draft: command.action.payment })
    repo.executeAdjustment.mockImplementationOnce(async (input) => {
      await f.service.executeAdjustment(input)
      throw new Error('成功响应丢失')
    })
    await expect(store.confirmActualPayment(read)).rejects.toThrow('成功响应丢失')
    const original = store.getAdjustmentPending(read)!
    expect(original.state).toBe('unknown')
    setActivePinia(createPinia())
    const cold = usePayrollAdjustmentsStore()
    const result = await cold.recoverAdjustment(original)
    expect(repo.executeAdjustment.mock.calls.at(-1)![0]).toEqual(original.command)
    expect(cold.getAdjustmentPending(read)?.state).toBe('awaiting-read')
    repo.actualPaymentDetail.mockRejectedValueOnce(new Error('成功后回读断线'))
    await expect(cold.loadActualPaymentDetail({ origin: 'real' }, result.actualEventId!)).rejects.toThrow()
    expect(cold.getAdjustmentPending(read)?.command).toEqual(original.command)
    const reversal = await cold.loadActualReversalForm({ origin: 'real' }, { target: { kind: 'recording-reversal', draftKey: 'reverse-later', original: { kind: 'actual-event', eventId: result.actualEventId! } }, draft: { confirmedNotOccurred: true, confirmedOn: '2026-08-06', evidenceNote: '复核银行流水确认退款并未发生' } })
    await cold.confirmRecordingReversal(reversal)
    const detail = await cold.loadActualPaymentDetail({ origin: 'real' }, result.actualEventId!)
    expect(() => cold.acknowledgeAdjustment(original, structuredClone(detail))).toThrow()
    cold.acknowledgeAdjustment(original, detail)
    expect(cold.getAdjustmentPending(read)).toBeNull()
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBe(1000)
    expect(await f.db.select('SELECT id FROM payroll_actual_events WHERE kind=\'refund\'')).toHaveLength(1)
  }
  finally { await f.close() }
})

it('更正草稿的修改过后读不能清稿；原稿后来确认仍能核对保存成功', async () => {
  const f = await createPayrollAdjustmentFixture()
  try {
    const repo = { ...f.service, adjustmentDetail: vi.fn(f.service.adjustmentDetail) }
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { payroll: repo } }))
    const store = usePayrollAdjustmentsStore()
    const initial = await store.loadAdjustmentForm({ origin: 'real' }, { target: { adjustmentId: null, draftKey: 'new-correction', originalStatementId: f.statementId } })
    if (initial.draft.basis?.formatFamily !== 'C2')
      throw new Error('缺少原签工依据')
    const draft = { ...initial.draft, reason: '单价更正', evidenceNote: '具名核对原约定', basis: { ...initial.draft.basis, unitRate: 900 } }
    const preview = await store.loadAdjustmentForm({ origin: 'real' }, { target: initial.target, draft })
    const saved = await store.saveAdjustmentDraft(preview, draft)
    const original = store.getAdjustmentPending(preview)!
    const form = await store.loadAdjustmentForm({ origin: 'real' }, { target: { adjustmentId: saved.adjustmentId! } })
    const confirmed = await store.confirmAdjustment(form)
    expect(confirmed.outcome).toBe('confirmed')
    const detail = await store.loadAdjustmentDetail({ origin: 'real' }, saved.adjustmentId!)
    expect(() => store.acknowledgeAdjustment(original, { ...detail, original: { ...detail.original, projectId: 'other' } })).toThrow()
    store.acknowledgeAdjustment(original, detail)
    expect(store.getAdjustmentPending(preview)).toBeNull()
    const confirmationPending = store.getAdjustmentPending(form)!
    store.acknowledgeAdjustment(confirmationPending, detail)
    expect(store.getAdjustmentPending(form)).toBeNull()
  }
  finally { await f.close() }
})

it('撤权后保留原目标及原输入，恢复权限后仍按原编号核对', async () => {
  const f = await createPayrollAdjustmentFixture()
  try {
    const correction = await f.correct()
    const command = await f.refundCommand(correction.adjustment.id, 40)
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { payroll: f.service } }))
    const store = usePayrollAdjustmentsStore()
    const read = await store.loadActualPaymentForm({ origin: 'real' }, { target: command.target, draft: command.action.payment })
    const result = await store.confirmActualPayment(read)
    const original = store.getAdjustmentPending(read)!
    f.setSession({ workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read'] })
    const readonly = await store.loadActualPaymentDetail({ origin: 'real' }, result.actualEventId!)
    expect(() => store.acknowledgeAdjustment(original, readonly)).toThrow()
    await expect(store.recoverAdjustment(original)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(store.getAdjustmentPending(read)?.command).toEqual(original.command)
    f.setSession({ workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read', 'payroll:write'] })
    await store.recoverAdjustment(original)
    const latest = await store.loadActualPaymentDetail({ origin: 'real' }, result.actualEventId!)
    store.acknowledgeAdjustment(original, latest)
    expect(store.getAdjustmentPending(read)).toBeNull()
  }
  finally { await f.close() }
})
