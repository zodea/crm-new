import type { PayrollActualRef } from '~/lib/payroll/central-actual-contract'
import { expect, it } from 'vitest'
import { createPayrollAdjustmentFixture } from '../helpers/payroll-adjustment-service-fixture'

async function reversalCommand(f: Awaited<ReturnType<typeof createPayrollAdjustmentFixture>>, original: PayrollActualRef, key: string) {
  const target = { kind: 'recording-reversal' as const, draftKey: key, original }
  const draft = { confirmedNotOccurred: true, confirmedOn: new Date().toISOString().slice(0, 10), evidenceNote: '经办人与负责人逐项核对，该记录所述事实不成立，保留原件追加纠错' }
  const read = await f.service.actualReversalForm({ origin: 'real' }, { target, draft })
  return { commandId: key, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: read.context.sourceVersion, projectId: read.originalFact.projectId, target, action: { kind: 'confirm-recording-reversal' as const, reversal: draft } }
}

it('有证据的错误退款记录以独立冲销抵销，恢复原待处理余额；不改旧退款也不冒充新现金', async () => {
  const f = await createPayrollAdjustmentFixture()
  try {
    const correction = await f.correct()
    const refund = await f.refund(correction.adjustment.id, 40)
    const target = { kind: 'recording-reversal' as const, draftKey: 'refund-recording-error', original: { kind: 'actual-event' as const, eventId: refund.actualEventId! } }
    const initial = await f.service.actualReversalForm({ origin: 'real' }, { target })
    expect(initial.draft.confirmedNotOccurred).toBe(false)
    expect(initial.eligibility.canConfirmReversal).toBe(false)
    const draft = { confirmedNotOccurred: true, confirmedOn: '2026-08-09', evidenceNote: '原退款确认误点，经办人与负责人核对该40元尚未实际退回' }
    const preview = await f.service.actualReversalForm({ origin: 'real' }, { target, draft })
    expect(preview.reversalAmount.value).toBe(40)
    const command = { commandId: 'reverse-refund', workspaceId: preview.context.workspaceId, actorId: preview.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: preview.context.sourceVersion, projectId: 'p', target, action: { kind: 'confirm-recording-reversal' as const, reversal: draft } }
    const result = await f.service.executeAdjustment(command)
    expect(result.actualEventId).toBeTruthy()
    expect((await f.service.actualPaymentDetail({ origin: 'real' }, refund.actualEventId!)).fact).toMatchObject({ kind: 'refund', signedAmount: { value: -40 } })
    const actual = await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })
    expect(actual.netAmount.value).toBe(1000)
    expect(actual.rows.find(r => r.ref.kind === 'actual-event' && r.ref.eventId === result.actualEventId)).toMatchObject({ kind: 'recording-reversal', signedAmount: { value: 40 }, reverses: target.original })
    expect((await f.service.adjustmentDetail({ origin: 'real' }, correction.adjustment.id)).balance).toMatchObject({ appliedDelta: { value: 0 }, remainingDelta: { value: -100 } })
    await expect(f.service.executeAdjustment(command)).resolves.toEqual(result)
    const again = await f.service.actualReversalForm({ origin: 'real' }, { target: { ...target, draftKey: 'another-reversal' }, draft })
    expect(again.eligibility.canConfirmReversal).toBe(false)
    expect(await f.service.c2Output({ origin: 'real' }, f.statementId)).toMatchObject({ state: 'available', document: { actualAmount: 1000 } })
  }
  finally { await f.close() }
}, 30_000)

it('错误的冲销再追加纠错，恢复有效退款及其处理关系，旧三笔记录不被修改', async () => {
  const f = await createPayrollAdjustmentFixture()
  try {
    const correction = await f.correct()
    const refund = await f.refund(correction.adjustment.id, 40)
    const reversed = await f.service.executeAdjustment(await reversalCommand(f, { kind: 'actual-event', eventId: refund.actualEventId! }, 'first-reversal'))
    await f.service.executeAdjustment(await reversalCommand(f, { kind: 'actual-event', eventId: reversed.actualEventId! }, 'reverse-the-reversal'))
    const actual = await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })
    expect(actual.rows.map(r => r.signedAmount.value).sort((a, b) => a! - b!)).toEqual([-40, -40, 40, 1000])
    expect(actual.netAmount.value).toBe(960)
    expect((await f.service.adjustmentDetail({ origin: 'real' }, correction.adjustment.id)).balance).toMatchObject({ appliedDelta: { value: -40 }, remainingDelta: { value: -60 } })
    expect((await f.db.select('SELECT id FROM payroll_actual_events'))).toHaveLength(3)
  }
  finally { await f.close() }
})

it('原发放被证实未发生时仅冲销其记账效果，保原签名和月锁，不能以普通退款冒充', async () => {
  const f = await createPayrollAdjustmentFixture()
  try {
    const result = await f.service.executeAdjustment(await reversalCommand(f, { kind: 'released-statement', statementId: f.statementId }, 'incorrect-original-release'))
    const read = await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })
    expect(read.netAmount.value).toBe(0)
    expect(read.rows.filter(r => r.kind === 'refund')).toHaveLength(0)
    expect(read.rows.find(r => r.ref.kind === 'actual-event' && r.ref.eventId === result.actualEventId)).toMatchObject({ kind: 'recording-reversal', signedAmount: { value: -1000 } })
    expect(await f.service.c2Output({ origin: 'real' }, f.statementId)).toMatchObject({ state: 'available', document: { actualAmount: 1000 } })
    await expect(f.daywork({ status: 'confirmed', witness: '后填', confirmedOn: '2026-08-02' })).rejects.toMatchObject({ problem: { code: 'conflict' } })
  }
  finally { await f.close() }
})
