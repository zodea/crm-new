import { expect, it } from 'vitest'
import { hasPayrollAFeesForm } from '~/lib/payroll/central-a-fees-contract'
import { createPayrollAFeeAdjustmentFixture } from '../helpers/payroll-a-fee-adjustment-fixture'

it.each([false, true])('补贴更正来源同步=%s，退款后不能重新领原30，原签名3730不改', async (sourceCorrected) => {
  const f = await createPayrollAFeeAdjustmentFixture()
  try {
    const id = await f.ordinaryStatement()
    const correction = await f.correct(id, (basis) => {
      basis.fees!.components[0]!.unitPrice = 1
    })
    expect(correction.adjustment.delta).toBe(-30)
    if (sourceCorrected) {
      const previous = (await f.feeConfig()).fees[0]!
      await f.saveFees([f.fee({ feeId: previous.feeId, baseRevisionId: previous.id, unitPrice: 1, effectiveMonth: '2026-09' })], f.ordinary, '2026-09')
    }
    await f.pay(correction.adjustment.id, -30)
    const next = await f.form({ month: '2026-09', book: f.ordinary, payRatio: 1 }, 'next-fee')
    expect(next.adjustmentReconciliation).toMatchObject({ effectiveCumulative: { value: 3700 }, actualNet: { value: 3700 }, availableAmount: { value: 0 } })
    expect(next.totals.grossAmount.value).toBe(0)
    expect(await f.service.aOutput({ origin: 'real' }, id)).toMatchObject({ state: 'available', document: { actualAmount: 3730 } })
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBe(3700)
  }
  finally { await f.close() }
}, 30_000)

it('后来费用单价变成第三个值时不能以总额近似认作已含原更正', async () => {
  const f = await createPayrollAFeeAdjustmentFixture()
  try {
    const id = await f.ordinaryStatement()
    await f.correct(id, (basis) => {
      basis.fees!.components[0]!.unitPrice = 1
    })
    const previous = (await f.feeConfig()).fees[0]!
    await f.saveFees([f.fee({ feeId: previous.feeId, baseRevisionId: previous.id, unitPrice: 1.2, effectiveMonth: '2026-09' })], f.ordinary, '2026-09')
    const next = await f.form({ month: '2026-09', book: f.ordinary, payRatio: 1 }, 'changed-fee')
    expect(next.adjustmentReconciliation?.coverage[0]?.dimensions[0]).toMatchObject({ dimension: 'fee-unit-price', before: 1.3, after: 1, current: 1.2, state: 'unproven' })
    expect(next.eligibility.canCheck).toBe(false)
    expect(next.totals.grossAmount.value).toBeNull()
  }
  finally { await f.close() }
}, 30_000)

it.each([false, true])('后月已含补贴核减，来源同步=%s时真实少发只处理30一次', async (sourceCorrected) => {
  const f = await createPayrollAFeeAdjustmentFixture()
  try {
    const id = await f.ordinaryStatement()
    const correction = await f.correct(id, (basis) => {
      basis.fees!.components[0]!.unitPrice = 1
    })
    if (sourceCorrected) {
      const previous = (await f.feeConfig()).fees[0]!
      await f.saveFees([f.fee({ feeId: previous.feeId, baseRevisionId: previous.id, unitPrice: 1, effectiveMonth: '2026-09' })], f.ordinary, '2026-09')
    }
    await f.addNextWork()
    const draft = { ...f.draft, month: '2026-09', book: f.ordinary, payRatio: 1 }
    const saved = await f.service.execute(f.command(await f.form(draft, 'next-fee-work'), { kind: 'save-a-draft', draft }))
    const read = () => f.service.aForm({ origin: 'real' }, { statementId: saved.statementId! })
    expect((await read()).totals.grossAmount.value).toBe(sourceCorrected ? 3670 : 3700)
    await f.service.execute(f.command(await read(), { kind: 'check-a' }))
    const preview = await f.service.releaseAdjustmentPreview({ origin: 'real' }, { statementId: saved.statementId! })
    const candidate = preview.candidates[0]!
    expect(candidate).toMatchObject({ eligible: true, embeddedInCalculation: 30, additionalWithholding: 0 })
    const amount = sourceCorrected ? 3670 : 3700
    await f.service.execute(f.command(await read(), { kind: 'release-a', release: { actualAmount: amount, allocations: [{ workerId: 'w', amount }, { workerId: 'zero', amount: 0 }], adjustmentApplications: [{ adjustmentId: candidate.adjustmentId, amount: -30, balanceVersion: candidate.balanceVersion, coverageVersion: candidate.coverageVersion }] } }))
    expect((await f.service.adjustmentDetail({ origin: 'real' }, correction.adjustment.id)).balance.remainingDelta.value).toBe(0)
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBe(3730 + amount)
    expect((await f.service.aOutput({ origin: 'real' }, saved.statementId!)).state).toBe('available')
  }
  finally { await f.close() }
}, 30_000)

it('同人普通簿和管理簿不能合并退款；管理负价更正只影响原簿后月', async () => {
  const f = await createPayrollAFeeAdjustmentFixture()
  try {
    const ordinary = await f.ordinaryStatement()
    const ordinaryCorrection = await f.correct(ordinary, (basis) => {
      basis.fees!.components[0]!.unitPrice = 1
    })
    const m = await f.management()
    const start = await m.start()
    const read = await f.service.aForm({ origin: 'real' }, { statementId: start.statementId! })
    expect(read.totals.previouslyPaid.value).toBe(0)
    if (!hasPayrollAFeesForm(read))
      throw new Error('缺少管理负价来源')
    const showerScope = { assignments: m.scope.assignments.map(a => ({ ...a, cells: a.cells.filter(c => c.itemId === 'shower') })).filter(a => a.cells.length) }
    await f.service.executeFees(f.feeCommand(read, { kind: 'save-a-negative-lines', baseVersion: read.context.sourceVersion, lines: [{ lineId: null, baseRevisionId: null, label: '明确未收尾代付', quantity: 2, unit: '套', unitPrice: -20, scope: showerScope, reason: '原范围代付', evidenceNote: '经办核实二套', actualRef: null }], remove: [] }))
    await f.release(start.statementId!, 268)
    const managementCorrection = await f.correct(start.statementId!, (basis) => {
      basis.fees!.negativeLines[0]!.quantity = 3
    })
    expect(managementCorrection.adjustment.delta).toBe(-16)
    await expect(f.service.actualPaymentForm({ origin: 'real' }, { target: { kind: 'actual-payment', draftKey: 'cross-book-refund', adjustmentIds: [ordinaryCorrection.adjustment.id, managementCorrection.adjustment.id] } })).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
    await f.pay(managementCorrection.adjustment.id, -16)
    const next = await m.start('2026-09')
    const later = await f.service.aForm({ origin: 'real' }, { statementId: next.statementId! })
    expect(later.adjustmentReconciliation).toMatchObject({ effectiveCumulative: { value: 252 }, actualNet: { value: 252 }, availableAmount: { value: 0 } })
    expect((await f.service.releaseAdjustmentPreview({ origin: 'real' }, { statementId: next.statementId! })).candidates.some(c => c.adjustmentId === ordinaryCorrection.adjustment.id)).toBe(false)
    expect(await f.service.aOutput({ origin: 'real' }, start.statementId!)).toMatchObject({ state: 'available', document: { actualAmount: 268 } })
  }
  finally { await f.close() }
}, 30_000)
