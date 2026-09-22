import { expect, it } from 'vitest'
import { createPayrollAdjustmentFixture } from '../helpers/payroll-adjustment-service-fixture'

it('核减100先退40再随次月实发940处理60，两月实际1900且不把抵扣另算退款', async () => {
  const f = await createPayrollAdjustmentFixture()
  try {
    const correction = await f.correct()
    await f.refund(correction.adjustment.id, 40)
    const originalFrozen = await f.service.c2Output({ origin: 'real' }, f.statementId)
    await f.daywork({ workDate: '2026-09-01', status: 'confirmed', witness: '现场证明', confirmedOn: '2026-09-02' })
    const draft = { ...f.draft, month: '2026-09' }
    const created = await f.service.executeC2(f.c2Command(await f.c2Form({ month: '2026-09' }, 'next-c2'), { kind: 'save-c2-draft', draft }))
    const nextId = created.statementId!
    const next = () => f.service.c2Form({ origin: 'real' }, { statementId: nextId })
    await f.service.executeC2(f.c2Command(await next(), { kind: 'check-c2' }))
    const preview = await f.service.releaseAdjustmentPreview({ origin: 'real' }, { statementId: nextId })
    const candidate = preview.candidates.find(c => c.adjustmentId === correction.adjustment.id)!
    expect(candidate).toMatchObject({ remainingAmount: -60, embeddedInCalculation: 0, additionalWithholding: 60 })
    const release = f.c2Command(await next(), { kind: 'release-c2', release: { actualAmount: 940, allocations: [{ workerId: 'w', amount: 940 }, { workerId: 'member', amount: 0 }, { workerId: 'zero', amount: 0 }], adjustmentApplications: [{ adjustmentId: correction.adjustment.id, amount: -60, balanceVersion: candidate.balanceVersion, coverageVersion: candidate.coverageVersion }] } })
    const result = await f.service.executeC2(release)
    expect(result.outcome).toBe('released')
    expect((await f.service.adjustmentDetail({ origin: 'real' }, correction.adjustment.id)).balance.remainingDelta.value).toBe(0)
    const actual = await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })
    expect(actual.netAmount.value).toBe(1900)
    expect(actual.rows.map(r => r.signedAmount.value).sort((a, b) => a! - b!)).toEqual([-40, 940, 1000])
    expect(await f.service.c2Output({ origin: 'real' }, f.statementId)).toMatchObject({ state: 'available', document: originalFrozen.document })
    expect(await f.service.c2Output({ origin: 'real' }, nextId)).toMatchObject({ state: 'available', document: { actualAmount: 940, grossAmount: 1000 } })
    await expect(f.service.executeC2(release)).resolves.toEqual(result)
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBe(1900)
  }
  finally {
    await f.close()
  }
}, 30_000)
