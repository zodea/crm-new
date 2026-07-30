import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import {
  bindScheduleContract,
  previewScheduleContractBinding,
  SCHEDULE_CONTRACT_BIND_OPERATOR,
} from '~/lib/schedule/contract-binding'
import { createMemoryDb } from '../helpers/memory-db'

let db: TestDb

beforeEach(async () => {
  db = await createMemoryDb()
  await runMigrations(db)
  await db.execute(`INSERT INTO projects (id, name) VALUES ('p1', '前期排程项目')`)
  await db.execute(`INSERT INTO buildings (id, project_id, code, name, sort_order) VALUES
    ('b1', 'p1', '1', '1栋', 10),
    ('b2', 'p1', '2', '2栋', 20),
    ('b3', 'p1', '3', '3栋', 30)`)
  await db.execute(`INSERT INTO floors (id, building_id, code, name) VALUES
    ('f1', 'b1', '1', '1层'),
    ('f2', 'b2', '1', '1层')`)
  await db.execute(`INSERT INTO house_type_templates (id, project_id, code, name) VALUES
    ('tpl', 'p1', 'A', 'A户型')`)
  await db.execute(`INSERT INTO rooms (id, template_id, code, name) VALUES
    ('room', 'tpl', 'living', '客厅')`)
  await db.execute(`INSERT INTO units (id, floor_id, house_type_template_id, code) VALUES
    ('u1', 'f1', 'tpl', '101'),
    ('u2', 'f2', 'tpl', '201')`)
  await db.execute(`INSERT INTO items (id, project_id, code, name, trade, unit) VALUES
    ('item-wall', 'p1', 'wall', '墙砖粘贴', '泥水工', 'm²')`)
  await db.execute(`INSERT INTO house_type_template_items
    (id, room_id, item_id, provisional_qty, contract_qty) VALUES
    ('hti-wall', 'room', 'item-wall', 24, 30)`)
  await db.execute(`INSERT INTO contracts (id, no, name, kind, project_id) VALUES
    ('contract-main', 'SG-001', '施工总承包合同', '施工', 'p1')`)
  await db.execute(`INSERT INTO boq_files
    (id, contract_id, file_name, parse_status, line_count) VALUES
    ('boq-file', 'contract-main', '合同清单.xlsx', 'parsed', 2)`)
  await db.execute(`INSERT INTO boq_lines
    (id, boq_file_id, project_id, contract_id, item_id, item_name, unit, qty,
     trace_key, building, sort_order) VALUES
    ('boq-b1-wall', 'boq-file', 'p1', 'contract-main', 'item-wall', '墙砖粘贴', 'm²', 30,
     'sheet·1', '1', 10),
    ('boq-b3-wall', 'boq-file', 'p1', 'contract-main', 'item-wall', '墙砖粘贴', 'm²', 40,
     'sheet·2', '3栋', 20)`)
  await db.execute(`INSERT INTO schedule_groups
    (id, project_id, contract_id, scope_basis, name) VALUES
    ('g1', 'p1', NULL, 'provisional', '前期1-2栋')`)
  await db.execute(`INSERT INTO schedule_group_buildings
    (id, group_id, building_id, sort_order) VALUES
    ('gb1', 'g1', 'b1', 10),
    ('gb2', 'g1', 'b2', 20)`)
  await db.execute(`INSERT INTO construction_stages
    (id, project_id, code, name, trade) VALUES
    ('stage-wall', 'p1', 'wall', '墙砖粘贴', '泥水工')`)
  await db.execute(`INSERT INTO schedule_tasks
    (id, project_id, group_id, name, trade, duration_days, planned_start, planned_finish,
     baseline_start, baseline_finish, has_qty, stage_id, sort_order) VALUES
    ('task-wall', 'p1', 'g1', '墙砖粘贴', '泥水工', 10, '2026-07-01', '2026-07-10',
     '2026-07-01', '2026-07-10', 1, 'stage-wall', 10)`)
  await db.execute(`INSERT INTO task_item_map (id, task_id, item_id) VALUES
    ('task-map-wall', 'task-wall', 'item-wall')`)
})

afterEach(() => db.close())

describe('内部暂估排程绑定施工合同', () => {
  it('先展示楼栋、分项与数量差异，并阻止合同未明确覆盖的楼栋', async () => {
    const preview = await previewScheduleContractBinding(db, 'g1', 'contract-main')

    expect(preview).toMatchObject({
      groupId: 'g1',
      contractId: 'contract-main',
      canBind: false,
      buildings: [
        expect.objectContaining({ id: 'b1', covered: true, contractLineCount: 1 }),
        expect.objectContaining({ id: 'b2', covered: false, contractLineCount: 0 }),
      ],
      extraContractBuildings: [
        expect.objectContaining({ name: '3栋', covered: true }),
      ],
      items: [
        expect.objectContaining({
          id: 'item-wall',
          mapped: true,
          provisionalQty: 48,
          contractQty: 30,
          differenceQty: -18,
        }),
      ],
    })
    expect(preview.blockers).toEqual(['合同清单未明确覆盖楼栋：2栋'])
    expect(preview.warnings).toEqual(['合同还包含分组外楼栋：3栋'])
    await expect(bindScheduleContract(db, 'g1', 'contract-main'))
      .rejects
      .toThrow('合同清单未明确覆盖楼栋：2栋')
    expect(await db.select(`SELECT contract_id, scope_basis FROM schedule_groups WHERE id = 'g1'`))
      .toEqual([{ contract_id: null, scope_basis: 'provisional' }])
  })

  it('合同额外楼栋只警示，排程分项未映射则阻止绑定', async () => {
    await db.execute(`INSERT INTO items (id, project_id, code, name, trade, unit) VALUES
      ('item-floor', 'p1', 'floor', '地砖铺贴', '泥水工', 'm²')`)
    await db.execute(`INSERT INTO schedule_tasks
      (id, project_id, group_id, name, trade, duration_days, planned_start, planned_finish,
       has_qty, stage_id, sort_order) VALUES
      ('task-floor', 'p1', 'g1', '地砖铺贴', '泥水工', 8, '2026-07-11', '2026-07-18',
       1, 'stage-wall', 20)`)
    await db.execute(`INSERT INTO task_item_map (id, task_id, item_id) VALUES
      ('task-map-floor', 'task-floor', 'item-floor')`)
    await db.execute(`INSERT INTO boq_lines
      (id, boq_file_id, project_id, contract_id, item_id, item_name, unit, qty,
       trace_key, building, sort_order) VALUES
      ('boq-b2-wall', 'boq-file', 'p1', 'contract-main', 'item-wall', '墙砖粘贴', 'm²', 36,
       'sheet·3', '2栋', 30)`)

    const preview = await previewScheduleContractBinding(db, 'g1', 'contract-main')

    expect(preview.canBind).toBe(false)
    expect(preview.items).toEqual([
      expect.objectContaining({ id: 'item-floor', mapped: false }),
      expect.objectContaining({ id: 'item-wall', mapped: true }),
    ])
    expect(preview.blockers).toEqual(['合同清单未映射排程分项：地砖铺贴'])
    expect(preview.warnings).toEqual(['合同还包含分组外楼栋：3栋'])
  })

  it('合同清单中的楼栋尚未进入项目区域树时也会提示', async () => {
    await db.execute(`INSERT INTO boq_lines
      (id, boq_file_id, project_id, contract_id, item_id, item_name, unit, qty,
       trace_key, building, sort_order) VALUES
      ('boq-unknown-wall', 'boq-file', 'p1', 'contract-main', 'item-wall', '墙砖粘贴', 'm²', 12,
       'sheet·unknown', '合同新楼栋', 40)`)

    const preview = await previewScheduleContractBinding(db, 'g1', 'contract-main')

    expect(preview.extraContractBuildings).toEqual([
      expect.objectContaining({ name: '3栋', contractLineCount: 1 }),
      expect.objectContaining({ name: '合同新楼栋', contractLineCount: 1 }),
    ])
    expect(preview.warnings).toContain('合同还包含分组外楼栋：合同新楼栋')
  })

  it('全部覆盖后只更新范围依据与合同引用，保留任务、基线和暂估量', async () => {
    await db.execute(`INSERT INTO boq_lines
      (id, boq_file_id, project_id, contract_id, item_id, item_name, unit, qty,
       trace_key, building, sort_order) VALUES
      ('boq-b2-wall', 'boq-file', 'p1', 'contract-main', 'item-wall', '墙砖粘贴', 'm²', 36,
       'sheet·3', '2栋', 30)`)
    await db.execute(`INSERT INTO schedule_task_floor_plans
      (id, task_id, floor_id, item_id, source_basis, provisional_qty,
       planned_start, planned_finish, sort_order)
      VALUES
      (
        'provisional-floor-plan', 'task-wall', 'f1', 'item-wall', 'provisional', 24,
        '2026-07-01', '2026-07-10', 10
      ),
      (
        'provisional-floor-plan-2', 'task-wall', 'f2', 'item-wall', 'provisional', 24,
        '2026-07-01', '2026-07-10', 20
      )`)
    const taskBefore = await db.select(`SELECT * FROM schedule_tasks WHERE id = 'task-wall'`)
    const floorPlanBefore = await db.select(`
      SELECT id, task_id, floor_id, item_id, boq_line_id, source_basis,
             provisional_qty, planned_start, planned_finish
      FROM schedule_task_floor_plans
      WHERE task_id = 'task-wall'
      ORDER BY sort_order
    `)
    await db.execute(`
      UPDATE house_type_template_items
      SET provisional_qty = 999
      WHERE id = 'hti-wall'
    `)
    const quantityBefore = await db.select(`
      SELECT provisional_qty, contract_qty
      FROM house_type_template_items
      WHERE id = 'hti-wall'
    `)

    const preview = await previewScheduleContractBinding(db, 'g1', 'contract-main')

    expect(preview.items).toEqual([
      expect.objectContaining({
        provisionalQty: 48,
        contractQty: 66,
        differenceQty: 18,
      }),
    ])

    const result = await bindScheduleContract(db, 'g1', 'contract-main')

    expect(result.preview.items).toEqual(preview.items)
    expect(result.preview).toMatchObject({
      canBind: true,
      items: [
        expect.objectContaining({
          provisionalQty: 48,
          contractQty: 66,
          differenceQty: 18,
        }),
      ],
    })
    expect(result.logId).toBeTruthy()
    expect(await db.select(`
      SELECT contract_id, scope_basis, contract_bound_at IS NOT NULL AS has_bound_at
      FROM schedule_groups
      WHERE id = 'g1'
    `)).toEqual([{
      contract_id: 'contract-main',
      scope_basis: 'contract',
      has_bound_at: 1,
    }])
    expect(await db.select(`SELECT * FROM schedule_tasks WHERE id = 'task-wall'`)).toEqual(taskBefore)
    expect(await db.select(`
      SELECT id, task_id, floor_id, item_id, boq_line_id, source_basis,
             provisional_qty, planned_start, planned_finish
      FROM schedule_task_floor_plans
      WHERE task_id = 'task-wall'
      ORDER BY sort_order
    `)).toEqual(floorPlanBefore)
    expect(await db.select(`
      SELECT provisional_qty, contract_qty
      FROM house_type_template_items
      WHERE id = 'hti-wall'
    `)).toEqual(quantityBefore)
    expect(await db.select(`
      SELECT operator
      FROM operation_logs
      WHERE id = ?
    `, [result.logId])).toEqual([{ operator: SCHEDULE_CONTRACT_BIND_OPERATOR }])
  })

  it('混合历史与新快照时按分项合并冻结量和兼容暂估量', async () => {
    await db.execute(`INSERT INTO items (id, project_id, code, name, trade, unit) VALUES
      ('item-floor', 'p1', 'floor', '地砖铺贴', '泥水工', 'm²')`)
    await db.execute(`INSERT INTO house_type_template_items
      (id, room_id, item_id, provisional_qty) VALUES
      ('hti-floor', 'room', 'item-floor', 7)`)
    await db.execute(`INSERT INTO schedule_tasks
      (id, project_id, group_id, name, trade, duration_days, planned_start, planned_finish,
       has_qty, stage_id, sort_order) VALUES
      ('task-floor', 'p1', 'g1', '地砖铺贴', '泥水工', 8, '2026-07-11', '2026-07-18',
       1, 'stage-wall', 20)`)
    await db.execute(`INSERT INTO task_item_map (id, task_id, item_id) VALUES
      ('task-map-floor', 'task-floor', 'item-floor')`)
    await db.execute(`INSERT INTO boq_lines
      (id, boq_file_id, project_id, contract_id, item_id, item_name, unit, qty,
       trace_key, building, sort_order) VALUES
      ('boq-b2-wall', 'boq-file', 'p1', 'contract-main', 'item-wall', '墙砖粘贴', 'm²', 36,
       'sheet·3', '2栋', 30),
      ('boq-b1-floor', 'boq-file', 'p1', 'contract-main', 'item-floor', '地砖铺贴', 'm²', 20,
       'sheet·4', '1栋', 40)`)
    await db.execute(`INSERT INTO schedule_task_floor_plans
      (id, task_id, floor_id, item_id, source_basis, provisional_qty,
       planned_start, planned_finish, sort_order)
      VALUES
      (
        'frozen-wall-1', 'task-wall', 'f1', 'item-wall', 'provisional', 24,
        '2026-07-01', '2026-07-10', 10
      ),
      (
        'frozen-wall-2', 'task-wall', 'f2', 'item-wall', 'provisional', 24,
        '2026-07-01', '2026-07-10', 20
      )`)

    const preview = await previewScheduleContractBinding(db, 'g1', 'contract-main')

    expect(preview.canBind).toBe(true)
    expect(preview.items).toEqual([
      expect.objectContaining({
        id: 'item-floor',
        provisionalQty: 14,
        contractQty: 20,
      }),
      expect.objectContaining({
        id: 'item-wall',
        provisionalQty: 48,
        contractQty: 66,
      }),
    ])
  })

  it('拒绝跨项目、非施工合同和已经绑定的分组', async () => {
    await db.execute(`INSERT INTO projects (id, name) VALUES ('p2', '其他项目')`)
    await db.execute(`INSERT INTO contracts (id, name, kind, project_id) VALUES
      ('wrong-project', '其他项目施工合同', '施工', 'p2'),
      ('wrong-kind', '材料采购合同', '材采', 'p1')`)

    await expect(previewScheduleContractBinding(db, 'g1', 'wrong-project'))
      .rejects
      .toThrow('不属于当前项目')
    await expect(previewScheduleContractBinding(db, 'g1', 'wrong-kind'))
      .rejects
      .toThrow('施工合同无效')

    await db.execute(`
      UPDATE schedule_groups
      SET contract_id = 'contract-main', scope_basis = 'contract'
      WHERE id = 'g1'
    `)
    await expect(previewScheduleContractBinding(db, 'g1', 'contract-main'))
      .rejects
      .toThrow('只有待绑定合同')
  })

  it('预览后绑定状态发生变化时不写误导性审计日志', async () => {
    await db.execute(`INSERT INTO boq_lines
      (id, boq_file_id, project_id, contract_id, item_id, item_name, unit, qty,
       trace_key, building, sort_order) VALUES
      ('boq-b2-wall', 'boq-file', 'p1', 'contract-main', 'item-wall', '墙砖粘贴', 'm²', 36,
       'sheet·3', '2栋', 30)`)
    await db.execute(`CREATE TRIGGER schedule_binding_state_changed
      BEFORE UPDATE ON schedule_groups
      WHEN OLD.id = 'g1'
      BEGIN
        UPDATE schedule_groups
        SET scope_basis = 'contract', contract_id = 'contract-main'
        WHERE id = OLD.id;
        SELECT RAISE(IGNORE);
      END`)

    await expect(bindScheduleContract(db, 'g1', 'contract-main'))
      .rejects
      .toThrow('绑定状态已变化')
    expect(await db.select(`
      SELECT id
      FROM operation_logs
      WHERE operator = ?
    `, [SCHEDULE_CONTRACT_BIND_OPERATOR])).toEqual([])
  })
})
