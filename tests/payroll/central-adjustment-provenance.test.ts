import { expect, it } from 'vitest'
import { createPayrollAdjustmentFixture } from '../helpers/payroll-adjustment-service-fixture'

it('已确认更正正文与确认冻结不一致时阻止新处理，不能按损坏后的数字继续补退', async () => {
  const f = await createPayrollAdjustmentFixture()
  try {
    const correction = await f.correct()
    const broken = { ...correction.adjustment.draft.basis, unitRate: 800 }
    await f.db.execute('UPDATE payroll_adjustments SET basis_json=? WHERE id=?', [JSON.stringify(broken), correction.adjustment.id])
    await expect(f.service.actualPaymentForm({ origin: 'real' }, { target: { kind: 'actual-payment', draftKey: 'broken-correction', adjustmentIds: [correction.adjustment.id] } })).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBe(1000)
    expect(await f.db.select('SELECT id FROM payroll_actual_events')).toHaveLength(0)
  }
  finally { await f.close() }
})

it.each(['kind', 'root', 'proof'])('退款处理引用的%s损坏时，金额仍保留未知，不能伪装成另一种有效处理', async (field) => {
  const f = await createPayrollAdjustmentFixture()
  try {
    const correction = await f.correct()
    const refund = await f.refund(correction.adjustment.id, 40)
    const update = field === 'kind' ? 'kind=\'recording-reversal\'' : field === 'root' ? 'root_adjustment_id=\'other-root\'' : 'proof_json=\'{}\''
    await f.db.execute(`UPDATE payroll_adjustment_applications SET ${update} WHERE actual_event_id=?`, [refund.actualEventId])
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBeNull()
    expect((await f.service.adjustmentDetail({ origin: 'real' }, correction.adjustment.id)).balance.remainingDelta.value).toBeNull()
  }
  finally { await f.close() }
})

it('处理关系金额损坏不能把原待处理余额伪清零，退款事实也保留缺损诊断', async () => {
  const f = await createPayrollAdjustmentFixture()
  try {
    const correction = await f.correct()
    const refund = await f.refund(correction.adjustment.id, 40)
    await f.db.execute('UPDATE payroll_adjustment_applications SET signed_applied_fen=-10000 WHERE actual_event_id=?', [refund.actualEventId])
    const detail = await f.service.adjustmentDetail({ origin: 'real' }, correction.adjustment.id)
    expect(detail.balance.confirmedDelta.value).toBe(-100)
    expect(detail.balance.remainingDelta.value).toBeNull()
    expect(detail.balance.appliedDelta.reasons.length).toBeGreaterThan(0)
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBeNull()
  }
  finally { await f.close() }
})

it('实际确认仍在而物理应用被删除时，不能重新生成同一笔可退款余额', async () => {
  const f = await createPayrollAdjustmentFixture()
  try {
    const correction = await f.correct()
    const refund = await f.refund(correction.adjustment.id, 40)
    await f.db.execute('DELETE FROM payroll_adjustment_applications WHERE actual_event_id=?', [refund.actualEventId])
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBeNull()
    expect((await f.service.adjustmentDetail({ origin: 'real' }, correction.adjustment.id)).balance.remainingDelta.value).toBeNull()
  }
  finally { await f.close() }
})
