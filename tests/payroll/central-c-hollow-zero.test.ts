import { expect, it } from 'vitest'
import { decodePayrollC1Read, encodePayrollC1Wire, isPayrollC1FrozenDocument } from '../../app/lib/payroll/central-c1-codec'
import { decodePayrollC2Read, encodePayrollC2Wire, isPayrollC2FrozenDocument } from '../../app/lib/payroll/central-c2-codec'
import { createPayrollCHollowFixture } from '../helpers/payroll-c-hollow-fixture'

async function openStatement(f: Awaited<ReturnType<typeof createPayrollCHollowFixture>>, format: 'C1' | 'C2', amount: number) {
  if (format === 'C1') {
    const attendance = await f.service.attendanceMatrix({ origin: 'real' }, { projectId: f.draft.projectId, crewId: null, month: f.draft.month })
    await f.service.executeAttendance({ commandId: 'hollow-zero-attendance', workspaceId: attendance.context.workspaceId, actorId: attendance.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: attendance.context.sourceVersion, projectId: f.draft.projectId, scope: attendance.scope, action: { kind: 'upsert-attendance', record: { workerId: f.draft.leaderWorkerId, crewId: null, workDate: '2026-08-01', hours: amount / 125, overtimeHours: 0, workContent: '实际工时工资与扣款相抵', note: '' } } })
    const initial = await f.service.c1Form({ origin: 'real' }, { statementId: null, draftKey: 'hollow-zero-c1', draft: f.draft })
    const saved = await f.service.executeC1(f.c1Command(initial, { kind: 'save-c1-draft', draft: f.draft }))
    const statementId = saved.statementId!
    const form = () => f.service.c1Form({ origin: 'real' }, { statementId })
    return { statementId, form, check: async () => f.service.executeC1(f.c1Command(await form(), { kind: 'check-c1' })), release: async () => f.service.executeC1(f.c1Command(await form(), { kind: 'release-c1', release: { actualAmount: 0, allocations: [{ workerId: f.draft.leaderWorkerId, amount: 0 }] } })) }
  }
  const config = await f.service.c2Config({ origin: 'real' }, { projectId: f.draft.projectId, leaderWorkerId: f.draft.leaderWorkerId })
  await f.service.executeC2(f.c2Command(config, { kind: 'save-c2-config', config: { crewId: null, unitRate: amount, ruleText: `每工${amount}元` } }))
  const initial = await f.service.c2Form({ origin: 'real' }, { statementId: null, draftKey: 'hollow-zero-c2', draft: f.draft })
  const saved = await f.service.executeC2(f.c2Command(initial, { kind: 'save-c2-draft', draft: f.draft }))
  const statementId = saved.statementId!
  const form = () => f.service.c2Form({ origin: 'real' }, { statementId })
  return { statementId, form, check: async () => f.service.executeC2(f.c2Command(await form(), { kind: 'check-c2' })), release: async () => f.service.executeC2(f.c2Command(await form(), { kind: 'release-c2', release: { actualAmount: 0, allocations: [{ workerId: f.draft.leaderWorkerId, amount: 0 }] } })) }
}

it.each(['C1', 'C2'] as const)('%s真实工资450完整扣款450可明确实发0，保冻结与采用且现金为0', async (format) => {
  const f = await createPayrollCHollowFixture(format)
  try {
    const statement = await openStatement(f, format, 450)
    expect((await statement.form()).totals.grossAmount.value).toBe(450)
    await f.service.executeHollow(f.startCommand((await statement.form()).hollow!))
    await statement.check()
    const checked = await statement.form()
    expect(checked.totals.grossAmount.value).toBe(0)
    expect(checked.eligibility.canRelease).toBe(true)
    expect((await statement.release()).outcome).toBe('released')
    const output = format === 'C1' ? await f.reloadPayroll().c1Output({ origin: 'real' }, statement.statementId) : await f.reloadPayroll().c2Output({ origin: 'real' }, statement.statementId)
    expect(output.state).toBe('available')
    if (output.state !== 'available')
      throw new Error(output.reasons.join('; '))
    expect(output.document.actualAmount).toBe(0)
    expect(output.document.hollow?.adoptions).toHaveLength(1)
    expect(output.document.hollow?.totals.currentDeduction.value).toBe(450)
    expect(format === 'C1' ? decodePayrollC1Read(encodePayrollC1Wire(output), 'output', { origin: 'real' }, statement.statementId) : decodePayrollC2Read(encodePayrollC2Wire(output), 'output', { origin: 'real' }, statement.statementId)).toEqual(output)
    expect(format === 'C1' ? isPayrollC1FrozenDocument({ ...output.document, hollow: undefined }) : isPayrollC2FrozenDocument({ ...output.document, hollow: undefined })).toBe(false)
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: f.draft.projectId })).netAmount.value).toBe(0)
    expect(await f.db.select('SELECT actual_amount,gross_amount FROM wage_statements WHERE id=?', [statement.statementId])).toEqual([{ actual_amount: 0, gross_amount: 0 }])
    expect((await statement.form()).hollow?.snapshot?.adoptions).toHaveLength(1)
  }
  finally { await f.close() }
}, 30_000)

it.each(['C1', 'C2'] as const)('%s未启动空鼓的原工资仍拒绝实发0，不生成采用', async (format) => {
  const f = await createPayrollCHollowFixture(format)
  try {
    const statement = await openStatement(f, format, 1000)
    await statement.check()
    expect((await statement.form()).totals.grossAmount.value).toBe(1000)
    await expect(statement.release()).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect(await f.db.select('SELECT * FROM payroll_hollow_adoptions')).toEqual([])
    expect(await f.db.select('SELECT status FROM wage_statements WHERE id=?', [statement.statementId])).toEqual([{ status: 'checked' }])
  }
  finally { await f.close() }
}, 30_000)
