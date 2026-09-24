import { expect, it } from 'vitest'
import { createPayrollAdjustmentFixture } from '../helpers/payroll-adjustment-service-fixture'

it('确认核增100不会提前增加支出，实际补100才净1100，重复补发和反向伪退款均拒绝', async () => {
  const f = await createPayrollAdjustmentFixture()
  try {
    const correction = await f.correct(1100)
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBe(1000)
    const command = await f.paymentCommand(correction.adjustment.id, 100)
    const result = await f.service.executeAdjustment(command)
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBe(1100)
    expect((await f.service.adjustmentDetail({ origin: 'real' }, correction.adjustment.id)).balance.remainingDelta.value).toBe(0)
    await expect(f.service.executeAdjustment(command)).resolves.toEqual(result)
    await expect(f.service.executeAdjustment(await f.paymentCommand(correction.adjustment.id, 100))).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(f.refund(correction.adjustment.id, 100)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect(await f.service.c2Output({ origin: 'real' }, f.statementId)).toMatchObject({ state: 'available', document: { actualAmount: 1000 } })
  }
  finally { await f.close() }
})
