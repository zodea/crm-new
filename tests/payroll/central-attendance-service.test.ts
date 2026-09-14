import { expect, it, vi } from 'vitest'
import { createPayrollC1ServiceFixture } from '../helpers/payroll-c1-service-fixture'

it('未选择项目或月份时保原空范围与候选，空矩阵不读取整年事实；非法非空月和空月写入仍拒绝', async () => {
  const attendanceFacts = vi.fn(async () => {
    throw new Error('未选月份不得读取事实')
  })
  const f = await createPayrollC1ServiceFixture({ attendanceFacts })
  try {
    for (const scope of [{ projectId: '', month: '', crewId: null }, { projectId: '', month: '2026-08', crewId: null }, { projectId: 'p', month: '', crewId: null }]) {
      const read = await f.service.attendanceMatrix({ origin: 'real' }, scope)
      expect(read.scope).toEqual(scope)
      expect(read.options.projects.map(project => project.id)).toEqual(['p', 'other-project'])
      expect(read.options.crews.map(crew => crew.id)).toEqual(scope.projectId ? ['crew'] : [])
      expect(read).toMatchObject({ workers: [], records: [], locks: [], diagnostics: [], evidence: [] })
      expect(read.context.readonly).toBe(false)
    }
    expect(attendanceFacts).not.toHaveBeenCalled()
    for (const month of ['2026-13', '2026-00', '2026-8', '2026-08-01', ' '])
      await expect(f.service.attendanceMatrix({ origin: 'real' }, { projectId: 'p', month, crewId: null })).rejects.toThrow('范围无效')
    const emptyMonth = await f.service.attendanceMatrix({ origin: 'real' }, { projectId: 'p', month: '', crewId: null })
    await expect(f.service.executeAttendance(f.attendanceCommand(emptyMonth, { workerId: 'w', crewId: 'crew', workDate: '2026-08-01', hours: 8, overtimeHours: 0, workContent: '', note: '' }))).rejects.toThrow('范围无效')
    await expect(f.service.c1Config({ origin: 'real' }, { projectId: 'p', month: '', crewId: null })).rejects.toThrow()
    expect(await f.db.select('SELECT * FROM attendance_records')).toEqual([])
    expect(await f.db.select('SELECT * FROM payroll_command_receipts')).toEqual([])
  }
  finally { await f.close() }
})

it('同日重存保持稳定原行与审计；非法日期工时和串项目班组拒绝且库不变', async () => {
  const f = await createPayrollC1ServiceFixture()
  try {
    const first = await f.attendance({ hours: 7.51, overtimeHours: 0 })
    const second = await f.attendance({ hours: 8, overtimeHours: 0, workContent: '修正原内容' })
    expect(second.recordId).toBe(first.recordId)
    expect((await f.matrix()).records).toHaveLength(1)
    const baseline = await f.db.select('SELECT * FROM attendance_records')
    for (const change of [{ workDate: '2026-02-30' }, { hours: -1 }, { hours: Number.NaN }, { hours: Infinity }, { hours: 23, overtimeHours: 2 }, { workerId: 'outside' }, { crewId: 'next-crew' }])
      await expect(f.attendance(change)).rejects.toThrow()
    expect(await f.db.select('SELECT * FROM attendance_records')).toEqual(baseline)
    expect((await f.db.select('SELECT * FROM operation_logs WHERE table_name=\'attendance_records\''))).toHaveLength(2)
  }
  finally { await f.close() }
})

it('待确认独立签工以及已发软删零成员月份均封锁，A 工资不误锁 C1', async () => {
  const f = await createPayrollC1ServiceFixture()
  try {
    await f.matrix()
    await f.db.execute('INSERT INTO signed_daywork_records(id,project_id,crew_id,worker_id,work_date,labor_units,status) VALUES(?,?,?,?,?,?,?)', ['pending', 'p', 'crew', 'w', '2026-08-05', 0.5, 'draft'])
    expect((await f.matrix()).locks).toContainEqual(expect.objectContaining({ workerId: 'w', statementId: null, dayworkRecordId: 'pending' }))
    await expect(f.attendance()).rejects.toThrow('签工')
    await f.db.execute('UPDATE signed_daywork_records SET deleted_at=? WHERE id=?', ['2026-08-06', 'pending'])
    await f.db.execute('INSERT INTO wage_statements(id,project_id,crew_id,leader_worker_id,month,format_family,status,quantity_source) VALUES(?,?,?,?,?,?,?,?)', ['a-only', 'p', 'crew', 'w', '2026-08', 'A', 'draft', 'field'])
    await expect(f.attendance()).resolves.toMatchObject({ outcome: 'saved' })
    await f.db.execute('INSERT INTO wage_statements(id,project_id,crew_id,leader_worker_id,month,format_family,status,deleted_at,snapshot_json,quantity_source) VALUES(?,?,?,?,?,?,?,?,?,?)', ['old-c2', 'p', 'crew', 'member', '2026-08', 'C2', 'released', '2026-08-10', JSON.stringify({ month: '2026-08', members: [{ workerId: 'zero' }], allocations: [{ workerId: 'zero', amount: 0 }] }), 'field'])
    await expect(f.attendance({ workerId: 'zero' })).rejects.toThrow()
    expect((await f.matrix()).locks).toContainEqual(expect.objectContaining({ workerId: 'zero', statementId: 'old-c2', kind: 'released-month' }))
  }
  finally { await f.close() }
})

it('转组不覆盖原同日班组或复制新行，all-crew 显示原格诊断', async () => {
  const f = await createPayrollC1ServiceFixture()
  try {
    const saved = await f.attendance()
    f.source.workers[0]!.crewId = 'next-crew'
    const scope = { ...f.scope, crewId: null }
    const read = await f.service.attendanceMatrix({ origin: 'real' }, scope)
    expect(read.diagnostics).toContainEqual(expect.objectContaining({ recordId: saved.recordId, code: 'original-crew-changed' }))
    const record = { workerId: 'w', crewId: 'next-crew', workDate: '2026-08-01', hours: 9, overtimeHours: 0, workContent: '', note: '' }
    await expect(f.service.executeAttendance(f.attendanceCommand(read, record))).rejects.toThrow('转组前')
    expect(await f.db.select('SELECT id,crew_id,hours FROM attendance_records')).toEqual([{ id: saved.recordId, crew_id: 'crew', hours: 8 }])
  }
  finally { await f.close() }
})
