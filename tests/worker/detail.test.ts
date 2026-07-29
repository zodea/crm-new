import type { TestDb } from '../helpers/memory-db'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { loadWorkerDetail } from '~/lib/worker/detail'
import { createMemoryDb } from '../helpers/memory-db'

let db: TestDb | null = null

async function createDb() {
  db = await createMemoryDb()
  await runMigrations(db)
  return db
}

async function seedMasterData(mem: TestDb) {
  await mem.execute(
    `INSERT INTO projects (id, name, code, status)
     VALUES ('proj_current', '翠湖花园', 'CHHY-01', '施工中'),
            ('proj_history', '锦绣华庭', 'JXHT-01', '已完工')`,
  )
  await mem.execute(
    `INSERT INTO crews (
       id, name, trade, trade_capabilities, item_capabilities,
       contact_name, contact_phone, status, updated_at
     ) VALUES (
       'crew_1', '泥水A班', '泥水工', '["泥水工","防水工"]',
       '["墙砖铺贴","地砖铺贴"]', '虞建华', '13800000001', 'active', '2026-07-01'
     )`,
  )
  await mem.execute(
    `INSERT INTO workers (
       id, crew_id, name, gender, id_card, phone, hometown,
       emergency_contact, emergency_phone, trade, trade_capabilities,
       item_capabilities, skill_level, daily_wage, project_status,
       entry_date, safety_education, note, bank_name, bank_account,
       bank_code, current_project_id, family_group_id, status
     ) VALUES (
       'worker_1', 'crew_1', '王师傅', '男', '440101199001010011',
       '13800000002', '广东广州', '王家属', '13800000003', '泥水工',
       '["防水工"]', '["墙砖铺贴","卫生间防水"]', '高级', 380,
       '在场', '2026-05-01', 1, '现场负责人', '建设银行',
       '6227000000000000', 'CCB', 'proj_current', 'family_1', 'active'
     )`,
  )
  await mem.execute(
    `INSERT INTO workers (
       id, name, phone, trade, family_group_id, status
     ) VALUES ('worker_family', '王家属', '13800000003', '杂工', 'family_1', 'active')`,
  )
  await mem.execute(
    `INSERT INTO file_refs (
       id, owner_type, owner_id, file_name, file_path, file_size, category, uploader, uploaded_at
     ) VALUES (
       'file_1', 'worker', 'worker_1', '高空作业证.pdf', '/docs/cert.pdf',
       1024, '资格证书', '管理员', '2026-06-01'
     )`,
  )
}

async function seedAssignment(mem: TestDb) {
  await mem.execute(
    `INSERT INTO buildings (id, project_id, code, name)
     VALUES ('building_1', 'proj_current', '1', '1栋')`,
  )
  await mem.execute(
    `INSERT INTO floors (id, building_id, code, name)
     VALUES ('floor_1', 'building_1', '2', '2层')`,
  )
  await mem.execute(
    `INSERT INTO house_type_templates (id, project_id, code, name)
     VALUES ('template_1', 'proj_current', 'A', 'A户型')`,
  )
  await mem.execute(
    `INSERT INTO units (id, floor_id, house_type_template_id, code, name)
     VALUES ('unit_1', 'floor_1', 'template_1', '201', '201户')`,
  )
  await mem.execute(
    `INSERT INTO rooms (id, template_id, code, name)
     VALUES ('room_1', 'template_1', 'bath', '卫生间')`,
  )
  await mem.execute(
    `INSERT INTO items (id, project_id, code, name, trade, unit)
     VALUES ('item_1', 'proj_current', 'W001', '卫生间防水', '防水工', 'm²')`,
  )
  await mem.execute(
    `INSERT INTO unit_assignments (id, unit_id, trade, worker_id)
     VALUES ('assignment_1', 'unit_1', '防水工', 'worker_1')`,
  )
  await mem.execute(
    `INSERT INTO unit_assignment_scopes (id, assignment_id, room_id, item_id)
     VALUES ('scope_1', 'assignment_1', 'room_1', 'item_1')`,
  )
  await mem.execute(
    `INSERT INTO construction_stages (id, project_id, code, name, trade)
     VALUES ('stage_1', 'proj_current', 'ST01', '防水一遍', '防水工')`,
  )
  await mem.execute(
    `INSERT INTO unit_stage_completions (
       id, unit_id, stage_id, assignment_id, status, completed_at
     ) VALUES (
       'completion_1', 'unit_1', 'stage_1', 'assignment_1', 'completed', '2026-06-10'
     )`,
  )
}

async function seedLaborFacts(mem: TestDb) {
  await mem.execute(
    `INSERT INTO attendance_records (
       id, project_id, crew_id, worker_id, work_date, hours, overtime_hours, work_content
     ) VALUES (
       'attendance_1', 'proj_current', 'crew_1', 'worker_1',
       '2026-06-11', 8, 2, '卫生间防水'
     )`,
  )
  await mem.execute(
    `INSERT INTO signed_daywork_records (
       id, project_id, crew_id, worker_id, work_date, work_content,
       start_time, end_time, labor_units, witness, confirmed_on, status
     ) VALUES (
       'daywork_1', 'proj_history', 'crew_1', 'worker_1', '2026-04-01',
       '材料搬运', '08:00', '17:00', 1, '项目经理', '2026-04-02', 'confirmed'
     )`,
  )
  await mem.execute(
    `INSERT INTO wage_statements (
       id, project_id, crew_id, leader_worker_id, month, format_family,
       period_kind, purpose, quantity_source, status, pay_ratio,
       gross_amount, actual_amount
     ) VALUES
       (
         'statement_known', 'proj_current', 'crew_1', 'worker_1', '2026-06',
         'A', 'monthly', 'advance', 'provisional', 'released', 0.8, 1200, 960
       ),
       (
         'statement_unknown', 'proj_history', 'crew_1', 'worker_1', '2026-04',
         'A', 'monthly', 'advance', 'field', 'released', 1, 600, 600
       )`,
  )
  await mem.execute(
    `INSERT INTO wage_statement_members (id, statement_id, worker_id, is_leader)
     VALUES ('member_1', 'statement_known', 'worker_1', 1),
            ('member_2', 'statement_unknown', 'worker_1', 1)`,
  )
  await mem.execute(
    `INSERT INTO wage_statement_lines (
       id, statement_id, worker_id, item_name, unit, quantity, unit_price, amount, sort_order
     ) VALUES
       ('line_1', 'statement_known', 'worker_1', '卫生间防水', 'm²', 10, 100, 1000, 1),
       ('line_2', 'statement_unknown', 'worker_1', '材料搬运', '工', 1, 600, 600, 1)`,
  )
  await mem.execute(
    `INSERT INTO wage_statement_allocations (
       id, statement_id, worker_id, allocated_amount_fen
     ) VALUES ('allocation_1', 'statement_known', 'worker_1', 80000)`,
  )
}

afterEach(() => {
  db?.close()
  db = null
})

describe('工人详情只读模型', () => {
  it('按真实关系汇总个人、班组、能力、项目、责任单元和劳务事实', async () => {
    const mem = await createDb()
    await seedMasterData(mem)
    await seedAssignment(mem)
    await seedLaborFacts(mem)

    const detail = await loadWorkerDetail(mem, 'worker_1')

    expect(detail?.worker.name).toBe('王师傅')
    expect(detail?.crew).toMatchObject({ id: 'crew_1', name: '泥水A班' })
    expect(detail?.capabilities).toEqual({
      trades: ['泥水工', '防水工'],
      itemNames: ['墙砖铺贴', '卫生间防水'],
    })
    expect(detail?.relatedWorkers).toEqual([
      expect.objectContaining({ id: 'worker_family', name: '王家属', source: 'family' }),
    ])
    expect(detail?.attachments).toEqual([
      expect.objectContaining({ id: 'file_1', fileName: '高空作业证.pdf', category: '资格证书' }),
    ])
    expect(detail?.assignments).toEqual([
      expect.objectContaining({
        id: 'assignment_1',
        projectName: '翠湖花园',
        unitName: '201户',
        completedStageCount: 1,
        scopes: [{ roomName: '卫生间', itemName: '卫生间防水' }],
      }),
    ])
    expect(detail?.projects).toEqual([
      expect.objectContaining({
        id: 'proj_current',
        sources: expect.arrayContaining(['当前项目', '工程量责任', '考勤', '工资单']),
      }),
      expect.objectContaining({
        id: 'proj_history',
        sources: expect.arrayContaining(['签工', '工资单']),
      }),
    ])
    expect(detail?.attendance).toEqual([
      expect.objectContaining({ hours: 8, overtimeHours: 2, projectName: '翠湖花园' }),
    ])
    expect(detail?.daywork).toEqual([
      expect.objectContaining({ laborUnits: 1, status: 'confirmed', projectName: '锦绣华庭' }),
    ])
    expect(detail?.wageStatements).toEqual([
      expect.objectContaining({
        id: 'statement_known',
        workerLineAmount: 1000,
        allocatedAmount: 800,
        allocationRecorded: true,
      }),
      expect.objectContaining({
        id: 'statement_unknown',
        workerLineAmount: 600,
        allocatedAmount: null,
        allocationRecorded: false,
      }),
    ])
    expect(detail?.summary).toMatchObject({
      projectCount: 2,
      assignedUnitCount: 1,
      completedStageCount: 1,
      attendanceDays: 1,
      attendanceHours: 8,
      overtimeHours: 2,
      confirmedDayworkUnits: 1,
      releasedStatementCount: 2,
      knownAllocatedAmount: 800,
      missingAllocationCount: 1,
    })
  })

  it('无业务事实时返回明确空集合，不制造参与项目或金额', async () => {
    const mem = await createDb()
    await seedMasterData(mem)

    await mem.execute(`UPDATE workers SET current_project_id = NULL WHERE id = 'worker_1'`)
    const detail = await loadWorkerDetail(mem, 'worker_1')

    expect(detail?.projects).toEqual([])
    expect(detail?.assignments).toEqual([])
    expect(detail?.attendance).toEqual([])
    expect(detail?.daywork).toEqual([])
    expect(detail?.wageStatements).toEqual([])
    expect(detail?.summary).toMatchObject({
      projectCount: 0,
      assignedUnitCount: 0,
      knownAllocatedAmount: 0,
      missingAllocationCount: 0,
    })
  })

  it('工人被软删除或祖先项目被软删除后不再暴露相关事实', async () => {
    const mem = await createDb()
    await seedMasterData(mem)
    await seedAssignment(mem)
    await seedLaborFacts(mem)

    await mem.execute(`UPDATE workers SET current_project_id = NULL WHERE id = 'worker_1'`)
    await mem.execute(`UPDATE projects SET deleted_at = '2026-07-29' WHERE id = 'proj_current'`)
    const detail = await loadWorkerDetail(mem, 'worker_1')
    expect(detail?.projects.map(project => project.id)).toEqual(['proj_history'])
    expect(detail?.assignments).toEqual([])
    expect(detail?.attendance).toEqual([])
    expect(detail?.wageStatements.map(statement => statement.id)).toEqual(['statement_unknown'])

    await mem.execute(`UPDATE workers SET deleted_at = '2026-07-29' WHERE id = 'worker_1'`)
    await expect(loadWorkerDetail(mem, 'worker_1')).resolves.toBeNull()
  })
})
