import { expect, it } from 'vitest'
import { createPayrollAdjustmentFixture } from '../helpers/payroll-adjustment-service-fixture'

it('原工资及收付稳定身份不属于指定项目时，受控读取拒绝改用另一项目内容', async () => {
  const f = await createPayrollAdjustmentFixture()
  try {
    const correction = await f.correct()
    const refund = await f.refund(correction.adjustment.id, 40)
    const query = { origin: 'real' as const, projectId: 'other-project' }
    const expected = { problem: { code: 'relationship-mismatch' } }
    await expect(f.service.adjustmentForm(query, { target: { adjustmentId: correction.adjustment.id } })).rejects.toMatchObject(expected)
    await expect(f.service.adjustmentDetail(query, correction.adjustment.id)).rejects.toMatchObject(expected)
    await expect(f.service.actualPaymentForm(query, { target: { kind: 'actual-payment', draftKey: 'wrong-project', adjustmentIds: [correction.adjustment.id] } })).rejects.toMatchObject(expected)
    await expect(f.service.actualPaymentDetail(query, refund.actualEventId!)).rejects.toMatchObject(expected)
    await expect(f.service.actualLedger(query, { projectId: 'p' })).rejects.toMatchObject(expected)
  }
  finally { await f.close() }
})
