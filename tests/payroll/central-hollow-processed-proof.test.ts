import { expect, it } from 'vitest'
import { payrollAAmount } from '../../app/lib/payroll/central-a-calculation'
import { calculatePayrollHollowTotals } from '../../app/lib/payroll/central-hollow-deduction-calculation'
import { provePayrollHollowFrozen } from '../../app/lib/payroll/central-hollow-deduction-provenance'
import { isPayrollHollowSnapshot } from '../../app/lib/payroll/central-hollow-deduction-snapshot'
import { createPayrollHollowFixture } from '../helpers/payroll-hollow-fixture'

async function fixture(twoConfirmations = false) {
  const f = await createPayrollHollowFixture()
  try {
    const saved = await f.service.execute(f.command(await f.form(), { kind: 'save-a-draft', draft: f.draft }))
    const originalId = saved.statementId!
    const form = () => f.service.aForm({ origin: 'real' }, { statementId: originalId })
    await f.service.executeHollow(f.startCommand((await form()).hollow!))
    await f.service.execute(f.command(await form(), { kind: 'check-a' }))
    await f.service.execute(f.command(await form(), { kind: 'release-a', release: { actualAmount: 550, allocations: [{ workerId: f.draft.leaderWorkerId, amount: 550 }] } }))
    const correct = async (unitAmount: number) => {
      const target = { adjustmentId: null, draftKey: `proof-correction-${unitAmount}`, originalStatementId: originalId } as const
      const initial = await f.service.adjustmentForm({ origin: 'real' }, { target })
      const draft = { ...initial.draft, reason: '复核原空鼓单处扣款金额', evidenceNote: '由原责任记录逐项核对当次扣款', basis: { ...initial.draft.basis!, hollow: { ...initial.draft.basis!.hollow!, components: initial.draft.basis!.hollow!.components.map(component => ({ ...component, unitAmount })) } } }
      const preview = await f.service.adjustmentForm({ origin: 'real' }, { target, draft })
      const common = { workspaceId: preview.context.workspaceId, actorId: preview.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, projectId: f.draft.projectId }
      const stored = await f.service.executeAdjustment({ ...common, commandId: `proof-save-${unitAmount}`, sourceVersion: preview.context.sourceVersion, target, action: { kind: 'save-adjustment-draft', draft } })
      const ready = await f.service.adjustmentForm({ origin: 'real' }, { target: { adjustmentId: stored.adjustmentId! } })
      const commandId = `proof-confirm-${unitAmount}`
      await f.service.executeAdjustment({ ...common, commandId, sourceVersion: ready.context.sourceVersion, target: ready.target, action: { kind: 'confirm-adjustment' } })
      return { adjustmentId: stored.adjustmentId!, commandId }
    }
    const ancestor = twoConfirmations ? await correct(35) : null
    const correction = await correct(40)
    const config = await f.service.aConfig({ origin: 'real' }, { projectId: f.draft.projectId, month: '2026-09', crewId: null, leaderWorkerId: f.draft.leaderWorkerId })
    await f.service.execute(f.command(config, { kind: 'save-a-prices', prices: [{ priceId: config.prices[0]!.priceId, itemId: f.target.itemId, unit: '㎡', mode: 'baseline', workerId: null, effectiveMonth: '2026-09', unitPrice: 300, scope: config.prices[0]!.scope }] }))
    const next = await f.form({ month: '2026-09' }, 'proof-later-payroll')
    expect(next.hollow?.totals.previousProcessed.value).toBe(600)
    expect(next.totals.grossAmount.value).toBe(50)
    const stored = await f.service.execute(f.command(next, { kind: 'save-a-draft', draft: { ...f.draft, month: '2026-09' } }))
    const statementId = stored.statementId!
    const later = () => f.service.aForm({ origin: 'real' }, { statementId })
    await f.service.execute(f.command(await later(), { kind: 'check-a' }))
    const candidate = (await f.service.releaseAdjustmentPreview({ origin: 'real' }, { statementId })).candidates.find(row => row.adjustmentId === correction.adjustmentId)!
    await f.service.execute(f.command(await later(), { kind: 'release-a', release: { actualAmount: 50, allocations: [{ workerId: f.draft.leaderWorkerId, amount: 50 }], adjustmentApplications: [{ adjustmentId: candidate.adjustmentId, amount: -150, balanceVersion: candidate.balanceVersion, coverageVersion: candidate.coverageVersion }] } }))
    const output = await f.service.aOutput({ origin: 'real' }, statementId)
    expect(output.state).toBe('available')
    if (output.state !== 'available' || !output.document.hollow)
      throw new Error('真实后月已发夹具须有冻结空鼓依据')
    return { ...f, originalId, statementId, correction, ancestor, correct, document: output.document, snapshot: output.document.hollow }
  }
  catch (cause) {
    await f.close()
    throw cause
  }
}

it('非作者复核：后月冻结的有效已处理金额和更正引用不能仅凭自洽数值证明', async () => {
  const f = await fixture()
  try {
    expect(await provePayrollHollowFrozen(f.db, f.snapshot, f.statementId)).toBe(true)
    const forged = structuredClone(f.snapshot)
    forged.previousProcessed[0]!.adjustmentIds = ['nonexistent-confirmed-correction']
    forged.previousProcessed[0]!.effectiveAmount = payrollAAmount([300])
    forged.totals = calculatePayrollHollowTotals({ formatFamily: 'A', claimSubtotal: forged.totals.claimSubtotal, currentDeduction: forged.totals.currentDeduction, previousProcessed: payrollAAmount([300]) })
    expect(isPayrollHollowSnapshot(forged)).toBe(true)
    expect(await provePayrollHollowFrozen(f.db, forged, f.statementId)).toBe(false)
  }
  finally { await f.close() }
}, 30_000)

it.each(['receipt', 'confirmation-log', 'ancestor-receipt', 'original-book'] as const)('非作者复核：后月已发50的原600更正依据缺损（%s）时冷输出必须不可用', async (damage) => {
  const f = await fixture(damage === 'ancestor-receipt')
  try {
    if (damage === 'confirmation-log')
      await f.db.execute('DELETE FROM operation_logs WHERE table_name=\'payroll_adjustments\' AND record_id=? AND action=\'update\'', [f.correction.adjustmentId])
    else if (damage === 'original-book')
      await f.db.execute('DELETE FROM payroll_a_statement_books WHERE statement_id=?', [f.originalId])
    else
      await f.db.execute('DELETE FROM payroll_command_receipts WHERE command_id=?', [damage === 'ancestor-receipt' ? f.ancestor!.commandId : f.correction.commandId])
    expect((await f.reloadPayroll().aOutput({ origin: 'real' }, f.statementId)).state).toBe('unavailable')
  }
  finally { await f.close() }
}, 30_000)

it('非作者复核：后续有效更正继续到750不得重写已发50使用的600原前缀', async () => {
  const f = await fixture()
  try {
    const [original] = await f.db.select<{ snapshot_json: string }>('SELECT snapshot_json FROM wage_statements WHERE id=?', [f.statementId])
    await f.correct(50)
    const output = await f.reloadPayroll().aOutput({ origin: 'real' }, f.statementId)
    expect(output).toMatchObject({ state: 'available', document: f.document })
    expect(output.document?.hollow?.previousProcessed[0]!.effectiveAmount.value).toBe(600)
    expect(await f.db.select('SELECT snapshot_json FROM wage_statements WHERE id=?', [f.statementId])).toEqual([original])
  }
  finally { await f.close() }
}, 30_000)
