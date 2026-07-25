import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { loadScheduleProject } from '~/lib/schedule/read-model'
import { createMemoryDb } from '../helpers/memory-db'

let db: TestDb

beforeEach(async () => {
  db = await createMemoryDb()
  await runMigrations(db)
  await db.execute(`INSERT INTO projects (id, name) VALUES ('p1', '排程项目')`)
  await db.execute(`INSERT INTO buildings (id, project_id, code, name, sort_order) VALUES
    ('b1', 'p1', '1', '1栋', 10),
    ('b2', 'p1', '2', '2栋', 20)`)
  await db.execute(`INSERT INTO floors (id, building_id, code, name) VALUES
    ('f1', 'b1', '1', '1层'),
    ('f2', 'b2', '1', '1层')`)
  await db.execute(`INSERT INTO house_type_templates (id, project_id, code, name) VALUES
    ('tpl', 'p1', 'A', 'A户型')`)
  await db.execute(`INSERT INTO rooms (id, template_id, code, name) VALUES
    ('room', 'tpl', 'living', '客厅')`)
  await db.execute(`INSERT INTO items (id, project_id, code, name, trade) VALUES
    ('item-wall', 'p1', 'wall', '墙砖', '泥水工')`)
  await db.execute(`INSERT INTO contracts (id, name, kind, project_id) VALUES
    ('contract-main', '排程施工合同', '施工', 'p1')`)
  await db.execute(`INSERT INTO boq_files (id, contract_id, file_name, parse_status, line_count) VALUES
    ('boq-file', 'contract-main', '排程清单.xlsx', 'parsed', 1)`)
  await db.execute(`INSERT INTO boq_lines
    (id, boq_file_id, project_id, contract_id, item_id, item_name, qty, unit_price, trace_key) VALUES
    ('boq-wall', 'boq-file', 'p1', 'contract-main', 'item-wall', '墙砖', 20, 100, 'demo·1')`)
  await db.execute(`INSERT INTO house_type_template_items (id, room_id, item_id, contract_qty) VALUES
    ('line-wall', 'room', 'item-wall', 20)`)
  await db.execute(`INSERT INTO units (id, floor_id, house_type_template_id, code, name) VALUES
    ('u1', 'f1', 'tpl', '101', '101户'),
    ('u2', 'f2', 'tpl', '201', '201户')`)
  await db.execute(`INSERT INTO construction_stages (id, project_id, code, name, trade) VALUES
    ('stage-wall', 'p1', 'wall', '墙砖粘贴', '泥水工')`)
  await db.execute(`INSERT INTO construction_stage_items (id, stage_id, item_id) VALUES
    ('stage-item-wall', 'stage-wall', 'item-wall')`)
  await db.execute(`INSERT INTO crews (id, name, trade) VALUES ('crew', '泥水一班', '泥水工')`)
  await db.execute(`INSERT INTO unit_assignments (id, unit_id, trade, crew_id) VALUES
    ('a1', 'u1', '泥水工', 'crew'),
    ('a2', 'u2', '泥水工', 'crew')`)
  await db.execute(`INSERT INTO unit_stage_completions
    (id, unit_id, stage_id, assignment_id, status, completed_at) VALUES
    ('c1', 'u1', 'stage-wall', 'a1', 'completed', '2026-07-05'),
    ('c2', 'u2', 'stage-wall', 'a2', 'completed', '2026-07-06')`)

  await db.execute(`INSERT INTO schedule_groups (id, project_id, contract_id, name) VALUES
    ('g1', 'p1', 'contract-main', '户内1栋')`)
  await db.execute(`INSERT INTO schedule_group_buildings (id, group_id, building_id) VALUES
    ('gb1', 'g1', 'b1')`)
  await db.execute(`INSERT INTO schedule_tasks
    (id, project_id, group_id, name, trade, duration_days, planned_start, planned_finish, has_qty, stage_id, sort_order) VALUES
    ('task-wall', 'p1', 'g1', '墙砖粘贴', '泥水工', 10, '2026-07-01', '2026-07-10', 1, 'stage-wall', 10)`)
  await db.execute(`INSERT INTO schedule_tasks
    (id, project_id, group_id, name, trade, duration_days, planned_start, planned_finish, has_qty, manual_progress, sort_order) VALUES
    ('task-clean', 'p1', 'g1', '开荒保洁', '杂工', 5, '2026-07-11', '2026-07-15', 0, 0.4, 20)`)
  await db.execute(`INSERT INTO task_item_map (id, task_id, item_id, boq_line_id) VALUES
    ('task-map-wall', 'task-wall', 'item-wall', 'boq-wall')`)
  await db.execute(`INSERT INTO task_dependencies
    (id, pred_id, succ_id, dependency_type, lag_days) VALUES
    ('dep', 'task-wall', 'task-clean', 'FS', 1)`)
})

afterEach(() => db.close())

describe('排程 read model', () => {
  it('自动进度按楼栋分组消费阶段完成，人工工序只读 manual_progress', async () => {
    const project = await loadScheduleProject(db, 'p1', '2026-07-06')

    expect(project).not.toBeNull()
    expect(project!.groups).toHaveLength(1)
    expect(project!.groups[0]).toMatchObject({
      id: 'g1',
      contractId: 'contract-main',
      buildingIds: ['b1'],
      buildingNames: ['1栋'],
    })
    expect(project!.groups[0]!.tasks[0]).toMatchObject({
      id: 'task-wall',
      actualProgress: 1,
      applicableUnits: 1,
      completedUnits: 1,
      actualStart: '2026-07-05',
      actualFinish: '2026-07-05',
      itemIds: ['item-wall'],
      boqLineIds: ['boq-wall'],
    })
    expect(project!.groups[0]!.tasks[1]).toMatchObject({
      id: 'task-clean',
      actualProgress: 0.4,
      applicableUnits: null,
      completedUnits: null,
    })
    expect(project!.dependencies).toEqual([
      expect.objectContaining({ predId: 'task-wall', succId: 'task-clean', dependencyType: 'FS', lagDays: 1 }),
    ])
  })
})
