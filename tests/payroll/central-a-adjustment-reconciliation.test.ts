import { expect, it } from 'vitest'
import { createPayrollAAdjustmentFixture } from '../helpers/payroll-a-adjustment-fixture'

it.each([false, true])('a 来源同步更正=%s：未退款时已含核减，退款后仅可领后续新施工，不重新领原100', async (sourceCorrected) => {
  const f = await createPayrollAAdjustmentFixture()
  try {
    const correction = await f.correct()
    if (sourceCorrected) {
      f.facts.rows[0]!.fieldQty = 9
      f.facts.rows[0]!.fieldFormula = '3*3'
      f.facts.rows[0]!.sourceFingerprint = 'corrected-cell'
    }
    const next = () => f.form({ month: '2026-09', payRatio: 1 }, 'a-next')
    const onlyOld = await next()
    expect(onlyOld.totals.grossAmount.value).toBe(0)
    expect(onlyOld.adjustmentReconciliation).toMatchObject({ effectiveCumulative: { value: 900 }, actualNet: { value: 1000 } })
    await f.refund(correction.adjustment.id, 100)
    expect((await next()).totals.grossAmount.value).toBe(0)
    f.addNextWork()
    const withNew = await next()
    expect(withNew.totals.previouslyPaid.value).toBe(1000)
    expect(withNew.adjustmentReconciliation).toMatchObject({ effectiveCumulative: { value: 1900 }, actualNet: { value: 900 }, availableAmount: { value: 1000 } })
    expect(withNew.totals.grossAmount.value).toBe(1000)
  }
  finally { await f.close() }
}, 30_000)

it.each([false, true])('a 新累计已含核减（来源已改=%s），次月实发900关联处理100，不能再扣成800', async (sourceCorrected) => {
  const f = await createPayrollAAdjustmentFixture()
  try {
    const correction = await f.correct()
    if (sourceCorrected) {
      f.facts.rows[0]!.fieldQty = 9
      f.facts.rows[0]!.fieldFormula = '3*3'
      f.facts.rows[0]!.sourceFingerprint = 'corrected-cell'
    }
    f.addNextWork()
    const draft = { ...f.draft, month: '2026-09', payRatio: 1 }
    const saved = await f.service.execute(f.command(await f.form(draft, 'next-a'), { kind: 'save-a-draft', draft }))
    const read = () => f.service.aForm({ origin: 'real' }, { statementId: saved.statementId! })
    await f.service.execute(f.command(await read(), { kind: 'check-a' }))
    const preview = await f.service.releaseAdjustmentPreview({ origin: 'real' }, { statementId: saved.statementId! })
    const candidate = preview.candidates[0]!
    expect(candidate).toMatchObject({ eligible: true, remainingAmount: -100, embeddedInCalculation: 100, additionalWithholding: 0 })
    const release = f.command(await read(), { kind: 'release-a', release: { actualAmount: 900, allocations: [{ workerId: 'w', amount: 900 }, { workerId: 'zero', amount: 0 }], adjustmentApplications: [{ adjustmentId: candidate.adjustmentId, amount: -100, balanceVersion: candidate.balanceVersion, coverageVersion: candidate.coverageVersion }] } })
    expect((await f.service.execute(release)).outcome).toBe('released')
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBe(1900)
    expect((await f.service.adjustmentDetail({ origin: 'real' }, correction.adjustment.id)).balance.remainingDelta.value).toBe(0)
    expect(await f.service.aOutput({ origin: 'real' }, f.statementId)).toMatchObject({ state: 'available', document: { actualAmount: 1000 } })
    expect(await f.service.aOutput({ origin: 'real' }, saved.statementId!)).toMatchObject({ state: 'available', document: { actualAmount: 900, grossAmount: 900 } })
    await f.service.execute(release)
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBe(1900)
  }
  finally { await f.close() }
}, 30_000)
