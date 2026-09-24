import { expect, it } from 'vitest'
import { createPayrollHollowFixture } from '../helpers/payroll-hollow-fixture'

it('空鼓450更正为300只记应补150，真实补款后现金700且后月不重复领用', async () => {
  const f = await createPayrollHollowFixture()
  try {
    const saved = await f.service.execute(f.command(await f.form(), { kind: 'save-a-draft', draft: f.draft }))
    const statementId = saved.statementId!
    const form = () => f.service.aForm({ origin: 'real' }, { statementId })
    await f.service.executeHollow(f.startCommand((await form()).hollow!))
    await f.service.execute(f.command(await form(), { kind: 'check-a' }))
    await f.service.execute(f.command(await form(), { kind: 'release-a', release: { actualAmount: 550, allocations: [{ workerId: f.draft.leaderWorkerId, amount: 550 }] } }))
    const output = await f.service.aOutput({ origin: 'real' }, statementId)
    const target = { adjustmentId: null, draftKey: 'hollow-correct-10', originalStatementId: statementId } as const
    const initial = await f.service.adjustmentForm({ origin: 'real' }, { target })
    expect(initial.draft.basis?.hollow?.components).toHaveLength(1)
    const draft = { ...initial.draft, reason: '原处数复核应为10处，独立更正原扣款', evidenceNote: '核对原排查及发放记录，确认原15处有5处重复记录', basis: { ...initial.draft.basis!, hollow: { ...initial.draft.basis!.hollow!, components: initial.draft.basis!.hollow!.components.map(component => ({ ...component, count: 10 })) } } }
    const preview = await f.service.adjustmentForm({ origin: 'real' }, { target, draft })
    expect(preview.preview.delta.value).toBe(150)
    const common = { workspaceId: preview.context.workspaceId, actorId: preview.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, projectId: f.draft.projectId }
    const stored = await f.service.executeAdjustment({ ...common, commandId: 'hollow-correction-save', sourceVersion: preview.context.sourceVersion, target, action: { kind: 'save-adjustment-draft', draft } })
    const ready = await f.service.adjustmentForm({ origin: 'real' }, { target: { adjustmentId: stored.adjustmentId! } })
    await f.service.executeAdjustment({ ...common, commandId: 'hollow-correction-confirm', sourceVersion: ready.context.sourceVersion, target: ready.target, action: { kind: 'confirm-adjustment' } })
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: f.draft.projectId })).netAmount.value).toBe(550)
    const next = await f.form({ month: '2026-09' }, 'hollow-after-correction')
    expect(next.hollow?.totals.previousProcessed.value).toBe(300)
    expect(next.totals.grossAmount.value).toBe(150)
    const actualTarget = { kind: 'actual-payment', draftKey: 'hollow-real-supplement', adjustmentIds: [stored.adjustmentId!] } as const
    const actual = await f.service.actualPaymentForm({ origin: 'real' }, { target: actualTarget })
    const payment = { kind: 'supplement' as const, occurredOn: '2026-09-01', amount: 150, evidenceNote: '经办人实际补发并核对收款150元', allocations: [{ workerId: f.draft.leaderWorkerId, amount: 150 }], applications: [{ adjustmentId: stored.adjustmentId!, amount: 150, balanceVersion: actual.balances[0]!.balanceVersion }] }
    const actualPreview = await f.service.actualPaymentForm({ origin: 'real' }, { target: actualTarget, draft: payment })
    await f.service.executeAdjustment({ ...common, commandId: 'hollow-real-supplement-confirm', sourceVersion: actualPreview.context.sourceVersion, target: actualTarget, action: { kind: 'confirm-actual-payment', payment } })
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: f.draft.projectId })).netAmount.value).toBe(700)
    expect((await f.form({ month: '2026-09' }, 'hollow-after-cash')).totals.grossAmount.value).toBe(0)
    expect((await f.service.aOutput({ origin: 'real' }, statementId)).document).toEqual(output.document)
  }
  finally {
    await f.close()
  }
}, 30_000)

it('后月已含空鼓核减时须明确关联，实际少发50后原150余额不能再次退款', async () => {
  const f = await createPayrollHollowFixture()
  try {
    const saved = await f.service.execute(f.command(await f.form(), { kind: 'save-a-draft', draft: f.draft }))
    const statementId = saved.statementId!
    const form = () => f.service.aForm({ origin: 'real' }, { statementId })
    await f.service.executeHollow(f.startCommand((await form()).hollow!))
    await f.service.execute(f.command(await form(), { kind: 'check-a' }))
    await f.service.execute(f.command(await form(), { kind: 'release-a', release: { actualAmount: 550, allocations: [{ workerId: f.draft.leaderWorkerId, amount: 550 }] } }))
    const target = { adjustmentId: null, draftKey: 'hollow-correct-rate40', originalStatementId: statementId } as const
    const initial = await f.service.adjustmentForm({ origin: 'real' }, { target })
    const draft = { ...initial.draft, reason: '原空鼓单处金额应为40元，独立核对差额', evidenceNote: '原扣款单价填报有误，经办人核实原记录', basis: { ...initial.draft.basis!, hollow: { ...initial.draft.basis!.hollow!, components: initial.draft.basis!.hollow!.components.map(component => ({ ...component, unitAmount: 40 })) } } }
    const preview = await f.service.adjustmentForm({ origin: 'real' }, { target, draft })
    expect(preview.preview.delta.value).toBe(-150)
    const common = { workspaceId: preview.context.workspaceId, actorId: preview.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, projectId: f.draft.projectId }
    const stored = await f.service.executeAdjustment({ ...common, commandId: 'hollow-rate40-save', sourceVersion: preview.context.sourceVersion, target, action: { kind: 'save-adjustment-draft', draft } })
    const ready = await f.service.adjustmentForm({ origin: 'real' }, { target: { adjustmentId: stored.adjustmentId! } })
    await f.service.executeAdjustment({ ...common, commandId: 'hollow-rate40-confirm', sourceVersion: ready.context.sourceVersion, target: ready.target, action: { kind: 'confirm-adjustment' } })
    const price = await f.service.aConfig({ origin: 'real' }, { projectId: f.draft.projectId, month: '2026-09', crewId: f.draft.crewId, leaderWorkerId: f.draft.leaderWorkerId })
    await f.service.execute(f.command(price, { kind: 'save-a-prices', prices: [{ priceId: price.prices[0]!.priceId, itemId: f.target.itemId, unit: '㎡', mode: 'baseline', workerId: null, effectiveMonth: '2026-09', unitPrice: 300, scope: price.prices[0]!.scope }] }))
    const next = await f.form({ month: '2026-09' }, 'hollow-later-wage')
    expect(next.totals.cumulativeAmount.value).toBe(1200)
    expect(next.hollow?.totals.previousProcessed.value).toBe(600)
    expect(next.totals.grossAmount.value).toBe(50)
    const storedNext = await f.service.execute(f.command(next, { kind: 'save-a-draft', draft: { ...f.draft, month: '2026-09' } }))
    const nextForm = () => f.service.aForm({ origin: 'real' }, { statementId: storedNext.statementId! })
    await f.service.execute(f.command(await nextForm(), { kind: 'check-a' }))
    const checked = await nextForm()
    await expect(f.service.execute(f.command(checked, { kind: 'release-a', release: { actualAmount: 50, allocations: [{ workerId: f.draft.leaderWorkerId, amount: 50 }] } }))).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    const applications = await f.service.releaseAdjustmentPreview({ origin: 'real' }, { statementId: storedNext.statementId! })
    const candidate = applications.candidates.find(candidate => candidate.adjustmentId === stored.adjustmentId)!
    expect(candidate).toMatchObject({ eligible: true, remainingAmount: -150, embeddedInCalculation: 150, additionalWithholding: 0 })
    await f.service.execute(f.command(await nextForm(), { kind: 'release-a', release: { actualAmount: 50, allocations: [{ workerId: f.draft.leaderWorkerId, amount: 50 }], adjustmentApplications: [{ adjustmentId: candidate.adjustmentId, amount: -150, balanceVersion: candidate.balanceVersion, coverageVersion: candidate.coverageVersion }] } }))
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: f.draft.projectId })).netAmount.value).toBe(600)
    expect((await f.service.adjustmentDetail({ origin: 'real' }, stored.adjustmentId!)).balance.remainingDelta.value).toBe(0)
    expect((await f.form({ month: '2026-10' }, 'hollow-after-later-release')).totals.grossAmount.value).toBe(0)
  }
  finally {
    await f.close()
  }
}, 30_000)
