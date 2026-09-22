import type { PayrollAdjustmentAction, PayrollAdjustmentFormRead, PayrollAdjustmentTarget } from '~/lib/payroll/central-adjustment-contract'
import { expect, it } from 'vitest'
import { createPayrollAAdjustmentFixture } from '../helpers/payroll-a-adjustment-fixture'
import { createPayrollAdjustmentFixture } from '../helpers/payroll-adjustment-service-fixture'

it('先存的草稿后确认时，后续更正与工资处理均采用唯一链末而非建稿顺序', async () => {
  const f = await createPayrollAdjustmentFixture()
  const query = { origin: 'real' as const }
  try {
    const frozen = await f.service.c2Output(query, f.statementId)
    async function save(target: PayrollAdjustmentTarget, unitRate: number, corrects?: string) {
      const initial = await f.service.adjustmentForm(query, { target })
      if (initial.draft.basis?.formatFamily !== 'C2')
        throw new Error('须读取真实原 C2 依据')
      const draft = { ...initial.draft, reason: '具名核对原签工价格', evidenceNote: '保存原核对依据', correctsAdjustmentId: corrects ?? initial.draft.correctsAdjustmentId, basis: { ...initial.draft.basis, unitRate } }
      const preview = await f.service.adjustmentForm(query, { target, draft })
      return f.service.executeAdjustment(f.adjustmentCommand(preview, { kind: 'save-adjustment-draft', draft }))
    }
    const early = await save({ adjustmentId: null, draftKey: 'saved-first', originalStatementId: f.statementId }, 940)
    const later = await save({ adjustmentId: null, draftKey: 'saved-second', originalStatementId: f.statementId }, 900)
    const confirm = async (adjustmentId: string) => f.service.executeAdjustment(f.adjustmentCommand(await f.service.adjustmentForm(query, { target: { adjustmentId } }), { kind: 'confirm-adjustment' }))
    await confirm(later.adjustmentId!)
    await save({ adjustmentId: early.adjustmentId! }, 940, later.adjustmentId!)
    await confirm(early.adjustmentId!)

    const next = await f.service.adjustmentForm(query, { target: { adjustmentId: null, draftKey: 'third-correction', originalStatementId: f.statementId } })
    expect(next.draft.correctsAdjustmentId).toBe(early.adjustmentId)
    expect(next.preview.beforeAmount.value).toBe(940)
    const final = await f.correct(950)
    expect(final.adjustment.delta).toBe(10)
    expect(final.balance.confirmedDelta.value).toBe(-50)
    expect(final.adjustment.snapshot?.correctsAdjustmentId).toBe(early.adjustmentId)
    expect((await f.service.actualLedger(query, { projectId: 'p' })).netAmount.value).toBe(1000)

    await f.daywork({ workDate: '2026-09-01', status: 'confirmed', witness: '次月证明', confirmedOn: '2026-09-02' })
    const nextDraft = { ...f.draft, month: '2026-09' }
    const wage = await f.service.executeC2(f.c2Command(await f.c2Form(nextDraft, 'next-wage'), { kind: 'save-c2-draft', draft: nextDraft }))
    const candidates = await f.service.releaseAdjustmentPreview(query, { statementId: wage.statementId! })
    expect(candidates.candidates).toEqual([expect.objectContaining({ adjustmentId: final.adjustment.id, rootAdjustmentId: later.adjustmentId, remainingAmount: -50 })])
    expect(await f.service.c2Output(query, f.statementId)).toMatchObject({ document: frozen.document })
  }
  finally { await f.close() }
}, 30_000)

it('a 逆序建稿按显式链根和链末核算，原减100再加40只在次月处理60', async () => {
  const f = await createPayrollAAdjustmentFixture()
  const query = { origin: 'real' as const }
  let sequence = 0
  const command = (read: PayrollAdjustmentFormRead, action: PayrollAdjustmentAction) => ({ commandId: `chain-a-${++sequence}`, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: read.context.sourceVersion, projectId: 'p', target: read.target, action })
  try {
    async function save(target: PayrollAdjustmentTarget, quantity: number, corrects?: string) {
      const initial = await f.service.adjustmentForm(query, { target })
      if (initial.draft.basis?.formatFamily !== 'A')
        throw new Error('须读取真实原 A 依据')
      const draft = { ...initial.draft, reason: '具名核对原施工量', evidenceNote: '保存原施工核对依据', correctsAdjustmentId: corrects ?? initial.draft.correctsAdjustmentId, basis: { ...initial.draft.basis, components: initial.draft.basis.components.map(component => ({ ...component, quantity })) } }
      return f.service.executeAdjustment(command(await f.service.adjustmentForm(query, { target, draft }), { kind: 'save-adjustment-draft', draft }))
    }
    const early = await save({ adjustmentId: null, draftKey: 'a-saved-first', originalStatementId: f.statementId }, 9.4)
    const later = await save({ adjustmentId: null, draftKey: 'a-saved-second', originalStatementId: f.statementId }, 9)
    const confirm = async (adjustmentId: string) => f.service.executeAdjustment(command(await f.service.adjustmentForm(query, { target: { adjustmentId } }), { kind: 'confirm-adjustment' }))
    await confirm(later.adjustmentId!)
    await save({ adjustmentId: early.adjustmentId! }, 9.4, later.adjustmentId!)
    await confirm(early.adjustmentId!)
    f.addNextWork()
    const draft = { ...f.draft, month: '2026-09', payRatio: 1 }
    const next = await f.form(draft, 'next-a-chain')
    expect(next.adjustmentReconciliation).toMatchObject({ effectiveCumulative: { value: 1940 }, actualNet: { value: 1000 }, availableAmount: { value: 940 }, coverage: [expect.objectContaining({ adjustmentId: early.adjustmentId, rootAdjustmentId: later.adjustmentId, dimensions: [expect.objectContaining({ before: 10, after: 9.4 })] })] })
    const saved = await f.service.execute(f.command(next, { kind: 'save-a-draft', draft }))
    const read = () => f.service.aForm(query, { statementId: saved.statementId! })
    await f.service.execute(f.command(await read(), { kind: 'check-a' }))
    const preview = await f.service.releaseAdjustmentPreview(query, { statementId: saved.statementId! })
    const candidate = preview.candidates[0]!
    expect(candidate).toMatchObject({ adjustmentId: early.adjustmentId, rootAdjustmentId: later.adjustmentId, eligible: true, remainingAmount: -60, embeddedInCalculation: 60, additionalWithholding: 0 })
    await f.service.execute(f.command(await read(), { kind: 'release-a', release: { actualAmount: 940, allocations: [{ workerId: 'w', amount: 940 }, { workerId: 'zero', amount: 0 }], adjustmentApplications: [{ adjustmentId: candidate.adjustmentId, amount: -60, balanceVersion: candidate.balanceVersion, coverageVersion: candidate.coverageVersion }] } }))
    expect((await f.service.actualLedger(query, { projectId: 'p' })).netAmount.value).toBe(1940)
    expect((await f.service.adjustmentDetail(query, early.adjustmentId!)).balance.remainingDelta.value).toBe(0)
    expect(await f.service.aOutput(query, f.statementId)).toMatchObject({ state: 'available', document: { actualAmount: 1000 } })
  }
  finally { await f.close() }
}, 30_000)

it('已有后续确认时，引用旧前序的草稿不能再确认成分叉', async () => {
  const f = await createPayrollAdjustmentFixture()
  const query = { origin: 'real' as const }
  try {
    const root = await f.correct(900)
    await f.correct(940)
    const target = { adjustmentId: null, draftKey: 'stale-branch', originalStatementId: f.statementId } as const
    const initial = await f.service.adjustmentForm(query, { target })
    if (initial.draft.basis?.formatFamily !== 'C2')
      throw new Error('须读取真实原 C2 依据')
    const draft = { ...initial.draft, correctsAdjustmentId: root.adjustment.id, reason: '另一次核对', evidenceNote: '先保存旧前序输入', basis: { ...initial.draft.basis, unitRate: 950 } }
    const saved = await f.service.executeAdjustment(f.adjustmentCommand(await f.service.adjustmentForm(query, { target, draft }), { kind: 'save-adjustment-draft', draft }))
    const read = await f.service.adjustmentForm(query, { target: { adjustmentId: saved.adjustmentId! } })
    expect(read.eligibility.canConfirmAdjustment).toBe(false)
    await expect(f.service.executeAdjustment(f.adjustmentCommand(read, { kind: 'confirm-adjustment' }))).rejects.toMatchObject({ problem: { code: 'validation-failed', commandOutcome: 'not-applied' } })
    expect((await f.service.adjustmentHistory(query, f.statementId)).adjustments.filter(item => item.adjustment.status === 'confirmed')).toHaveLength(2)
    expect((await f.service.adjustmentDetail(query, root.adjustment.id)).balance.confirmedDelta.value).toBe(-60)
  }
  finally { await f.close() }
}, 30_000)

it.each(['missing-predecessor', 'fork', 'cycle'] as const)('持久化确认链损坏为 %s 时，公开读取与继续确认均拒绝猜测链末', async (damage) => {
  const f = await createPayrollAdjustmentFixture()
  const query = { origin: 'real' as const }
  try {
    const root = await f.correct(900)
    await f.correct(940)
    const last = await f.correct(950)
    const target = { adjustmentId: null, draftKey: 'after-damaged-chain', originalStatementId: f.statementId } as const
    const initial = await f.service.adjustmentForm(query, { target })
    if (initial.draft.basis?.formatFamily !== 'C2')
      throw new Error('须读取真实原 C2 依据')
    const draft = { ...initial.draft, reason: '待确认的后续', evidenceNote: '具名核对依据', basis: { ...initial.draft.basis, unitRate: 960 } }
    const saved = await f.service.executeAdjustment(f.adjustmentCommand(await f.service.adjustmentForm(query, { target, draft }), { kind: 'save-adjustment-draft', draft }))
    const pending = f.adjustmentCommand(await f.service.adjustmentForm(query, { target: { adjustmentId: saved.adjustmentId! } }), { kind: 'confirm-adjustment' })
    const broken = damage === 'cycle' ? root.adjustment : last.adjustment
    const predecessor = damage === 'cycle' ? last.adjustment.id : damage === 'fork' ? root.adjustment.id : 'absent-confirmed-predecessor'
    await f.db.execute('UPDATE payroll_adjustments SET corrects_adjustment_id=?,confirmed_snapshot_json=? WHERE id=?', [predecessor, JSON.stringify({ ...broken.snapshot, correctsAdjustmentId: predecessor }), broken.id])
    await expect(f.service.adjustmentForm(query, { target })).rejects.toMatchObject({ problem: { code: 'unavailable', message: expect.stringContaining('确认链') } })
    await expect(f.service.executeAdjustment(pending)).rejects.toMatchObject({ problem: { code: 'unavailable', commandOutcome: 'not-applied' } })
    expect(await f.service.c2Output(query, f.statementId)).toMatchObject({ state: 'available', document: { actualAmount: 1000 } })
  }
  finally { await f.close() }
}, 30_000)
