import type { PayrollAFeeQuantityComponent, PayrollAStatementSourceSnapshotV2 } from '~/lib/payroll/central-a-fees-contract'
import type { PayrollAAdjustmentBasis } from '~/lib/payroll/central-adjustment-contract'
import { describe, expect, it } from 'vitest'
import { hasPayrollAFeesForm } from '~/lib/payroll/central-a-fees-contract'
import { payrollCorrectionAmount } from '~/lib/payroll/central-adjustment-calculation'
import { payrollCorrectionReasons } from '~/lib/payroll/central-adjustment-validation'
import { createPayrollAFeeAdjustmentFixture } from '../helpers/payroll-a-fee-adjustment-fixture'
import { payrollAFact } from '../helpers/payroll-a-service-fixture'

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

/** 只验证独立更正的运算；不冒充已发冻结或服务证明。 */
function basis(management = false): PayrollAAdjustmentBasis {
  const fact = payrollAFact({ fieldQty: 100 })
  const component: PayrollAFeeQuantityComponent = { componentKey: 'fee:original', feeId: 'fee', feeRevisionId: 'fee-r1', ownershipKey: fact.ownershipKey, managementOwnership: null, fact, quantity: 100, unitPrice: management ? 15 : 1.3, amountFen: management ? 150000 : 13000 }
  const amount = { value: 0, knownValue: 0, state: 'known' as const, reasons: [] }
  const book = management ? { bookPurpose: 'management' as const, managementBookId: 'book' } : { bookPurpose: 'ordinary' as const, managementBookId: null }
  const source: PayrollAStatementSourceSnapshotV2 = { schemaVersion: 2, book, subject: { projectId: 'p', crewId: 'crew', leaderWorkerId: 'w' }, facts: [fact], priceRevisions: [], fees: { schemaVersion: 1, configSourceVersion: 'fees-v1', crewDefaults: null, feeRevisions: [], management: null, managementOwnership: [], negativeLines: [], lines: [{ id: 'fee-line', kind: management ? 'management' : 'housing', feeId: 'fee', feeRevisionIds: ['fee-r1'], name: '原费用', buildingId: fact.buildingId, buildingName: fact.buildingName, itemId: fact.itemId, itemName: fact.itemName, unit: fact.unit, quantity: 100, knownQuantity: 100, amount, components: [component], sources: [], blockers: [] }], totals: { workAmount: amount, subsidyAmount: amount, managementAmount: amount, negativeAmount: amount, listAmount: amount, cumulativeAmount: amount, previouslyPaid: amount, grossAmount: amount } } }
  return { formatFamily: 'A', periodKind: 'monthly', source, payRatio: management ? 0.8 : 1, components: management ? [] : [{ ownershipKey: fact.ownershipKey, priceRevisionId: 'price-r1', quantity: 100, unitPrice: 36 }], fees: { schemaVersion: 1, book, components: [{ componentKey: component.componentKey, feeId: component.feeId, feeRevisionId: component.feeRevisionId, ownershipKey: component.ownershipKey, quantity: component.quantity, unitPrice: component.unitPrice }], negativeLines: [] } }
}

describe('a 费用独立更正计算', () => {
  it.each([
    { quantity: 100, payRatio: 1, expected: 3730 },
    { quantity: 90, payRatio: 1, expected: 3717 },
    { quantity: 90, payRatio: 0.8, expected: 2973.6 },
  ])('普通工资与独立住房补贴按数量 $quantity、比例 $payRatio 核算 $expected', ({ quantity, payRatio, expected }) => {
    const draft = basis()
    draft.fees!.components[0]!.quantity = quantity
    draft.payRatio = payRatio
    expect(payrollCorrectionAmount(draft).value).toBe(expected)
  })

  it.each([
    { quantity: 30, expected: 720 },
    { quantity: 20, expected: 880 },
  ])('1500管理清单加 $quantity 套×-20后乘80%=$expected，负价不二次扣除', ({ quantity, expected }) => {
    const draft = basis(true)
    draft.fees!.negativeLines.push({ lineId: 'negative', originalNegativeRevisionId: 'negative-r1', label: '未收尾代付', quantity, unit: '套', unitPrice: -20, scope: { assignments: [{ assignmentId: 'assignment', scopeIds: ['scope'], cells: [{ unitId: 'u', roomId: 'r', itemId: 'item' }] }] }, reason: '明确未收尾范围', evidenceNote: '负责人复核记录', actualRef: null })
    expect(payrollCorrectionAmount(draft).value).toBe(expected)
  })

  it('同费用同楼栋同分项同价先汇总数量，两个0.005只结算0.01', () => {
    const draft = basis()
    draft.components = []
    const first = draft.source.schemaVersion === 2 && draft.source.fees.lines[0]!
    if (!first)
      throw new Error('需要费用行')
    first.components[0]!.quantity = 0.5
    first.components[0]!.unitPrice = 0.01
    first.components.push({ ...structuredClone(first.components[0]!), componentKey: 'fee:second', ownershipKey: 'second', fact: payrollAFact({ ownershipKey: 'second', fieldQty: 0.5 }) })
    draft.fees!.components = first.components.map(c => ({ componentKey: c.componentKey, feeId: c.feeId, feeRevisionId: c.feeRevisionId, ownershipKey: c.ownershipKey, quantity: c.quantity, unitPrice: c.unitPrice }))
    expect(payrollCorrectionAmount(draft).value).toBe(0.01)
  })

  it.each([
    { case: 'v2缺费用', change: (draft: PayrollAAdjustmentBasis) => Reflect.deleteProperty(draft, 'fees') },
    { case: '费用量未知', change: (draft: PayrollAAdjustmentBasis) => { draft.fees!.components[0]!.quantity = null } },
  ])('$case 不能降级成只算普通工资或已知量', ({ change }) => {
    const draft = basis()
    change(draft)
    expect(payrollCorrectionAmount(draft).value).toBeNull()
  })

  it.each([
    { case: '替换费项', change: (draft: PayrollAAdjustmentBasis) => { draft.fees!.components[0]!.feeId = 'other-fee' } },
    { case: '移除费项', change: (draft: PayrollAAdjustmentBasis) => { draft.fees!.components = [] } },
    { case: '更换账簿', change: (draft: PayrollAAdjustmentBasis) => { draft.fees!.book = { bookPurpose: 'management', managementBookId: 'other-book' } } },
  ])('更正不能借 $case 转移原来源', ({ change }) => {
    const original = basis()
    const draft = structuredClone(original)
    change(draft)
    expect(payrollCorrectionReasons(draft, original).length).toBeGreaterThan(0)
  })
})
