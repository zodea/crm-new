import type { PayrollAdjustmentAction, PayrollAdjustmentFormRead } from '~/lib/payroll/central-adjustment-contract'
import { expect, it } from 'vitest'
import { createPayrollC1ServiceFixture } from '../helpers/payroll-c1-service-fixture'

it.each(['refund', 'later-release'])('c1 更正按 %s 处理，保留逐日及个人费率依据与原成员月锁', async (handling) => {
  const f = await createPayrollC1ServiceFixture()
  try {
    f.source.workers.find(w => w.id === 'w')!.dailyWage = 1000
    await f.service.executeC1(f.command(await f.config(), { kind: 'save-c1-rates', rates: [{ workerId: 'w', dailyWage: 1000, overtimeRate: null }, { workerId: 'member', dailyWage: 0, overtimeRate: null }, { workerId: 'zero', dailyWage: 0, overtimeRate: null }] }))
    await f.attendance({ overtimeHours: 0 })
    const saved = await f.service.executeC1(f.command(await f.form(), { kind: 'save-c1-draft', draft: f.draft }))
    const statementId = saved.statementId!
    const read = () => f.service.c1Form({ origin: 'real' }, { statementId })
    await f.service.executeC1(f.command(await read(), { kind: 'check-c1' }))
    await f.service.executeC1(f.command(await read(), { kind: 'release-c1', release: { actualAmount: 1000, allocations: [{ workerId: 'w', amount: 1000 }, { workerId: 'member', amount: 0 }, { workerId: 'zero', amount: 0 }] } }))
    const original = await f.service.c1Output({ origin: 'real' }, statementId)
    const target = { adjustmentId: null, draftKey: 'c1-correction', originalStatementId: statementId } as const
    const initial = await f.service.adjustmentForm({ origin: 'real' }, { target })
    expect(initial.draft.basis?.formatFamily).toBe('C1')
    if (initial.draft.basis?.formatFamily !== 'C1')
      throw new Error('应取得 C1 原逐日与费率依据')
    const draft = { ...initial.draft, reason: '原约定日薪误录', evidenceNote: '经办人与本人核对原约定日薪900，逐日考勤无误', basis: { ...initial.draft.basis, rates: initial.draft.basis.rates.map(r => ({ ...r, dailyWage: r.workerId === 'w' ? 900 : r.dailyWage })) } }
    let sequence = 0
    const command = (read: PayrollAdjustmentFormRead, action: PayrollAdjustmentAction) => ({ commandId: `c1-adjustment-${++sequence}`, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: read.context.sourceVersion, projectId: 'p', target: read.target, action })
    const preview = await f.service.adjustmentForm({ origin: 'real' }, { target, draft })
    expect(preview.preview.delta.value).toBe(-100)
    const adjustment = await f.service.executeAdjustment(command(preview, { kind: 'save-adjustment-draft', draft }))
    await f.service.executeAdjustment(command(await f.service.adjustmentForm({ origin: 'real' }, { target: { adjustmentId: adjustment.adjustmentId! } }), { kind: 'confirm-adjustment' }))
    if (handling === 'later-release') {
      const scope = { ...f.scope, month: '2026-09' }
      const attendance = { workerId: 'w', crewId: 'crew', workDate: '2026-09-01', hours: 8, overtimeHours: 0, workContent: '次月现场施工', note: '' }
      await f.service.executeAttendance(f.attendanceCommand(await f.service.attendanceMatrix({ origin: 'real' }, scope), attendance))
      const nextDraft = { ...f.draft, month: '2026-09' }
      const next = await f.service.executeC1(f.command(await f.form(nextDraft, 'c1-next'), { kind: 'save-c1-draft', draft: nextDraft }))
      const nextRead = () => f.service.c1Form({ origin: 'real' }, { statementId: next.statementId! })
      await f.service.executeC1(f.command(await nextRead(), { kind: 'check-c1' }))
      const preview = await f.service.releaseAdjustmentPreview({ origin: 'real' }, { statementId: next.statementId! })
      const candidate = preview.candidates[0]!
      expect(candidate).toMatchObject({ remainingAmount: -100, embeddedInCalculation: 0, additionalWithholding: 100, eligible: true })
      const release = f.command(await nextRead(), { kind: 'release-c1', release: { actualAmount: 900, allocations: [{ workerId: 'w', amount: 900 }, { workerId: 'member', amount: 0 }, { workerId: 'zero', amount: 0 }], adjustmentApplications: [{ adjustmentId: candidate.adjustmentId, amount: -100, balanceVersion: candidate.balanceVersion, coverageVersion: candidate.coverageVersion }] } })
      expect((await f.service.executeC1(release)).outcome).toBe('released')
      expect((await f.service.adjustmentDetail({ origin: 'real' }, adjustment.adjustmentId!)).balance.remainingDelta.value).toBe(0)
      expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBe(1900)
      expect(await f.service.c1Output({ origin: 'real' }, next.statementId!)).toMatchObject({ state: 'available', document: { actualAmount: 900, grossAmount: 1000 } })
    }
    else {
      const paymentTarget = { kind: 'actual-payment' as const, draftKey: 'c1-refund', adjustmentIds: [adjustment.adjustmentId!] }
      const form = await f.service.actualPaymentForm({ origin: 'real' }, { target: paymentTarget })
      const payment = { kind: 'refund' as const, occurredOn: '2026-08-08', amount: -100, evidenceNote: '本人已实际退回100元', allocations: [{ workerId: 'w', amount: -100 }], applications: [{ adjustmentId: adjustment.adjustmentId!, amount: -100, balanceVersion: form.balances[0]!.balanceVersion }] }
      const actual = await f.service.actualPaymentForm({ origin: 'real' }, { target: paymentTarget, draft: payment })
      await f.service.executeAdjustment({ commandId: 'c1-real-refund', workspaceId: actual.context.workspaceId, actorId: actual.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: actual.context.sourceVersion, projectId: 'p', target: paymentTarget, action: { kind: 'confirm-actual-payment', payment } })
      expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBe(900)
    }
    expect(await f.service.c1Output({ origin: 'real' }, statementId)).toMatchObject({ state: 'available', document: original.document })
    await expect(f.attendance({ hours: 7 })).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
  }
  finally { await f.close() }
}, 30_000)
