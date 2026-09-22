import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrations, runMigrations } from '~/lib/db/migrations'
import { upsertAttendanceRecord } from '~/lib/payroll/attendance'
import {
  listSignedDayworkRecords,
  saveSignedDayworkRecord,
  upsertC2SubjectConfig,
} from '~/lib/payroll/daywork'
import {
  buildWageDraftSource,
  checkWageStatement,
  createWageStatementDraft,
  loadWageStatement,
  releaseWageStatement,
} from '~/lib/payroll/statements'
import { createMemoryDb, listTables } from '../helpers/memory-db'

let db: TestDb

beforeEach(async () => {
  db = await createMemoryDb()
  await runMigrations(db)
  await db.execute(`INSERT INTO projects (id, name, code) VALUES ('project-c2', '签工项目', 'C2')`)
  await db.execute(`INSERT INTO crews (id, name, trade) VALUES ('crew-c2', '零星用工班', '杂工')`)
  await db.execute(`
    INSERT INTO workers (id, crew_id, name, trade, current_project_id)
    VALUES
      ('worker-c2-a', 'crew-c2', '周师傅', '杂工', 'project-c2'),
      ('worker-c2-b', 'crew-c2', '黄师傅', '杂工', 'project-c2')
  `)
})

afterEach(() => db.close())

async function confirmDaywork(workerId: string, workDate: string, units: 0.5 | 1) {
  return saveSignedDayworkRecord(db, {
    projectId: 'project-c2',
    crewId: 'crew-c2',
    workerId,
    workDate,
    workContent: '地下室材料转运',
    startTime: units === 0.5 ? '08:00' : '08:00',
    endTime: units === 0.5 ? '12:00' : '18:00',
    laborUnits: units,
    witness: '王工',
    confirmedOn: workDate,
    status: 'confirmed',
  })
}

describe('c2 signed daywork source', () => {
  it('filters multiple statuses with OR while retaining month and crew scope, and supports single or cleared selection', async () => {
    const confirmedId = await confirmDaywork('worker-c2-a', '2026-07-10', 1)
    const draftId = await saveSignedDayworkRecord(db, {
      projectId: 'project-c2',
      crewId: 'crew-c2',
      workerId: 'worker-c2-b',
      workDate: '2026-07-11',
      workContent: '待证明签工',
      startTime: '08:00',
      endTime: '18:00',
      laborUnits: 1,
      status: 'draft',
    })
    await confirmDaywork('worker-c2-a', '2026-08-10', 1)
    const filter = { projectId: 'project-c2', crewId: 'crew-c2', month: '2026-07' }
    const expectedIds = [confirmedId, draftId].sort()

    const multiple = await listSignedDayworkRecords(db, { ...filter, status: ['draft', 'confirmed', 'draft'] })
    expect(multiple.map(record => record.id).sort()).toEqual(expectedIds)
    const single = await listSignedDayworkRecords(db, { ...filter, status: ['draft'] })
    expect(single.map(record => record.id)).toEqual([draftId])
    const legacySingle = await listSignedDayworkRecords(db, { ...filter, status: 'confirmed' })
    expect(legacySingle.map(record => record.id)).toEqual([confirmedId])
    const cleared = await listSignedDayworkRecords(db, { ...filter, status: [] })
    expect(cleared.map(record => record.id).sort()).toEqual(expectedIds)
    const legacyCleared = await listSignedDayworkRecords(db, { ...filter, status: '' })
    expect(legacyCleared.map(record => record.id).sort()).toEqual(expectedIds)
  })

  it('v30 creates the signed record and statement-link tables', async () => {
    expect(migrations.some(migration => migration.version === 30)).toBe(true)
    expect(await listTables(db)).toEqual(expect.arrayContaining([
      'payroll_subject_configs',
      'signed_daywork_records',
      'wage_statement_daywork_records',
    ]))
  })

  it('only accepts whole/half labor and requires proof for confirmed records', async () => {
    await expect(saveSignedDayworkRecord(db, {
      projectId: 'project-c2',
      crewId: 'crew-c2',
      workerId: 'worker-c2-a',
      workDate: '2026-07-10',
      workContent: '搬运',
      startTime: '08:00',
      endTime: '12:00',
      laborUnits: 0.5,
      status: 'confirmed',
    })).rejects.toThrow('证明人和确认日期')

    await confirmDaywork('worker-c2-a', '2026-07-10', 0.5)
    const records = await listSignedDayworkRecords(db, {
      projectId: 'project-c2',
      month: '2026-07',
    })
    expect(records).toEqual([
      expect.objectContaining({
        workerName: '周师傅',
        laborUnits: 0.5,
        status: 'confirmed',
        witness: '王工',
      }),
    ])
  })

  it('rejects overlapping slots and more than one labor unit per worker-day', async () => {
    await saveSignedDayworkRecord(db, {
      projectId: 'project-c2',
      crewId: 'crew-c2',
      workerId: 'worker-c2-a',
      workDate: '2026-07-10',
      workContent: '上午搬运',
      startTime: '08:00',
      endTime: '12:00',
      laborUnits: 0.5,
      witness: '王工',
      confirmedOn: '2026-07-10',
      status: 'confirmed',
    })
    await expect(saveSignedDayworkRecord(db, {
      projectId: 'project-c2',
      crewId: 'crew-c2',
      workerId: 'worker-c2-a',
      workDate: '2026-07-10',
      workContent: '重复时段',
      startTime: '10:00',
      endTime: '14:00',
      laborUnits: 0.5,
      witness: '王工',
      confirmedOn: '2026-07-10',
      status: 'confirmed',
    })).rejects.toThrow('时段重叠')

    await saveSignedDayworkRecord(db, {
      projectId: 'project-c2',
      crewId: 'crew-c2',
      workerId: 'worker-c2-a',
      workDate: '2026-07-10',
      workContent: '下午搬运',
      startTime: '13:00',
      endTime: '17:00',
      laborUnits: 0.5,
      witness: '王工',
      confirmedOn: '2026-07-10',
      status: 'confirmed',
    })
    await expect(saveSignedDayworkRecord(db, {
      projectId: 'project-c2',
      crewId: 'crew-c2',
      workerId: 'worker-c2-a',
      workDate: '2026-07-10',
      workContent: '超额晚班',
      startTime: '18:00',
      endTime: '20:00',
      laborUnits: 0.5,
      witness: '王工',
      confirmedOn: '2026-07-10',
      status: 'confirmed',
    })).rejects.toThrow('同一人员同日用工数不能超过 1 工')
  })

  it('keeps attendance and C2 signed daywork mutually exclusive in both directions', async () => {
    await upsertAttendanceRecord(db, {
      projectId: 'project-c2',
      crewId: 'crew-c2',
      workerId: 'worker-c2-a',
      workDate: '2026-07-09',
      hours: 8,
    })
    await expect(confirmDaywork('worker-c2-a', '2026-07-10', 1))
      .rejects
      .toThrow('已有考勤记录')

    await confirmDaywork('worker-c2-b', '2026-07-10', 1)
    await expect(upsertAttendanceRecord(db, {
      projectId: 'project-c2',
      crewId: 'crew-c2',
      workerId: 'worker-c2-b',
      workDate: '2026-07-11',
      hours: 8,
    })).rejects.toThrow('已有 C2 签工记录')
  })

  it('builds C2 wages only from confirmed records and freezes linked records on release', async () => {
    const firstRecordId = await confirmDaywork('worker-c2-a', '2026-07-10', 1)
    const subjectConfigId = await upsertC2SubjectConfig(db, {
      projectId: 'project-c2',
      crewId: 'crew-c2',
      leaderWorkerId: 'worker-c2-a',
      unitRate: 350,
      ruleText: '半工按 0.5 工计，证明人确认后生效。',
    })
    await saveSignedDayworkRecord(db, {
      projectId: 'project-c2',
      crewId: 'crew-c2',
      workerId: 'worker-c2-b',
      workDate: '2026-07-11',
      workContent: '待证明签工',
      startTime: '08:00',
      endTime: '18:00',
      laborUnits: 1,
      status: 'draft',
    })
    const source = await buildWageDraftSource(db, {
      projectId: 'project-c2',
      crewId: 'crew-c2',
      leaderWorkerId: 'worker-c2-a',
      memberWorkerIds: ['worker-c2-b'],
      month: '2026-07',
      formatFamily: 'C2',
      quantitySource: 'field',
      subjectConfigId,
    })
    expect(source.lines).toEqual([
      expect.objectContaining({
        workerId: 'worker-c2-a',
        quantity: 1,
        unitPrice: 350,
      }),
    ])
    expect(source.sourceRecordIds).toEqual([firstRecordId])

    const statementId = await createWageStatementDraft(db, {
      projectId: 'project-c2',
      crewId: 'crew-c2',
      leaderWorkerId: 'worker-c2-a',
      memberWorkerIds: ['worker-c2-b'],
      month: '2026-07',
      formatFamily: 'C2',
      purpose: 'advance',
      periodKind: 'monthly',
      quantitySource: 'field',
      payRatio: 1,
      subjectConfigId,
      lines: source.lines,
      sourceVersion: source.sourceVersion,
      sourceUpdatedAt: source.sourceUpdatedAt,
      sourceRecordIds: source.sourceRecordIds,
      note: '半工按 0.5 工计，证明人确认后生效。',
    })
    await checkWageStatement(db, statementId, source.lines, source)
    await saveSignedDayworkRecord(db, {
      id: firstRecordId,
      projectId: 'project-c2',
      crewId: 'crew-c2',
      workerId: 'worker-c2-a',
      workDate: '2026-07-10',
      workContent: '地下室材料转运',
      startTime: '08:00',
      endTime: '18:00',
      laborUnits: 1,
      witness: '李工',
      confirmedOn: '2026-07-10',
      status: 'confirmed',
    })
    expect(await releaseWageStatement(db, statementId, 350)).toBe('needs_recheck')
    expect(await loadWageStatement(db, statementId)).toMatchObject({
      status: 'checked',
      needsRecheck: true,
    })

    const refreshed = await buildWageDraftSource(db, {
      projectId: 'project-c2',
      crewId: 'crew-c2',
      leaderWorkerId: 'worker-c2-a',
      memberWorkerIds: ['worker-c2-b'],
      statementId,
      month: '2026-07',
      formatFamily: 'C2',
      quantitySource: 'field',
      subjectConfigId,
    })
    await checkWageStatement(db, statementId, refreshed.lines, refreshed)
    expect(await releaseWageStatement(db, statementId, 350)).toBe('released')

    const released = await loadWageStatement(db, statementId)
    expect(released).toMatchObject({
      formatFamily: 'C2',
      status: 'released',
      grossAmount: 350,
      actualAmount: 350,
      note: '半工按 0.5 工计，证明人确认后生效。',
      dayworkRecords: [
        expect.objectContaining({ id: firstRecordId, laborUnits: 1, witness: '李工' }),
      ],
    })

    await expect(confirmDaywork('worker-c2-b', '2026-07-12', 1))
      .rejects
      .toThrow('已发放')
    await expect(saveSignedDayworkRecord(db, {
      id: firstRecordId,
      projectId: 'project-c2',
      crewId: 'crew-c2',
      workerId: 'worker-c2-b',
      workDate: '2026-08-01',
      workContent: '试图移动已发记录',
      startTime: '08:00',
      endTime: '18:00',
      laborUnits: 1,
      witness: '王工',
      confirmedOn: '2026-08-01',
      status: 'confirmed',
    })).rejects.toThrow('已发放')
    expect((await loadWageStatement(db, statementId))?.dayworkRecords).toHaveLength(1)
  })

  it('prevents one signed record from being assigned to another statement', async () => {
    const recordId = await confirmDaywork('worker-c2-a', '2026-07-10', 1)
    const firstConfigId = await upsertC2SubjectConfig(db, {
      projectId: 'project-c2',
      crewId: 'crew-c2',
      leaderWorkerId: 'worker-c2-a',
      unitRate: 350,
      ruleText: '',
    })
    const firstSource = await buildWageDraftSource(db, {
      projectId: 'project-c2',
      crewId: 'crew-c2',
      leaderWorkerId: 'worker-c2-a',
      memberWorkerIds: [],
      month: '2026-07',
      formatFamily: 'C2',
      quantitySource: 'field',
      subjectConfigId: firstConfigId,
    })
    await createWageStatementDraft(db, {
      projectId: 'project-c2',
      crewId: 'crew-c2',
      leaderWorkerId: 'worker-c2-a',
      memberWorkerIds: [],
      month: '2026-07',
      formatFamily: 'C2',
      purpose: 'advance',
      periodKind: 'monthly',
      quantitySource: 'field',
      payRatio: 1,
      subjectConfigId: firstConfigId,
      lines: firstSource.lines,
      sourceVersion: firstSource.sourceVersion,
      sourceUpdatedAt: firstSource.sourceUpdatedAt,
      sourceRecordIds: firstSource.sourceRecordIds,
    })

    const secondConfigId = await upsertC2SubjectConfig(db, {
      projectId: 'project-c2',
      crewId: 'crew-c2',
      leaderWorkerId: 'worker-c2-b',
      unitRate: 360,
      ruleText: '',
    })
    const secondSource = await buildWageDraftSource(db, {
      projectId: 'project-c2',
      crewId: 'crew-c2',
      leaderWorkerId: 'worker-c2-b',
      memberWorkerIds: ['worker-c2-a'],
      month: '2026-07',
      formatFamily: 'C2',
      quantitySource: 'field',
      subjectConfigId: secondConfigId,
    })
    expect(secondSource.lines).toEqual([])
    expect(secondSource.sourceRecordIds).toEqual([])
    await expect(createWageStatementDraft(db, {
      projectId: 'project-c2',
      crewId: 'crew-c2',
      leaderWorkerId: 'worker-c2-b',
      memberWorkerIds: ['worker-c2-a'],
      month: '2026-07',
      formatFamily: 'C2',
      purpose: 'advance',
      periodKind: 'monthly',
      quantitySource: 'field',
      payRatio: 1,
      subjectConfigId: secondConfigId,
      lines: firstSource.lines,
      sourceVersion: firstSource.sourceVersion,
      sourceUpdatedAt: firstSource.sourceUpdatedAt,
      sourceRecordIds: [recordId],
    })).rejects.toThrow()
  })

  it('rechecks C2 with the current configured rate and snapshots the rule', async () => {
    await confirmDaywork('worker-c2-a', '2026-07-10', 1)
    const subjectConfigId = await upsertC2SubjectConfig(db, {
      projectId: 'project-c2',
      crewId: 'crew-c2',
      leaderWorkerId: 'worker-c2-a',
      unitRate: 300,
      ruleText: '旧规则',
    })
    const source = await buildWageDraftSource(db, {
      projectId: 'project-c2',
      crewId: 'crew-c2',
      leaderWorkerId: 'worker-c2-a',
      month: '2026-07',
      formatFamily: 'C2',
      quantitySource: 'field',
      subjectConfigId,
    })
    const statementId = await createWageStatementDraft(db, {
      projectId: 'project-c2',
      crewId: 'crew-c2',
      leaderWorkerId: 'worker-c2-a',
      month: '2026-07',
      formatFamily: 'C2',
      purpose: 'advance',
      periodKind: 'monthly',
      quantitySource: 'field',
      payRatio: 1,
      subjectConfigId,
      lines: source.lines,
      sourceVersion: source.sourceVersion,
      sourceUpdatedAt: source.sourceUpdatedAt,
      sourceRecordIds: source.sourceRecordIds,
      note: '旧规则',
    })
    await upsertC2SubjectConfig(db, {
      projectId: 'project-c2',
      crewId: 'crew-c2',
      leaderWorkerId: 'worker-c2-a',
      unitRate: 420,
      ruleText: '新规则：证明人确认后生效',
    })
    const fresh = await buildWageDraftSource(db, {
      projectId: 'project-c2',
      crewId: 'crew-c2',
      leaderWorkerId: 'worker-c2-a',
      statementId,
      month: '2026-07',
      formatFamily: 'C2',
      quantitySource: 'field',
      subjectConfigId,
    })
    await checkWageStatement(db, statementId, fresh.lines, fresh)
    expect(await loadWageStatement(db, statementId)).toMatchObject({
      note: '新规则：证明人确认后生效',
      lines: [expect.objectContaining({ unitPrice: 420, amount: 420 })],
    })
    expect(await releaseWageStatement(db, statementId, 420)).toBe('released')
    const [released] = await db.select<{ snapshot_json: string }>(
      `SELECT snapshot_json FROM wage_statements WHERE id = ?`,
      [statementId],
    )
    expect(JSON.parse(released!.snapshot_json).subjectConfig).toEqual({
      id: subjectConfigId,
      unitRate: 420,
      ruleText: '新规则：证明人确认后生效',
    })
  })
})
