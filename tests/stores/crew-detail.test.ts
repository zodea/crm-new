import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCrewDetailStore } from '~/stores/crew-detail'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let mem: TestDb

vi.mock('~/lib/db/connection', () => ({
  select: <T>(sql: string, params?: unknown[]) => mem.select<T>(sql, params),
}))

beforeEach(async () => {
  mem = await createMigratedMemoryDb()
  setActivePinia(createPinia())

  await mem.execute(`
    INSERT INTO projects (id, name, code, status)
    VALUES
      ('project-a', '合和新城', 'HHXC-01', '施工中'),
      ('project-b', '锦绣华庭', 'JXHT-01', '施工中'),
      ('project-deleted', '已删项目', 'DEL-01', '施工中')
  `)
  await mem.execute(`
    UPDATE projects SET deleted_at = '2026-07-01T00:00:00.000Z'
    WHERE id = 'project-deleted'
  `)
  await mem.execute(`
    INSERT INTO crews (
      id, name, trade, trade_capabilities, item_capabilities,
      contact_name, contact_phone, default_pay_ratio,
      rent_subsidy_enabled, rent_subsidy_price,
      mgmt_fee_enabled, mgmt_fee_price, assignment_level,
      note, status
    )
    VALUES (
      'crew-a', '泥水A班', '泥水工', '["防水工"]', '["墙砖","地砖"]',
      '虞师傅', '13700110001', 0.95,
      1, 3.5, 0, NULL, 'crew',
      '住宅精装主力班组', 'submitted'
    )
  `)
  await mem.execute(`
    INSERT INTO workers (
      id, crew_id, name, trade, phone, current_project_id,
      project_status, entry_date, linked_worker_id, status
    )
    VALUES
      (
        'worker-a', 'crew-a', '虞建华', '泥水工', '13511220001',
        'project-a', '在场', '2025-01-02', NULL, 'submitted'
      ),
      (
        'worker-b', 'crew-a', '王芳', '泥水工', '13511220002',
        'project-a', '在场', '2025-01-02', 'worker-a', 'submitted'
      ),
      (
        'worker-left', 'crew-a', '李强', '泥水工', '13511220003',
        'project-b', '离场', '2024-09-01', NULL, 'submitted'
      ),
      (
        'worker-deleted', 'crew-a', '已删工人', '泥水工', '',
        'project-a', '离场', '', NULL, 'submitted'
      )
  `)
  await mem.execute(`
    UPDATE workers SET deleted_at = '2026-07-02T00:00:00.000Z'
    WHERE id = 'worker-deleted'
  `)

  await mem.execute(`
    INSERT INTO buildings (id, project_id, code, name)
    VALUES
      ('building-a', 'project-a', '1', '1栋'),
      ('building-deleted', 'project-deleted', '1', '1栋')
  `)
  await mem.execute(`
    INSERT INTO floors (id, building_id, code, name)
    VALUES
      ('floor-a', 'building-a', '1', '1层'),
      ('floor-deleted', 'building-deleted', '1', '1层')
  `)
  await mem.execute(`
    INSERT INTO house_type_templates (id, project_id, code, name)
    VALUES
      ('template-a', 'project-a', 'A', 'A户型'),
      ('template-deleted', 'project-deleted', 'A', 'A户型')
  `)
  await mem.execute(`
    INSERT INTO units (id, floor_id, house_type_template_id, code, name)
    VALUES
      ('unit-a', 'floor-a', 'template-a', '0101', '0101'),
      ('unit-deleted', 'floor-deleted', 'template-deleted', '0101', '0101')
  `)
  await mem.execute(`
    INSERT INTO unit_assignments (id, unit_id, trade, crew_id)
    VALUES
      ('assignment-a', 'unit-a', '泥水工', 'crew-a'),
      ('assignment-deleted-project', 'unit-deleted', '泥水工', 'crew-a')
  `)
  await mem.execute(`
    INSERT INTO construction_stages (id, project_id, code, name, trade)
    VALUES ('stage-a', 'project-a', 'wall-tile', '墙砖铺贴', '泥水工')
  `)
  await mem.execute(`
    INSERT INTO unit_stage_completions (
      id, unit_id, stage_id, assignment_id, status, completed_at
    )
    VALUES (
      'completion-a', 'unit-a', 'stage-a', 'assignment-a',
      'completed', '2026-06-03'
    )
  `)
  await mem.execute(`
    INSERT INTO wage_statements (
      id, project_id, crew_id, leader_worker_id, month,
      format_family, period_kind, purpose, quantity_source, status,
      gross_amount, actual_amount
    )
    VALUES (
      'wage-a', 'project-b', 'crew-a', 'worker-a', '2026-06',
      'A', 'monthly', 'advance', 'provisional', 'released',
      1200, 1000
    )
  `)
  await mem.execute(`
    INSERT INTO penalty_records (
      id, no, projectId, crewId, source, reason, amount,
      penaltyDate, status, location
    )
    VALUES (
      'penalty-a', 'FK-001', 'project-a', 'crew-a', 'inspection',
      '墙砖空鼓', 300, '2026-06-18', 'pending', '1栋-1层-0101'
    )
  `)
})

afterEach(() => {
  mem.close()
})

describe('crew detail store', () => {
  it('读取班组主数据、能力、成员以及真实项目/工程量/工资/扣罚关联', async () => {
    const store = useCrewDetailStore()

    await store.load('crew-a')

    const detail = store.byCrew('crew-a')
    expect(detail?.crew).toMatchObject({
      id: 'crew-a',
      name: '泥水A班',
      tradeCapabilities: ['泥水工', '防水工'],
      itemCapabilities: ['墙砖', '地砖'],
      assignmentLevel: 'crew',
    })
    expect(detail?.members).toHaveLength(3)
    expect(detail?.members).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'worker-a',
        name: '虞建华',
        currentProjectName: '合和新城',
      }),
      expect.objectContaining({
        id: 'worker-b',
        name: '王芳',
        linkedWorkerName: '虞建华',
      }),
      expect.objectContaining({
        id: 'worker-left',
        name: '李强',
        projectStatus: '离场',
      }),
    ]))
    expect(detail?.projects).toEqual([
      expect.objectContaining({
        projectId: 'project-a',
        projectName: '合和新城',
        sources: ['在场成员', '工程量责任'],
        activeMemberCount: 2,
        assignmentCount: 1,
        assignedUnitCount: 1,
        completedStageCount: 1,
      }),
      expect.objectContaining({
        projectId: 'project-b',
        projectName: '锦绣华庭',
        sources: ['工资单'],
        activeMemberCount: 0,
        wageStatementCount: 1,
        wageGrossAmount: 1200,
        releasedWageAmount: 1000,
      }),
    ])
    expect(detail?.penalties).toEqual([
      expect.objectContaining({
        id: 'penalty-a',
        projectName: '合和新城',
        reason: '墙砖空鼓',
        amount: 300,
      }),
    ])
    expect(detail?.summary).toEqual({
      memberCount: 3,
      activeMemberCount: 2,
      projectCount: 2,
      assignedUnitCount: 1,
      completedStageCount: 1,
      wageStatementCount: 1,
      releasedWageAmount: 1000,
      penaltyAmount: 300,
    })
  })

  it('不存在或已软删的班组返回 null，且不会残留上一次详情', async () => {
    await mem.execute(`
      INSERT INTO crews (id, name, trade)
      VALUES ('crew-deleted', '已删班组', '木工')
    `)
    await mem.execute(`
      UPDATE crews SET deleted_at = '2026-07-03T00:00:00.000Z'
      WHERE id = 'crew-deleted'
    `)

    const store = useCrewDetailStore()

    await expect(store.load('missing')).resolves.toBeNull()
    await expect(store.load('crew-deleted')).resolves.toBeNull()
    expect(store.hasSnapshot('missing')).toBe(true)
    expect(store.byCrew('missing')).toBeNull()
  })
})
