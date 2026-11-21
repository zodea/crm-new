import { expect, it } from 'vitest'
import { createPayrollC1ServiceFixture } from '../helpers/payroll-c1-service-fixture'
import { createCheckedPayrollC2, createPayrollC2ServiceFixture } from '../helpers/payroll-c2-service-fixture'

it('纯时工项目无需工程量，逐人工资与未舍入的默认加班价来自真实考勤', async () => {
  const f = await createPayrollC1ServiceFixture()
  try {
    expect((await f.matrix()).workers.map(w => w.id)).toEqual(expect.arrayContaining(['w', 'member', 'zero']))
    expect((await f.matrix()).workers.map(w => w.id)).toContain('outside')
    expect((await f.form({ leaderWorkerId: 'outside', memberWorkerIds: ['outside'] }, 'global-candidate-without-facts')).eligibility.canSaveDraft).toBe(false)
    expect((await f.form()).eligibility.canSaveDraft).toBe(false)
    await f.attendance()
    await f.attendance({ workerId: 'member', workDate: '2026-08-02', hours: 7.5, overtimeHours: 0 })
    const read = await f.form()
    expect(read.rates.find(r => r.workerId === 'w')).toMatchObject({ dailyWage: 481, overtimeRate: 60.125, overtimeRateSource: 'daily-divided-eight' })
    expect(read.lines.filter(l => l.workerId === 'w').map(l => l.amount)).toEqual([481, 120.25])
    expect(read.lines.find(l => l.workerId === 'member' && l.kind === 'normal')?.amount).toBe(450)
    expect(read.lines.filter(l => l.workerId === 'zero').map(l => [l.quantity, l.amount])).toEqual([[0, 0], [0, 0]])
    expect(read.totals.grossAmount.value).toBe(1051.25)
    await f.service.executeC1(f.command(await f.config(), { kind: 'save-c1-rates', rates: [{ workerId: 'w', dailyWage: 999, overtimeRate: 55 }] }))
    const configured = await f.form()
    expect(configured.rates.find(r => r.workerId === 'w')).toMatchObject({ profileDailyWage: 481, configuredDailyWage: 999, configuredOvertimeRate: 55, dailyWage: 481, overtimeRate: 55 })
    expect(configured.totals.grossAmount.value).toBe(1041)
    const saved = await f.service.executeC1(f.command(configured, { kind: 'save-c1-draft', draft: f.draft }))
    const stored = await f.service.c1Form({ origin: 'real' }, { statementId: saved.statementId! })
    expect(stored.status).toBe('draft')
    expect(stored.facts).toHaveLength(2)
    expect(stored.draft).not.toHaveProperty('payRatio')
  }
  finally { await f.close() }
})

it('没有记录不能造空单，真实零可以保存核对但不能发放，缺个人标准保持未知', async () => {
  const f = await createPayrollC1ServiceFixture()
  try {
    await expect(f.service.executeC1(f.command(await f.form(), { kind: 'save-c1-draft', draft: f.draft }))).rejects.toThrow('所选成员当月没有真实考勤，不能生成空工资')
    await f.attendance({ hours: 0, overtimeHours: 0 })
    const read = await f.form()
    expect(read.totals.grossAmount.value).toBe(0)
    expect(read.eligibility.canSaveDraft).toBe(true)
    const saved = await f.service.executeC1(f.command(read, { kind: 'save-c1-draft', draft: f.draft }))
    const form = await f.service.c1Form({ origin: 'real' }, { statementId: saved.statementId! })
    await f.service.executeC1(f.command(form, { kind: 'check-c1' }))
    expect((await f.service.c1Form({ origin: 'real' }, { statementId: saved.statementId! })).eligibility.canRelease).toBe(false)
    await f.attendance({ workerId: 'unknown', hours: 7.51, overtimeHours: 0 })
    const missing = await f.form({ leaderWorkerId: 'unknown', memberWorkerIds: ['unknown'] }, 'missing')
    expect(missing.rates[0]?.dailyWage).toBeNull()
    expect(missing.lines[0]?.quantity).toBe(7.51)
    expect(missing.totals.grossAmount.value).toBeNull()
  }
  finally { await f.close() }
})

it('未发软删坏来源保诊断不阻新单，个人标准审计坏正文仍保原文', async () => {
  const f = await createPayrollC1ServiceFixture()
  try {
    const old = await f.attendance()
    await f.db.execute('UPDATE attendance_records SET work_date=?,deleted_at=? WHERE id=?', ['2026-08-99', '2026-08-02', old.recordId])
    await f.attendance({ workDate: '2026-08-03' })
    expect((await f.matrix()).diagnostics).toContainEqual(expect.objectContaining({ recordId: old.recordId, code: 'attendance-date-invalid' }))
    expect((await f.form()).eligibility.canSaveDraft).toBe(true)
    const saved = await f.service.executeC1(f.command(await f.config(), { kind: 'save-c1-rates', rates: [{ workerId: 'w', dailyWage: null, overtimeRate: 55 }] }))
    await f.db.execute('UPDATE operation_logs SET after_data=? WHERE table_name=? AND record_id=?', ['{broken-original', 'payroll_c1_rate_revisions', saved.rateRevisionIds[0]])
    expect((await f.config()).history).toContainEqual(expect.objectContaining({ recordId: saved.rateRevisionIds[0], afterData: null, afterRaw: '{broken-original' }))
  }
  finally { await f.close() }
})

it('c2主体按项目与负责人保存正价和明确空规则，不要求月份或工程量，原配置可冷读', async () => {
  const f = await createPayrollC2ServiceFixture()
  try {
    const read = await f.c2Config()
    expect(read).toMatchObject({ scope: { projectId: 'p', leaderWorkerId: 'w' }, config: null, draft: { unitRate: null, ruleText: '' } })
    const command = f.c2Command(read, { kind: 'save-c2-config', config: { crewId: 'crew', unitRate: 350, ruleText: '' } })
    const saved = await f.service.executeC2(command)
    expect(saved).toMatchObject({ outcome: 'saved', statementId: null, dayworkRecordIds: [], dayworkLinkIds: [] })
    expect((await f.c2Config()).config).toMatchObject({ id: saved.configId, unitRate: 350, ruleText: '', enabled: true })
    expect(await f.service.executeC2(command)).toEqual(saved)
    await expect(f.service.executeC2(f.c2Command(await f.c2Config(), { kind: 'save-c2-config', config: { crewId: 'crew', unitRate: 0, ruleText: '' } }))).rejects.toThrow('正')
  }
  finally { await f.close() }
})

it('核算525实际500与350/150/0全成员同时发放，原命令重试唯一，冷读配对冻结不取当前改名改价', async () => {
  const f = await createPayrollC2ServiceFixture()
  try {
    const read = await createCheckedPayrollC2(f)
    const release = { actualAmount: 500, allocations: [{ workerId: 'w', amount: 350 }, { workerId: 'member', amount: 150 }, { workerId: 'zero', amount: 0 }] }
    const command = f.c2Command(read, { kind: 'release-c2', release })
    const result = await f.service.executeC2(command)
    expect(result.outcome).toBe('released')
    expect(await f.service.executeC2(command)).toEqual(result)
    const first = await f.service.c2Output({ origin: 'real' }, result.statementId!)
    expect(first).toMatchObject({ state: 'available', document: { formatFamily: 'C2', grossAmount: 525, actualAmount: 500, config: { unitRate: 350, ruleText: '' } } })
    if (first.state !== 'available')
      throw new Error('真实发放应有完整冻结')
    expect(first.document.daywork).toHaveLength(2)
    expect(first.document.allocations.map(a => a.amount)).toEqual([350, 150, 0])
    f.source.workers[0]!.name = '以后改名'
    await f.service.executeC2(f.c2Command(await f.c2Config(), { kind: 'save-c2-config', config: { crewId: 'crew', unitRate: 360, ruleText: '后续规则' } }))
    expect((await f.service.c2Output({ origin: 'real' }, result.statementId!)).document).toEqual(first.document)
    await expect(f.daywork({ workerId: 'zero', workDate: '2026-08-31' })).rejects.toThrow('已发')
    expect(await f.db.select('SELECT command_id FROM payroll_command_receipts WHERE action=\'release-c2\'')).toHaveLength(1)
  }
  finally { await f.close() }
})

it('逐条confirmed签工按主体价核算525，保存核对保唯一关联及没有签工的零成员', async () => {
  const f = await createPayrollC2ServiceFixture()
  try {
    await f.service.executeC2(f.c2Command(await f.c2Config(), { kind: 'save-c2-config', config: { crewId: 'crew', unitRate: 350, ruleText: '' } }))
    const one = await f.daywork({ status: 'confirmed', witness: '证明甲', confirmedOn: '2026-08-02' })
    const half = await f.daywork({ workerId: 'member', laborUnits: 0.5, endTime: '12:00', status: 'confirmed', witness: '证明乙', confirmedOn: '2026-08-02' })
    await f.daywork({ workerId: 'member', workDate: '2026-08-03', laborUnits: 0.5, endTime: '12:00' })
    const preview = await f.c2Form()
    expect(preview.totals.grossAmount).toMatchObject({ state: 'known', value: 525 })
    expect(preview.adoptedRecordIds.sort()).toEqual([one.recordId, half.recordId].sort())
    expect(preview.facts.filter(r => r.availability === 'pending')).toHaveLength(1)
    const saved = await f.service.executeC2(f.c2Command(preview, { kind: 'save-c2-draft', draft: f.draft }))
    expect(saved.dayworkRecordIds.sort()).toEqual([one.recordId, half.recordId].sort())
    const read = await f.service.c2Form({ origin: 'real' }, { statementId: saved.statementId! })
    const checked = await f.service.executeC2(f.c2Command(read, { kind: 'check-c2' }))
    expect(checked.outcome).toBe('checked')
    const fresh = await f.service.c2Form({ origin: 'real' }, { statementId: saved.statementId! })
    expect(fresh).toMatchObject({ status: 'checked', needsRecheck: false, eligibility: { canRelease: true } })
    expect(fresh.members.map(m => m.id)).toEqual(['w', 'member', 'zero'])
    expect(fresh.lines.map(l => l.amount).sort()).toEqual([175, 350])
    expect(await f.db.select('SELECT id FROM wage_statement_daywork_records WHERE deleted_at IS NULL')).toHaveLength(2)
    expect(await f.db.select('SELECT id FROM wage_statement_daywork_records WHERE deleted_at IS NOT NULL')).toHaveLength(2)
  }
  finally { await f.close() }
})
