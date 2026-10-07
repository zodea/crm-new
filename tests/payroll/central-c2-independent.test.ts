import { afterEach, describe, expect, it } from 'vitest'
import { createPayrollC2ServiceFixture } from '../helpers/payroll-c2-service-fixture'

type Fixture = Awaited<ReturnType<typeof createPayrollC2ServiceFixture>>
const fixtures: Fixture[] = []
afterEach(async () => {
  for (const f of fixtures.splice(0))
    await f.close()
})
async function fixture() {
  const f = await createPayrollC2ServiceFixture()
  fixtures.push(f)
  await f.ledger()
  return f
}
async function databaseFacts(f: Fixture) {
  const tables = ['projects', 'crews', 'workers', 'attendance_records', 'signed_daywork_records', 'payroll_subject_configs', 'wage_statements', 'wage_statement_members', 'wage_statement_lines', 'wage_statement_allocations', 'wage_statement_daywork_records', 'payroll_c2_statement_sources', 'payroll_command_receipts', 'payroll_revision', 'operation_logs']
  return Object.fromEntries(await Promise.all(tables.map(async table => [table, await f.db.select(`SELECT * FROM ${table} ORDER BY rowid`)])))
}
const release = { actualAmount: 500, allocations: [{ workerId: 'w', amount: 350 }, { workerId: 'member', amount: 150 }, { workerId: 'zero', amount: 0 }] }
async function checked(f: Fixture) {
  await f.service.executeC2(f.c2Command(await f.c2Config(), { kind: 'save-c2-config', config: { crewId: 'crew', unitRate: 350, ruleText: '' } }))
  const first = await f.daywork({ status: 'confirmed', witness: '现场证明甲', confirmedOn: '2026-08-05', note: '晚于两天仍人工确认' })
  await f.daywork({ workerId: 'member', startTime: '08:00', endTime: '12:00', laborUnits: 0.5, status: 'confirmed', witness: '现场证明乙', confirmedOn: '2026-08-02' })
  const saved = await f.service.executeC2(f.c2Command(await f.c2Form(), { kind: 'save-c2-draft', draft: f.draft }))
  const statementId = saved.statementId!
  const read = () => f.service.c2Form({ origin: 'real' }, { statementId })
  await f.service.executeC2(f.c2Command(await read(), { kind: 'check-c2' }))
  return { read, statementId, recordId: first.recordId }
}

describe('c2 独立公开服务反例：原关系、最后窗口与完整冻结', () => {
  it('同人同日两个相邻半工按主体价合计350，两个原来源均保留', async () => {
    const f = await fixture()
    await f.service.executeC2(f.c2Command(await f.c2Config(), { kind: 'save-c2-config', config: { crewId: 'crew', unitRate: 350, ruleText: '' } }))
    const first = await f.daywork({ endTime: '12:00', laborUnits: 0.5, status: 'confirmed', witness: '上午证明人', confirmedOn: '2026-08-02' })
    const second = await f.daywork({ startTime: '12:00', endTime: '16:00', laborUnits: 0.5, status: 'confirmed', witness: '下午证明人', confirmedOn: '2026-08-02' })
    const read = await f.c2Form()
    expect(read.totals.grossAmount).toMatchObject({ state: 'known', value: 350 })
    expect(read.lines).toEqual([expect.objectContaining({ workerId: 'w', quantity: 1, unitPrice: 350, amount: 350 })])
    expect(read.adoptedRecordIds.sort()).toEqual([first.recordId, second.recordId].sort())
    const saved = await f.service.executeC2(f.c2Command(read, { kind: 'save-c2-draft', draft: f.draft }))
    const cold = await f.service.c2Form({ origin: 'real' }, { statementId: saved.statementId! })
    expect(cold.storedSource?.facts).toHaveLength(2)
    expect(cold.totals.grossAmount.value).toBe(350)
    expect((await f.service.executeC2(f.c2Command(cold, { kind: 'check-c2' }))).outcome).toBe('checked')
    const checkedRead = await f.service.c2Form({ origin: 'real' }, { statementId: saved.statementId! })
    expect(checkedRead).toMatchObject({ status: 'checked', totals: { grossAmount: { value: 350 } } })
    expect(checkedRead.storedSource?.facts).toHaveLength(2)
  })

  it('前月实际发放500后次月新一工仍核算350，不扣前月实发或释放前月锁', async () => {
    const f = await fixture()
    const previous = await checked(f)
    await f.service.executeC2(f.c2Command(await previous.read(), { kind: 'release-c2', release }))
    const original = await f.service.c2Output({ origin: 'real' }, previous.statementId)
    expect(original.state).toBe('available')
    const record = await f.daywork({ workDate: '2026-09-01', status: 'confirmed', witness: '次月证明人', confirmedOn: '2026-09-02' })
    const read = await f.c2Form({ month: '2026-09' }, 'following-month')
    expect(read.totals.grossAmount).toMatchObject({ state: 'known', value: 350 })
    expect(read.adoptedRecordIds).toEqual([record.recordId])
    const saved = await f.service.executeC2(f.c2Command(read, { kind: 'save-c2-draft', draft: { ...f.draft, month: '2026-09' } }))
    expect((await f.service.c2Form({ origin: 'real' }, { statementId: saved.statementId! })).totals.grossAmount.value).toBe(350)
    expect((await f.service.c2Output({ origin: 'real' }, previous.statementId)).document).toEqual(original.document)
    await expect(f.daywork({ workerId: 'zero', workDate: '2026-08-31' })).rejects.toThrow('已发')
  })

  it('c2实发原编号不能改成另一份合法金额与分配，原回执及冻结均不变', async () => {
    const f = await fixture()
    const { read, statementId } = await checked(f)
    const command = f.c2Command(await read(), { kind: 'release-c2', release })
    const result = await f.service.executeC2(command)
    const output = await f.service.c2Output({ origin: 'real' }, statementId)
    const before = await databaseFacts(f)
    await expect(f.service.executeC2({ ...command, action: { kind: 'release-c2', release: { actualAmount: 499, allocations: [{ workerId: 'w', amount: 349 }, { workerId: 'member', amount: 150 }, { workerId: 'zero', amount: 0 }] } } })).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(await databaseFacts(f)).toEqual(before)
    expect(await f.service.executeC2(command)).toEqual(result)
    expect(await f.service.c2Output({ origin: 'real' }, statementId)).toEqual(output)
  })

  it('签工最后一次身份等待后撤权，原事实和审计回执整批不变', async () => {
    const f = await fixture()
    const read = await f.dayworkForm()
    const command = f.dayworkCommand(read, { kind: 'save-daywork', record: f.record })
    const before = await databaseFacts(f)
    let reads = 0
    f.setIdentityHook(async () => {
      await Promise.resolve()
      if (++reads === 2)
        f.setSession({ workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read'] })
    })
    await expect(f.service.executeDaywork(command)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(reads).toBe(2)
    expect(await databaseFacts(f)).toEqual(before)
  })

  it('真实零考勤与待确认签工并发争同人月，只留一种事实和一次回执', async () => {
    const f = await fixture()
    const attendance = f.attendanceCommand(await f.matrix(), { workerId: 'w', crewId: 'crew', workDate: '2026-08-01', hours: 0, overtimeHours: 0, workContent: '', note: '' })
    const daywork = f.dayworkCommand(await f.dayworkForm(), { kind: 'save-daywork', record: f.record })
    const results = await Promise.allSettled([f.service.executeAttendance(attendance), f.service.executeDaywork(daywork)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    const attendances = await f.db.select('SELECT id FROM attendance_records WHERE project_id=\'p\' AND worker_id=\'w\'')
    const dayworks = await f.db.select('SELECT id FROM signed_daywork_records WHERE project_id=\'p\' AND worker_id=\'w\'')
    expect(attendances.length + dayworks.length).toBe(1)
    const receipts = await f.db.select('SELECT command_id FROM payroll_command_receipts WHERE command_id IN (?,?)', [attendance.commandId, daywork.commandId])
    expect(receipts).toHaveLength(1)
  })

  it('合法原签工改给已有真实零考勤的人员时，旧新范围共同复验且不改原记录', async () => {
    const f = await fixture()
    await f.attendance({ workerId: 'zero', hours: 0, overtimeHours: 0, workContent: '' })
    const saved = await f.daywork()
    const read = await f.service.dayworkForm({ origin: 'real' }, { recordId: saved.recordId })
    const command = f.dayworkCommand(read, { kind: 'save-daywork', record: { ...f.record, workerId: 'zero', workDate: '2026-08-02' } })
    const before = await databaseFacts(f)
    await expect(f.service.executeDaywork(command)).rejects.toThrow('原或目标月份已有考勤链或已发工资，不能移动或修改签工')
    expect(await databaseFacts(f)).toEqual(before)
  })

  it('同工数同更新时间只改证明人，旧核对不能发放且需重核状态冷读保留', async () => {
    const f = await fixture()
    const { read, recordId } = await checked(f)
    const beforeChange = await read()
    expect(beforeChange.totals.grossAmount.value).toBe(525)
    await f.db.execute('UPDATE signed_daywork_records SET witness=? WHERE id=?', ['之后核实的新证明人', recordId])
    const result = await f.service.executeC2(f.c2Command(beforeChange, { kind: 'release-c2', release }))
    expect(result.outcome).toBe('needs-recheck')
    expect((await read()).needsRecheck).toBe(true)
    expect(await f.db.select('SELECT id FROM wage_statements WHERE status=\'released\'')).toEqual([])
    expect(await f.db.select('SELECT id FROM wage_statement_allocations')).toEqual([])
  })

  it('发放最后一次身份等待后改所属项目，不留下工资、分配或成功回执', async () => {
    const f = await fixture()
    const { read } = await checked(f)
    const command = f.c2Command(await read(), { kind: 'release-c2', release })
    const before = await databaseFacts(f)
    let reads = 0
    f.setIdentityHook(async () => {
      await Promise.resolve()
      if (++reads === 2)
        f.source.workers.find(worker => worker.id === 'w')!.currentProjectId = 'other-project'
    })
    await expect(f.service.executeC2(command)).rejects.toMatchObject({ problem: { code: 'stale-source' } })
    expect(reads).toBe(2)
    expect(await databaseFacts(f)).toEqual(before)
  })

  it('已发无签工零收款成员也整月锁定，原来源不能改人改日移出已发范围', async () => {
    const f = await fixture()
    const { read, recordId } = await checked(f)
    await f.service.executeC2(f.c2Command(await read(), { kind: 'release-c2', release }))
    const zeroDraft = { ...f.record, workerId: 'zero', workDate: '2026-08-31', laborUnits: 0.5, startTime: '08:00', endTime: '12:00' }
    const zeroRead = await f.dayworkForm(zeroDraft)
    const zeroCommand = f.dayworkCommand(zeroRead, { kind: 'save-daywork', record: zeroDraft })
    const originalRead = await f.service.dayworkForm({ origin: 'real' }, { recordId })
    const move = f.dayworkCommand(originalRead, { kind: 'save-daywork', record: { ...f.record, workerId: 'member', workDate: '2026-09-01' } })
    const before = await databaseFacts(f)
    await expect(f.service.executeDaywork(zeroCommand)).rejects.toThrow('原或目标月份已有考勤链或已发工资，不能移动或修改签工')
    await expect(f.service.executeDaywork(move)).rejects.toThrow('该人员月份已有考勤链或已发工资，原签工不可修改')
    expect(await databaseFacts(f)).toEqual(before)
  })

  it('健康公共发放后只损坏冻结来源日期，即使金额不变也不能生成完整输出', async () => {
    const f = await fixture()
    const { read, statementId } = await checked(f)
    await f.service.executeC2(f.c2Command(await read(), { kind: 'release-c2', release }))
    const healthy = await f.service.c2Output({ origin: 'real' }, statementId)
    expect(healthy.state).toBe('available')
    if (healthy.state === 'available') {
      expect(healthy.document.actualAmount).toBe(500)
      expect(healthy.document.config.ruleText).toBe('')
      expect(healthy.document.allocations).toHaveLength(3)
    }
    const rows = await f.db.select<{ snapshot_json: string }>('SELECT snapshot_json FROM wage_statements WHERE id=?', [statementId])
    const snapshot = JSON.parse(rows[0]!.snapshot_json)
    expect(snapshot.c2Source.facts).not.toHaveLength(0)
    snapshot.c2Source.facts[0].workDate = '2026-09-01'
    await f.db.execute('UPDATE wage_statements SET snapshot_json=? WHERE id=?', [JSON.stringify(snapshot), statementId])
    const invalid = await f.service.c2Output({ origin: 'real' }, statementId)
    expect(invalid.state).toBe('unavailable')
    expect(invalid.document).toBeNull()
  })

  it('不同负责人并发领用同一签工仅有一单，另一主体明确看见被占用来源', async () => {
    const f = await fixture()
    for (const leaderWorkerId of ['w', 'member']) {
      const config = await f.service.c2Config({ origin: 'real' }, { projectId: 'p', leaderWorkerId })
      await f.service.executeC2(f.c2Command(config, { kind: 'save-c2-config', config: { crewId: 'crew', unitRate: 350, ruleText: '' } }))
    }
    const daywork = await f.daywork({ status: 'confirmed', witness: '原现场证明人', confirmedOn: '2026-08-02' })
    const first = await f.c2Form({}, 'claim-first')
    const second = await f.c2Form({ leaderWorkerId: 'member' }, 'claim-second')
    expect(first.totals.grossAmount.value).toBe(350)
    expect(second.totals.grossAmount.value).toBe(350)
    const results = await Promise.allSettled([
      f.service.executeC2(f.c2Command(first, { kind: 'save-c2-draft', draft: f.draft })),
      f.service.executeC2(f.c2Command(second, { kind: 'save-c2-draft', draft: { ...f.draft, leaderWorkerId: 'member' } })),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    const heads = await f.db.select<{ id: string, leader_worker_id: string }>('SELECT id,leader_worker_id FROM wage_statements WHERE deleted_at IS NULL AND format_family=\'C2\'')
    expect(heads).toHaveLength(1)
    expect(await f.db.select('SELECT daywork_record_id,statement_id FROM wage_statement_daywork_records WHERE deleted_at IS NULL')).toEqual([{ daywork_record_id: daywork.recordId, statement_id: heads[0]!.id }])
    const loser = heads[0]!.leader_worker_id === 'w' ? 'member' : 'w'
    const latest = await f.c2Form({ leaderWorkerId: loser }, 'loser-new-draft')
    expect(latest.adoptedRecordIds).toEqual([])
    expect(latest.eligibility.canSaveDraft).toBe(false)
    expect(latest.facts.find(record => record.id === daywork.recordId)).toMatchObject({ availability: 'occupied', occupations: expect.arrayContaining([expect.objectContaining({ statementId: heads[0]!.id })]) })
    const before = await databaseFacts(f)
    await expect(f.service.executeC2(f.c2Command(latest, { kind: 'save-c2-draft', draft: { ...f.draft, leaderWorkerId: loser } }))).rejects.toThrow('原签工已被其他工资领用，当前没有可用来源')
    expect(await databaseFacts(f)).toEqual(before)
  })

  it('未发工资占用允许合法原签工改回待确认，但保留原采用证据与需重核状态', async () => {
    const f = await fixture()
    const { read, statementId, recordId } = await checked(f)
    const original = await f.service.dayworkForm({ origin: 'real' }, { recordId })
    expect(original.eligibility.canEdit).toBe(true)
    const revised = await f.service.executeDaywork(f.dayworkCommand(original, { kind: 'save-daywork', record: { ...f.record, workContent: '未发时核实需重新证明', status: 'draft' } }))
    expect(revised.affectedStatementIds).toContain(statementId)
    const latest = await read()
    expect(latest.needsRecheck).toBe(true)
    expect(latest.storedSource?.facts.find(fact => fact.id === recordId)).toMatchObject({ status: 'confirmed', witness: '现场证明甲' })
    expect(latest.facts.find(fact => fact.id === recordId)).toMatchObject({ status: 'draft', workContent: '未发时核实需重新证明' })
    expect(await f.db.select('SELECT daywork_record_id FROM wage_statement_daywork_records WHERE statement_id=? AND deleted_at IS NULL', [statementId])).toContainEqual({ daywork_record_id: recordId })
  })
})
