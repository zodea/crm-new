import { expect, it } from 'vitest'
import { createPayrollC1ServiceFixture } from '../helpers/payroll-c1-service-fixture'

it('纯时工项目无需工程量，逐人工资与未舍入的默认加班价来自真实考勤', async () => {
  const f = await createPayrollC1ServiceFixture()
  try {
    expect((await f.matrix()).workers.map(w => w.id)).toEqual(expect.arrayContaining(['w', 'member', 'zero']))
    expect((await f.matrix()).workers.map(w => w.id)).not.toContain('outside')
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
