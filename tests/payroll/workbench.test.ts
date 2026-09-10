import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import {
  listAttendanceRecords,
  upsertAttendanceRecord,
} from '~/lib/payroll/attendance'
import {
  buildWageDraftSource,
  checkWageStatement,
  createWageStatementDraft,
  loadWageStatement,
  releaseWageStatement,
} from '~/lib/payroll/statements'
import { createMemoryDb } from '../helpers/memory-db'

let db: TestDb

beforeEach(async () => {
  db = await createMemoryDb()
  await runMigrations(db)
  await db.execute(`
    INSERT INTO projects (id, name, code) VALUES ('project-a', '项目甲', 'PA')
  `)
  await db.execute(`
    INSERT INTO crews (id, name, trade) VALUES ('crew-a', '泥水班', '泥水工')
  `)
  await db.execute(`
    INSERT INTO workers (id, crew_id, name, trade, current_project_id)
    VALUES ('worker-a', 'crew-a', '张师傅', '泥水工', 'project-a')
  `)
})

afterEach(() => db.close())

async function seedQuantityResponsibility() {
  await db.execute(`
    INSERT INTO buildings (id, project_id, code, name)
    VALUES ('building-a', 'project-a', '1', '1栋')
  `)
  await db.execute(`
    INSERT INTO floors (id, building_id, code, name)
    VALUES ('floor-a', 'building-a', '1', '1层')
  `)
  await db.execute(`
    INSERT INTO house_type_templates (id, project_id, code, name)
    VALUES ('template-a', 'project-a', 'A', 'A户型')
  `)
  await db.execute(`
    INSERT INTO rooms (id, template_id, code, name)
    VALUES ('room-a', 'template-a', 'living', '客厅')
  `)
  await db.execute(`
    INSERT INTO items (id, project_id, code, name, trade, unit)
    VALUES ('item-wall', 'project-a', 'wall', '墙砖铺贴', '泥水工', '㎡')
  `)
  await db.execute(`
    INSERT INTO house_type_template_items (
      id, room_id, item_id, provisional_qty, field_qty, updated_at
    ) VALUES (
      'template-item-wall', 'room-a', 'item-wall', 100, 100, '2026-07-20 09:00:00'
    )
  `)
  await db.execute(`
    INSERT INTO units (id, floor_id, house_type_template_id, code, name)
    VALUES ('unit-a', 'floor-a', 'template-a', '101', '101户')
  `)
  await db.execute(`
    INSERT INTO unit_assignments (id, unit_id, trade, crew_id, updated_at)
    VALUES ('assignment-a', 'unit-a', '泥水工', 'crew-a', '2026-07-20 09:00:00')
  `)
  await db.execute(`
    INSERT INTO construction_stages (id, project_id, code, name, trade)
    VALUES ('stage-wall', 'project-a', 'wall-finished', '墙砖完成', '泥水工')
  `)
  await db.execute(`
    INSERT INTO construction_stage_items (id, stage_id, item_id, is_reporting_stage)
    VALUES ('stage-item-wall', 'stage-wall', 'item-wall', 1)
  `)
  await db.execute(`
    INSERT INTO unit_stage_completions (
      id, unit_id, stage_id, assignment_id, status, completed_at, updated_at
    ) VALUES (
      'completion-wall', 'unit-a', 'stage-wall', 'assignment-a',
      'completed', '2026-07-20', '2026-07-20 09:00:00'
    )
  `)
}

describe('payroll statement lifecycle', () => {
  it('draft may use provisional quantity, checking refreshes field quantity, release freezes the snapshot', async () => {
    const statementId = await createWageStatementDraft(db, {
      projectId: 'project-a',
      crewId: 'crew-a',
      leaderWorkerId: 'worker-a',
      month: '2026-07',
      purpose: 'advance',
      quantitySource: 'provisional',
      payRatio: 0.8,
      lines: [{
        workerId: 'worker-a',
        itemId: 'item-wall',
        itemName: '墙砖铺贴',
        unit: '㎡',
        quantity: 100,
        unitPrice: 20,
      }],
    })

    expect(await loadWageStatement(db, statementId)).toMatchObject({
      status: 'draft',
      quantitySource: 'provisional',
      grossAmount: 1600,
    })

    await checkWageStatement(db, statementId, [{
      workerId: 'worker-a',
      itemId: 'item-wall',
      itemName: '墙砖铺贴',
      unit: '㎡',
      quantity: 92,
      unitPrice: 20,
    }])

    const checked = await loadWageStatement(db, statementId)
    expect(checked).toMatchObject({
      status: 'checked',
      quantitySource: 'field',
      grossAmount: 1472,
      lines: [expect.objectContaining({ quantity: 92, amount: 1840 })],
    })

    await releaseWageStatement(db, statementId, 1450, {
      currentSourceVersion: checked!.checkedSourceVersion,
    })
    const released = await loadWageStatement(db, statementId)
    expect(released).toMatchObject({
      status: 'released',
      quantitySource: 'field',
      actualAmount: 1450,
      grossAmount: 1472,
    })

    await expect(checkWageStatement(db, statementId, [{
      workerId: 'worker-a',
      itemName: '墙砖铺贴',
      unit: '㎡',
      quantity: 110,
      unitPrice: 20,
    }])).rejects.toThrow('已发放')
    expect(await loadWageStatement(db, statementId)).toEqual(released)
  })

  it('never accepts contract quantity as a payable source', async () => {
    await expect(createWageStatementDraft(db, {
      projectId: 'project-a',
      crewId: 'crew-a',
      leaderWorkerId: 'worker-a',
      month: '2026-07',
      purpose: 'advance',
      quantitySource: 'contract' as never,
      payRatio: 0.8,
      lines: [],
    })).rejects.toThrow('暂估量或现场复核量')
  })

  it('subtracts released cumulative pay from the next month payable amount', async () => {
    const firstId = await createWageStatementDraft(db, {
      projectId: 'project-a',
      crewId: 'crew-a',
      leaderWorkerId: 'worker-a',
      month: '2026-07',
      purpose: 'advance',
      periodKind: 'monthly',
      formatFamily: 'A',
      quantitySource: 'field',
      payRatio: 0.8,
      lines: [{
        workerId: 'worker-a',
        itemId: 'item-wall',
        itemName: '墙砖铺贴',
        unit: '㎡',
        quantity: 100,
        unitPrice: 20,
      }],
    })
    await checkWageStatement(db, firstId, [{
      workerId: 'worker-a',
      itemId: 'item-wall',
      itemName: '墙砖铺贴',
      unit: '㎡',
      quantity: 100,
      unitPrice: 20,
    }], {
      sourceVersion: 'field-v1',
      sourceUpdatedAt: '2026-07-20 09:00:00',
    })
    await releaseWageStatement(db, firstId, 1500, {
      currentSourceVersion: 'field-v1',
      operatorName: '项目经理',
    })

    const secondId = await createWageStatementDraft(db, {
      projectId: 'project-a',
      crewId: 'crew-a',
      leaderWorkerId: 'worker-a',
      month: '2026-08',
      purpose: 'advance',
      periodKind: 'monthly',
      formatFamily: 'A',
      quantitySource: 'field',
      payRatio: 0.8,
      lines: [{
        workerId: 'worker-a',
        itemId: 'item-wall',
        itemName: '墙砖铺贴',
        unit: '㎡',
        quantity: 110,
        unitPrice: 20,
      }],
    })

    expect(await loadWageStatement(db, secondId)).toMatchObject({
      cumulativeAmount: 1760,
      previouslyPaid: 1500,
      grossAmount: 260,
    })
  })

  it('blocks zero release and requires recheck when the checked source changed', async () => {
    const statementId = await createWageStatementDraft(db, {
      projectId: 'project-a',
      crewId: 'crew-a',
      leaderWorkerId: 'worker-a',
      month: '2026-07',
      purpose: 'final',
      periodKind: 'settlement',
      formatFamily: 'A',
      quantitySource: 'field',
      payRatio: 0.95,
      lines: [{
        workerId: 'worker-a',
        itemName: '墙砖铺贴',
        unit: '㎡',
        quantity: 100,
        unitPrice: 20,
      }],
    })
    await checkWageStatement(db, statementId, [{
      workerId: 'worker-a',
      itemName: '墙砖铺贴',
      unit: '㎡',
      quantity: 100,
      unitPrice: 20,
    }], {
      sourceVersion: 'field-v1',
      sourceUpdatedAt: '2026-07-20 09:00:00',
    })

    await expect(releaseWageStatement(db, statementId, 0, {
      currentSourceVersion: 'field-v1',
      operatorName: '项目经理',
    })).rejects.toThrow('大于 0')
    await expect(releaseWageStatement(db, statementId, 1800, {
      currentSourceVersion: 'field-v2',
      operatorName: '项目经理',
    })).resolves.toBe('needs_recheck')
    expect(await loadWageStatement(db, statementId)).toMatchObject({
      status: 'checked',
      needsRecheck: true,
    })
  })

  it('recomputes the field source fingerprint before release', async () => {
    await seedQuantityResponsibility()
    const source = await buildWageDraftSource(db, {
      projectId: 'project-a',
      crewId: 'crew-a',
      leaderWorkerId: 'worker-a',
      month: '2026-07',
      formatFamily: 'A',
      quantitySource: 'field',
    })
    const pricedLines = source.lines.map(line => ({ ...line, unitPrice: 20 }))
    const statementId = await createWageStatementDraft(db, {
      projectId: 'project-a',
      crewId: 'crew-a',
      leaderWorkerId: 'worker-a',
      month: '2026-07',
      purpose: 'final',
      periodKind: 'settlement',
      formatFamily: 'A',
      quantitySource: 'field',
      payRatio: 0.95,
      lines: pricedLines,
      sourceVersion: source.sourceVersion,
      sourceUpdatedAt: source.sourceUpdatedAt,
    })
    await checkWageStatement(db, statementId, pricedLines, source)
    await db.execute(`
      UPDATE house_type_template_items
      SET field_qty = 90, updated_at = '2026-07-21 10:00:00'
      WHERE id = 'template-item-wall'
    `)

    await expect(releaseWageStatement(db, statementId, 1800)).resolves.toBe('needs_recheck')
  })

  it('allows one leader to have different format families and settlement periods in the same month', async () => {
    const common = {
      projectId: 'project-a',
      crewId: 'crew-a',
      leaderWorkerId: 'worker-a',
      month: '2026-07',
      quantitySource: 'field' as const,
      lines: [] as const,
    }
    await createWageStatementDraft(db, {
      ...common,
      purpose: 'advance',
      periodKind: 'monthly',
      formatFamily: 'A',
      payRatio: 0.8,
    })
    await createWageStatementDraft(db, {
      ...common,
      purpose: 'advance',
      periodKind: 'monthly',
      formatFamily: 'C1',
      payRatio: 1,
      lines: [{
        workerId: 'worker-a',
        itemName: '计时工资',
        unit: '天',
        quantity: 1,
        unitPrice: 400,
      }],
    })
    await createWageStatementDraft(db, {
      ...common,
      purpose: 'final',
      periodKind: 'settlement',
      formatFamily: 'A',
      payRatio: 0.95,
    })
  })

  it('uses only completed reporting stages for field wages and reports missing field quantity', async () => {
    await seedQuantityResponsibility()
    await db.execute(`
      UPDATE unit_stage_completions
      SET completed_at = '2026-08-01', updated_at = '2026-08-01 09:00:00'
      WHERE id = 'completion-wall'
    `)
    expect((await buildWageDraftSource(db, {
      projectId: 'project-a',
      crewId: 'crew-a',
      leaderWorkerId: 'worker-a',
      month: '2026-07',
      formatFamily: 'A',
      quantitySource: 'field',
    })).lines).toEqual([])

    await db.execute(`
      UPDATE unit_stage_completions
      SET completed_at = '2026-07-20', updated_at = '2026-07-20 09:00:00'
      WHERE id = 'completion-wall'
    `)
    await db.execute(`
      UPDATE house_type_template_items
      SET field_qty = NULL
      WHERE id = 'template-item-wall'
    `)
    await expect(buildWageDraftSource(db, {
      projectId: 'project-a',
      crewId: 'crew-a',
      leaderWorkerId: 'worker-a',
      month: '2026-07',
      formatFamily: 'A',
      quantitySource: 'field',
    })).rejects.toThrow('现场复核量缺失：墙砖铺贴')
  })

  it('rejects unsupported B/C2 books and participants outside the selected project or crew', async () => {
    await expect(createWageStatementDraft(db, {
      projectId: 'project-a',
      crewId: 'crew-a',
      leaderWorkerId: 'worker-a',
      month: '2026-07',
      purpose: 'advance',
      formatFamily: 'B',
      quantitySource: 'field',
      payRatio: 0.8,
      lines: [],
    })).rejects.toThrow('B 类合同清单直报尚未实现')

    await expect(createWageStatementDraft(db, {
      projectId: 'project-a',
      crewId: 'crew-a',
      leaderWorkerId: 'worker-a',
      month: '2026-07',
      purpose: 'final',
      periodKind: 'settlement',
      formatFamily: 'C1',
      quantitySource: 'field',
      payRatio: 0.95,
      lines: [],
    })).rejects.toThrow('C1 当前只支持月度考勤工资')

    await expect(createWageStatementDraft(db, {
      projectId: 'project-a',
      crewId: 'crew-a',
      leaderWorkerId: 'worker-a',
      month: '2026-07',
      purpose: 'advance',
      periodKind: 'monthly',
      formatFamily: 'C1',
      quantitySource: 'field',
      payRatio: 1,
      lines: [],
    })).rejects.toThrow('C1 必须先录入至少一条当月考勤')

    await db.execute(`
      INSERT INTO workers (id, crew_id, name, trade, current_project_id)
      VALUES ('worker-b', NULL, '李师傅', '泥水工', 'project-a')
    `)
    await expect(createWageStatementDraft(db, {
      projectId: 'project-a',
      crewId: 'crew-a',
      leaderWorkerId: 'worker-a',
      memberWorkerIds: ['worker-b'],
      month: '2026-07',
      purpose: 'advance',
      formatFamily: 'A',
      quantitySource: 'field',
      payRatio: 0.8,
      lines: [],
    })).rejects.toThrow('班组归属不一致')
  })
})

describe('attendance register', () => {
  it('upserts one worker-day record and reads the month grid source', async () => {
    await upsertAttendanceRecord(db, {
      projectId: 'project-a',
      crewId: 'crew-a',
      workerId: 'worker-a',
      workDate: '2026-07-03',
      hours: 8,
      overtimeHours: 1.5,
      workContent: '墙砖铺贴',
    })
    await upsertAttendanceRecord(db, {
      projectId: 'project-a',
      crewId: 'crew-a',
      workerId: 'worker-a',
      workDate: '2026-07-03',
      hours: 7.5,
      overtimeHours: 0,
      workContent: '现场收尾',
    })

    expect(await listAttendanceRecords(db, {
      projectId: 'project-a',
      month: '2026-07',
    })).toEqual([expect.objectContaining({
      workerId: 'worker-a',
      workerName: '张师傅',
      workDate: '2026-07-03',
      hours: 7.5,
      overtimeHours: 0,
      workContent: '现场收尾',
    })])
  })

  it('derives the worker crew when saving from the all-crews view', async () => {
    await upsertAttendanceRecord(db, {
      projectId: 'project-a',
      workerId: 'worker-a',
      workDate: '2026-07-04',
      hours: 8,
    })

    expect(await listAttendanceRecords(db, {
      projectId: 'project-a',
      month: '2026-07',
      crewId: 'crew-a',
    })).toEqual([expect.objectContaining({
      workerId: 'worker-a',
      crewId: 'crew-a',
    })])
  })

  it('rejects invalid dates, more than 24 total hours, and C2 attendance', async () => {
    await expect(upsertAttendanceRecord(db, {
      projectId: 'project-a',
      workerId: 'worker-a',
      workDate: '2026-02-31',
      hours: 8,
    })).rejects.toThrow('有效日期')
    await expect(upsertAttendanceRecord(db, {
      projectId: 'project-a',
      workerId: 'worker-a',
      workDate: '2026-07-04',
      hours: 16,
      overtimeHours: 9,
    })).rejects.toThrow('合计不能超过 24')

    await db.execute(`
      INSERT INTO wage_statements (
        id, project_id, crew_id, leader_worker_id, month,
        format_family, quantity_source, pay_ratio
      ) VALUES (
        'legacy-c2-book', 'project-a', 'crew-a', 'worker-a', '2026-07',
        'C2', 'field', 1
      )
    `)
    await expect(upsertAttendanceRecord(db, {
      projectId: 'project-a',
      workerId: 'worker-a',
      workDate: '2026-07-05',
      hours: 8,
    })).rejects.toThrow('C2')
  })

  it('builds C1 time wage lines from attendance instead of quantity assignments', async () => {
    await upsertAttendanceRecord(db, {
      projectId: 'project-a',
      workerId: 'worker-a',
      workDate: '2026-07-06',
      hours: 8,
      overtimeHours: 2,
    })
    const source = await buildWageDraftSource(db, {
      projectId: 'project-a',
      crewId: 'crew-a',
      leaderWorkerId: 'worker-a',
      month: '2026-07',
      formatFamily: 'C1',
      quantitySource: 'field',
      dailyRate: 400,
      overtimeRate: 50,
    })

    expect(source.lines).toEqual([
      expect.objectContaining({ itemName: '计时工资', quantity: 1, unitPrice: 400 }),
      expect.objectContaining({ itemName: '加班工资', quantity: 2, unitPrice: 50 }),
    ])
    const statementId = await createWageStatementDraft(db, {
      projectId: 'project-a',
      crewId: 'crew-a',
      leaderWorkerId: 'worker-a',
      month: '2026-07',
      purpose: 'advance',
      periodKind: 'monthly',
      formatFamily: 'C1',
      quantitySource: 'field',
      payRatio: 1,
      lines: source.lines,
      sourceVersion: source.sourceVersion,
      sourceUpdatedAt: source.sourceUpdatedAt,
    })
    expect(await loadWageStatement(db, statementId)).toMatchObject({
      formatFamily: 'C1',
      grossAmount: 500,
    })
  })

  it('c1 保留不足整天的考勤精度，草稿按实际工时计薪', async () => {
    await upsertAttendanceRecord(db, {
      projectId: 'project-a',
      workerId: 'worker-a',
      workDate: '2026-07-06',
      hours: 7.5,
    })
    const source = await buildWageDraftSource(db, {
      projectId: 'project-a',
      crewId: 'crew-a',
      leaderWorkerId: 'worker-a',
      month: '2026-07',
      formatFamily: 'C1',
      quantitySource: 'field',
      dailyRate: 480,
    })
    const statementId = await createWageStatementDraft(db, {
      projectId: 'project-a',
      crewId: 'crew-a',
      leaderWorkerId: 'worker-a',
      month: '2026-07',
      purpose: 'advance',
      formatFamily: 'C1',
      quantitySource: 'field',
      payRatio: 1,
      lines: source.lines,
      sourceVersion: source.sourceVersion,
    })
    expect(await loadWageStatement(db, statementId)).toMatchObject({
      grossAmount: 450,
      lines: expect.arrayContaining([expect.objectContaining({ quantity: 0.9375, amount: 450 })]),
    })
    await checkWageStatement(db, statementId, source.lines, source)
    expect(await loadWageStatement(db, statementId)).toMatchObject({ status: 'checked', grossAmount: 450 })
  })

  it('c1 档案日薪换算的加班时薪不提前舍入', async () => {
    await db.execute('UPDATE workers SET daily_wage = 481 WHERE id = \'worker-a\'')
    await upsertAttendanceRecord(db, {
      projectId: 'project-a',
      workerId: 'worker-a',
      workDate: '2026-07-06',
      hours: 8,
      overtimeHours: 2,
    })
    const source = await buildWageDraftSource(db, {
      projectId: 'project-a',
      crewId: 'crew-a',
      leaderWorkerId: 'worker-a',
      month: '2026-07',
      formatFamily: 'C1',
      quantitySource: 'field',
    })
    const statementId = await createWageStatementDraft(db, {
      projectId: 'project-a',
      crewId: 'crew-a',
      leaderWorkerId: 'worker-a',
      month: '2026-07',
      purpose: 'advance',
      formatFamily: 'C1',
      quantitySource: 'field',
      payRatio: 1,
      lines: source.lines,
      sourceVersion: source.sourceVersion,
    })
    expect(await loadWageStatement(db, statementId)).toMatchObject({ grossAmount: 601.25 })
  })

  it('c1 同一时间戳内的小幅工时变化也会更新来源版本', async () => {
    async function sourceAt(hours: number) {
      await upsertAttendanceRecord(db, { projectId: 'project-a', workerId: 'worker-a', workDate: '2026-07-06', hours })
      await db.execute('UPDATE attendance_records SET updated_at = \'2026-07-06 10:00:00\'')
      await db.execute('UPDATE workers SET updated_at = \'2026-07-06 10:00:00\'')
      return buildWageDraftSource(db, {
        projectId: 'project-a',
        crewId: 'crew-a',
        leaderWorkerId: 'worker-a',
        month: '2026-07',
        formatFamily: 'C1',
        quantitySource: 'field',
        dailyRate: 480,
      })
    }
    const before = await sourceAt(7.5)
    const after = await sourceAt(7.51)
    expect(after.sourceVersion).not.toBe(before.sourceVersion)
  })

  it('locks C1 attendance after the month wage was released', async () => {
    await db.execute(`
      INSERT INTO wage_statements (
        id, project_id, crew_id, leader_worker_id, month,
        format_family, quantity_source, status, pay_ratio, actual_amount
      ) VALUES (
        'released-c1-book', 'project-a', 'crew-a', 'worker-a', '2026-07',
        'C1', 'field', 'released', 1, 400
      )
    `)

    await expect(upsertAttendanceRecord(db, {
      projectId: 'project-a',
      workerId: 'worker-a',
      workDate: '2026-07-09',
      hours: 8,
    })).rejects.toThrow('C1 工资已发放，考勤已锁定')
  })

  it('uses each C1 member profile wage instead of one shared group rate', async () => {
    await db.execute(`
      UPDATE workers SET daily_wage = 480 WHERE id = 'worker-a'
    `)
    await db.execute(`
      INSERT INTO workers (id, crew_id, name, trade, daily_wage, current_project_id)
      VALUES ('worker-b', 'crew-a', '李师傅', '泥水工', NULL, 'project-a')
    `)
    await upsertAttendanceRecord(db, {
      projectId: 'project-a',
      workerId: 'worker-a',
      workDate: '2026-07-08',
      hours: 8,
      overtimeHours: 1,
    })
    const draftSource = await buildWageDraftSource(db, {
      projectId: 'project-a',
      crewId: 'crew-a',
      leaderWorkerId: 'worker-a',
      memberWorkerIds: ['worker-b'],
      month: '2026-07',
      formatFamily: 'C1',
      quantitySource: 'field',
      dailyRate: 400,
      overtimeRate: 50,
    })
    expect(draftSource.lines).toEqual([
      expect.objectContaining({ workerId: 'worker-a', itemName: '计时工资', unitPrice: 480 }),
      expect.objectContaining({ workerId: 'worker-a', itemName: '加班工资', unitPrice: 60 }),
      expect.objectContaining({
        workerId: 'worker-b',
        itemName: '计时工资',
        quantity: 0,
        unitPrice: 400,
      }),
      expect.objectContaining({
        workerId: 'worker-b',
        itemName: '加班工资',
        quantity: 0,
        unitPrice: 50,
      }),
    ])

    await upsertAttendanceRecord(db, {
      projectId: 'project-a',
      workerId: 'worker-b',
      workDate: '2026-07-08',
      hours: 8,
      overtimeHours: 1,
    })
    const refreshedSource = await buildWageDraftSource(db, {
      projectId: 'project-a',
      crewId: 'crew-a',
      leaderWorkerId: 'worker-a',
      memberWorkerIds: ['worker-b'],
      month: '2026-07',
      formatFamily: 'C1',
      quantitySource: 'field',
      dailyRate: 480,
      overtimeRate: 60,
      fallbackRatesByWorker: {
        'worker-a': { dailyRate: 480, overtimeRate: 60 },
        'worker-b': { dailyRate: 400, overtimeRate: 50 },
      },
    })
    expect(refreshedSource.lines).toEqual([
      expect.objectContaining({ workerId: 'worker-a', itemName: '计时工资', unitPrice: 480 }),
      expect.objectContaining({ workerId: 'worker-a', itemName: '加班工资', unitPrice: 60 }),
      expect.objectContaining({
        workerId: 'worker-b',
        itemName: '计时工资',
        quantity: 1,
        unitPrice: 400,
      }),
      expect.objectContaining({
        workerId: 'worker-b',
        itemName: '加班工资',
        quantity: 1,
        unitPrice: 50,
      }),
    ])
  })
})
