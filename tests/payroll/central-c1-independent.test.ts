import { afterEach, describe, expect, it } from 'vitest'
import { decodePayrollC1Read, encodePayrollC1Wire } from '~/lib/payroll/central-c1-codec'
import { createPayrollC1ServiceFixture } from '../helpers/payroll-c1-service-fixture'

type Fixture = Awaited<ReturnType<typeof createPayrollC1ServiceFixture>>
const fixtures: Fixture[] = []
afterEach(async () => {
  for (const f of fixtures.splice(0))
    await f.close()
})
async function fixture() {
  const f = await createPayrollC1ServiceFixture()
  fixtures.push(f)
  await f.matrix()
  return f
}
async function savedFacts(f: Fixture) {
  const tables = ['workers', 'attendance_records', 'wage_statements', 'wage_statement_members', 'wage_statement_lines', 'wage_statement_allocations', 'payroll_c1_statement_sources', 'payroll_c1_rate_revisions', 'payroll_command_receipts', 'payroll_revision', 'operation_logs']
  return Object.fromEntries(await Promise.all(tables.map(async table => [table, await f.db.select(`SELECT * FROM ${table} ORDER BY rowid`)])))
}
async function checked(f: Fixture) {
  const saved = await f.service.executeC1(f.command(await f.form(), { kind: 'save-c1-draft', draft: f.draft }))
  const read = () => f.service.c1Form({ origin: 'real' }, { statementId: saved.statementId! })
  await f.service.executeC1(f.command(await read(), { kind: 'check-c1' }))
  return read
}
const release = { actualAmount: 100, allocations: [{ workerId: 'w', amount: 100 }, { workerId: 'member', amount: 0 }, { workerId: 'zero', amount: 0 }] }

describe('c1 独立复验：事务末端、历史原组与月份边界', () => {
  it('考勤最后一次身份等待后撤权，原格、审计、版本与回执整批不变', async () => {
    const f = await fixture()
    const read = await f.matrix()
    const before = await savedFacts(f)
    let reads = 0
    f.setIdentityHook(async () => {
      await Promise.resolve()
      if (++reads === 2)
        f.setSession({ workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read'] })
    })
    const command = f.attendanceCommand(read, { workerId: 'w', crewId: 'crew', workDate: '2026-08-31', hours: 7.51, overtimeHours: 0, workContent: '月末原输入', note: '' })
    await expect(f.service.executeAttendance(command)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(reads).toBe(2)
    expect(await savedFacts(f)).toEqual(before)
  })

  it('发放最后一次身份等待中日薪变化，不能部分写成已发或留下可重放成功回执', async () => {
    const f = await fixture()
    await f.attendance()
    const read = await checked(f)
    const command = f.command(await read(), { kind: 'release-c1', release })
    const before = await savedFacts(f)
    let reads = 0
    f.setIdentityHook(async () => {
      await Promise.resolve()
      if (++reads === 2)
        f.source.workers.find(w => w.id === 'w')!.dailyWage = 481.01
    })
    await expect(f.service.executeC1(command)).rejects.toMatchObject({ problem: { code: 'stale-source' } })
    expect(reads).toBe(2)
    expect(await savedFacts(f)).toEqual(before)
  })

  it('全部班组矩阵仍明确标记转组前原格不可写；新组同日重存不改原行', async () => {
    const f = await fixture()
    const original = await f.attendance({ hours: 7.51, overtimeHours: 0, workContent: '转组前施工' })
    f.source.workers.find(w => w.id === 'w')!.crewId = 'next-crew'
    const all = await f.service.attendanceMatrix({ origin: 'real' }, { ...f.scope, crewId: null })
    expect(all.records.find(r => r.id === original.recordId)).toMatchObject({ crewId: 'crew', hours: 7.51, workContent: '转组前施工' })
    const historicalReason = all.diagnostics.some(d => d.recordId === original.recordId && /班组|转组/.test(d.message))
      || all.workers.some(w => w.id === 'w' && !w.eligible && w.reasons.some(r => /班组|转组/.test(r)))
    expect(historicalReason).toBe(true)
    const next = await f.service.attendanceMatrix({ origin: 'real' }, { ...f.scope, crewId: 'next-crew' })
    const before = await savedFacts(f)
    await expect(f.service.executeAttendance(f.attendanceCommand(next, { workerId: 'w', crewId: 'next-crew', workDate: '2026-08-01', hours: 8, overtimeHours: 0, workContent: '不可改挂', note: '' }))).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
    expect(await savedFacts(f)).toEqual(before)
  })

  it('历史已发 C2 的软删签工与软删关联仍锁住没有成员行的原工人', async () => {
    const f = await fixture()
    // 这是缺损旧历史，不伪造健康的新中央发放快照。
    await f.db.execute('INSERT INTO wage_statements(id,project_id,crew_id,leader_worker_id,month,format_family,quantity_source,status,actual_amount,deleted_at) VALUES(\'old-c2\',\'p\',\'crew\',\'w\',\'2026-08\',\'C2\',\'field\',\'released\',0,\'2026-09-01\')')
    await f.db.execute('INSERT INTO signed_daywork_records(id,project_id,crew_id,worker_id,work_date,labor_units,status,deleted_at) VALUES(\'old-daywork\',\'p\',\'crew\',\'zero\',\'2026-08-01\',0.5,\'confirmed\',\'2026-09-01\')')
    await f.db.execute('INSERT INTO wage_statement_daywork_records(id,statement_id,daywork_record_id,deleted_at) VALUES(\'old-link\',\'old-c2\',\'old-daywork\',\'2026-09-01\')')
    const read = await f.matrix()
    expect(read.locks).toContainEqual(expect.objectContaining({ workerId: 'zero', month: '2026-08', statementId: 'old-c2', kind: 'released-month' }))
    expect((await f.service.detail({ origin: 'real' }, 'old-c2')).statement.stored.dayworkLinks).toContainEqual(expect.objectContaining({ dayworkRecordId: 'old-daywork', deletedAt: '2026-09-01' }))
    const before = await savedFacts(f)
    await expect(f.service.executeAttendance(f.attendanceCommand(read, { workerId: 'zero', crewId: 'crew', workDate: '2026-08-31', hours: 0, overtimeHours: 0, workContent: '', note: '' }))).rejects.toThrow('该人员当月已有签工链或已发工资，考勤不可再改')
    expect(await savedFacts(f)).toEqual(before)
  })

  it('合计工时和更新时间未变但逐日内容交换，旧核对失效且需重核可冷读', async () => {
    const f = await fixture()
    await f.attendance({ workDate: '2026-08-01', hours: 7.51, overtimeHours: 0, workContent: '第一日' })
    await f.attendance({ workDate: '2026-08-02', hours: 8, overtimeHours: 0, workContent: '第二日' })
    const read = await checked(f)
    const old = await read()
    await f.db.execute('UPDATE attendance_records SET work_content=CASE work_date WHEN \'2026-08-01\' THEN \'第二日\' ELSE \'第一日\' END WHERE project_id=\'p\' AND worker_id=\'w\'')
    const result = await f.service.executeC1(f.command(old, { kind: 'release-c1', release }))
    expect(result.outcome).toBe('needs-recheck')
    expect((await read()).needsRecheck).toBe(true)
    expect(await f.db.select('SELECT id FROM wage_statements WHERE status=\'released\'')).toEqual([])
    expect(await f.db.select('SELECT id FROM wage_statement_allocations')).toEqual([])
  })

  it('7.51 小时保到核算行，前月实发不扣次月工资且原已发输出不随档案改变', async () => {
    const f = await fixture()
    await f.attendance({ hours: 7.51, overtimeHours: 0 })
    const read = await checked(f)
    const august = await read()
    expect(august.lines.find(l => l.workerId === 'w' && l.kind === 'normal')).toMatchObject({ quantity: 7.51, unitPrice: 60.125, amount: 451.54 })
    await f.service.executeC1(f.command(august, { kind: 'release-c1', release }))
    const frozen = await f.service.c1Output({ origin: 'real' }, august.statementId!)
    expect(frozen.state).toBe('available')
    const month = '2026-09'
    const matrix = await f.service.attendanceMatrix({ origin: 'real' }, { ...f.scope, month })
    await f.service.executeAttendance(f.attendanceCommand(matrix, { workerId: 'w', crewId: 'crew', workDate: '2026-09-01', hours: 8, overtimeHours: 0, workContent: '次月独立', note: '' }))
    expect((await f.form({ month }, 'september')).totals.grossAmount.value).toBe(481)
    f.source.workers.find(w => w.id === 'w')!.name = '后来姓名'
    f.source.workers.find(w => w.id === 'w')!.dailyWage = 900
    expect((await f.service.c1Output({ origin: 'real' }, august.statementId!)).document).toEqual(frozen.document)
  })

  it.each(([{ projectId: 'other-project' }, { workDate: '2026-09-01' }, { workDate: '2026-08-32' }, { deletedAt: '2026-09-01' }]).map(input => ({ input })))('冻结配对读取必须拒绝另一项目、月份或已经删除的考勤，金额相等也不能通过：输入案例 %#', async ({ input: change }) => {
    const f = await fixture()
    await f.attendance()
    const read = await checked(f)
    const form = await read()
    await f.service.executeC1(f.command(form, { kind: 'release-c1', release }))
    const frozen = await f.service.c1Output({ origin: 'real' }, form.statementId!)
    expect(frozen.state).toBe('available')
    expect(() => decodePayrollC1Read(encodePayrollC1Wire(frozen), 'output', { origin: 'real' }, form.statementId!)).not.toThrow()
    const corrupt = structuredClone(frozen)
    if (corrupt.state !== 'available')
      throw new Error('公开发放未返回完整配对输出')
    Object.assign(corrupt.document.attendance[0]!, change)
    expect(() => decodePayrollC1Read(encodePayrollC1Wire(corrupt), 'output', { origin: 'real' }, form.statementId!), JSON.stringify(change)).toThrow('考勤或 C1 数据不完整')
  })

  it('全部班组筛选不能冒充工资主体的空班组，保存前拒绝无法原样冷读的来源', async () => {
    const f = await fixture()
    await f.attendance()
    const draft = { ...f.draft, crewId: null }
    const read = await f.form(draft, 'all-crews')
    expect(read.eligibility.canSaveDraft).toBe(false)
    const before = await savedFacts(f)
    await expect(f.service.executeC1(f.command(read, { kind: 'save-c1-draft', draft }))).rejects.toThrow('工资成员的当前项目或班组资格不可确认')
    expect(await savedFacts(f)).toEqual(before)
  })
})
