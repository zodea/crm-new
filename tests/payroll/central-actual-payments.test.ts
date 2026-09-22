import { expect, it } from 'vitest'
import { createPayrollAdjustmentFixture } from '../helpers/payroll-adjustment-service-fixture'

it('核减100后实际退回40，只减少一次实际现金并保留60待处理和原签名', async () => {
  const f = await createPayrollAdjustmentFixture()
  try {
    const correction = await f.correct()
    const frozen = await f.service.c2Output({ origin: 'real' }, f.statementId)
    const target = { kind: 'actual-payment', draftKey: 'refund40', adjustmentIds: [correction.adjustment.id] } as const
    const initial = await f.service.actualPaymentForm({ origin: 'real' }, { target })
    expect(initial.draft.amount).toBeNull()
    const draft = { kind: 'refund' as const, occurredOn: '2026-08-05', amount: -40, evidenceNote: '负责人已实际退回40元，经办人当面核对', allocations: [{ workerId: 'w', amount: -40 }], applications: [{ adjustmentId: correction.adjustment.id, amount: -40, balanceVersion: initial.balances[0]!.balanceVersion }] }
    const preview = await f.service.actualPaymentForm({ origin: 'real' }, { target, draft })
    const command = { commandId: 'actual-refund40', workspaceId: preview.context.workspaceId, actorId: preview.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: preview.context.sourceVersion, projectId: 'p', target, action: { kind: 'confirm-actual-payment' as const, payment: draft } }
    const receipt = await f.service.executeAdjustment(command)
    const retry = await f.service.executeAdjustment(command)
    expect(retry).toEqual(receipt)
    const detail = await f.service.actualPaymentDetail({ origin: 'real' }, receipt.actualEventId!)
    expect(detail.fact).toMatchObject({ kind: 'refund', signedAmount: { value: -40 }, allocations: [{ workerId: 'w', amount: -40 }] })
    const balance = await f.service.adjustmentDetail({ origin: 'real' }, correction.adjustment.id)
    expect(balance.balance).toMatchObject({ confirmedDelta: { value: -100 }, appliedDelta: { value: -40 }, remainingDelta: { value: -60 } })
    const ledger = await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })
    expect(ledger.netAmount.value).toBe(960)
    expect(ledger.rows.map(r => r.kind).sort()).toEqual(['initial-release', 'refund'])
    expect(await f.service.c2Output({ origin: 'real' }, f.statementId)).toMatchObject({ state: 'available', document: frozen.document })
  }
  finally {
    await f.close()
  }
}, 30_000)
