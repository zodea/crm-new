import type { MigrationDb } from '~/lib/db/migrations'
import { describe, expect, it } from 'vitest'
import { migrations, runMigrations } from '~/lib/db/migrations'
import { columnNames, createMemoryDb, listTables } from '../helpers/memory-db'

const SCHEDULE_MIGRATION_VERSION = 14

const SCHEDULE_TABLES = [
  'schedule_groups',
  'schedule_group_buildings',
  'schedule_tasks',
  'task_dependencies',
  'task_item_map',
  'schedule_task_floor_plans',
] as const

const REQUIRED_COLUMNS: Record<(typeof SCHEDULE_TABLES)[number], string[]> = {
  schedule_groups: [
    'id',
    'project_id',
    'contract_id',
    'name',
    'sort_order',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  schedule_group_buildings: [
    'id',
    'group_id',
    'building_id',
    'sort_order',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  schedule_tasks: [
    'id',
    'project_id',
    'group_id',
    'parent_id',
    'name',
    'trade',
    'color',
    'duration_days',
    'planned_start',
    'planned_finish',
    'baseline_start',
    'baseline_finish',
    'has_qty',
    'manual_progress',
    'stage_id',
    'sort_order',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  task_dependencies: [
    'id',
    'pred_id',
    'succ_id',
    'dependency_type',
    'lag_days',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  task_item_map: [
    'id',
    'task_id',
    'item_id',
    'boq_line_id',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  schedule_task_floor_plans: [
    'id',
    'task_id',
    'floor_id',
    'boq_line_id',
    'planned_start',
    'planned_finish',
    'is_manual',
    'note',
    'sort_order',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
}

const REQUIRED_INDEXES = [
  'idx_schedule_groups_project',
  'idx_sgb_group',
  'idx_sgb_building',
  'idx_schedule_tasks_project',
  'idx_schedule_tasks_group',
  'idx_schedule_tasks_parent',
  'idx_schedule_tasks_stage',
  'idx_task_deps_pred',
  'idx_task_deps_succ',
  'idx_task_item_map_task',
  'idx_task_item_map_item',
  'idx_schedule_floor_plans_task',
  'idx_schedule_floor_plans_floor',
  'idx_schedule_floor_plans_boq',
  ...SCHEDULE_TABLES.map(table => `idx_${table}_deleted`),
]

interface ForeignKeyDescription {
  source_column: string
  target_table: string
  target_column: string
}

const EXPECTED_FOREIGN_KEYS: Record<(typeof SCHEDULE_TABLES)[number], ForeignKeyDescription[]> = {
  schedule_groups: [
    { source_column: 'project_id', target_table: 'projects', target_column: 'id' },
    { source_column: 'contract_id', target_table: 'contracts', target_column: 'id' },
  ],
  schedule_group_buildings: [
    { source_column: 'group_id', target_table: 'schedule_groups', target_column: 'id' },
    { source_column: 'building_id', target_table: 'buildings', target_column: 'id' },
  ],
  schedule_tasks: [
    { source_column: 'project_id', target_table: 'projects', target_column: 'id' },
    { source_column: 'group_id', target_table: 'schedule_groups', target_column: 'id' },
    { source_column: 'parent_id', target_table: 'schedule_tasks', target_column: 'id' },
    { source_column: 'stage_id', target_table: 'construction_stages', target_column: 'id' },
  ],
  task_dependencies: [
    { source_column: 'pred_id', target_table: 'schedule_tasks', target_column: 'id' },
    { source_column: 'succ_id', target_table: 'schedule_tasks', target_column: 'id' },
  ],
  task_item_map: [
    { source_column: 'task_id', target_table: 'schedule_tasks', target_column: 'id' },
    { source_column: 'item_id', target_table: 'items', target_column: 'id' },
    { source_column: 'boq_line_id', target_table: 'boq_lines', target_column: 'id' },
  ],
  schedule_task_floor_plans: [
    { source_column: 'task_id', target_table: 'schedule_tasks', target_column: 'id' },
    { source_column: 'floor_id', target_table: 'floors', target_column: 'id' },
    { source_column: 'boq_line_id', target_table: 'boq_lines', target_column: 'id' },
  ],
}

async function insertScheduleAncestors(db: MigrationDb): Promise<void> {
  await db.execute(`INSERT INTO projects (id, name) VALUES ('project-schedule', '排程测试项目')`)
  await db.execute(`INSERT INTO buildings (id, project_id, code, name) VALUES ('building-schedule', 'project-schedule', 'B1', '1栋')`)
  await db.execute(`INSERT INTO construction_stages (id, project_id, code, name, trade) VALUES ('stage-schedule', 'project-schedule', 'ST-01', '墙砖铺贴', '泥水工')`)
  await db.execute(`INSERT INTO items (id, project_id, code, name, trade) VALUES ('item-schedule', 'project-schedule', 'IT-01', '墙砖', '泥水工')`)
  await db.execute(`INSERT INTO schedule_groups (id, project_id, name) VALUES ('group-schedule', 'project-schedule', '户内1栋')`)
}

describe('施工进度排程数据底座', () => {
  it('冷启动建立排程表、规格列和查询索引', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)

    expect(await listTables(db)).toEqual(expect.arrayContaining([...SCHEDULE_TABLES]))
    for (const table of SCHEDULE_TABLES) {
      const columns = await columnNames(db, table)
      expect(columns, `${table} 缺少规格列`).toEqual(expect.arrayContaining(REQUIRED_COLUMNS[table]))
      expect(columns.every(column => /^[a-z][a-z0-9_]*$/.test(column))).toBe(true)
    }
    const indexes = await db.select<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'index'`)
    expect(indexes.map(index => index.name)).toEqual(expect.arrayContaining(REQUIRED_INDEXES))
    db.close()
  })

  it('排程表的外键与领域关系一致', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)

    for (const table of SCHEDULE_TABLES) {
      const foreignKeys = await db.select<ForeignKeyDescription>(`
        SELECT "from" AS source_column, "table" AS target_table, "to" AS target_column
        FROM pragma_foreign_key_list(?)
      `, [table])
      expect(foreignKeys, `${table} 外键数量不符`).toHaveLength(EXPECTED_FOREIGN_KEYS[table].length)
      expect(foreignKeys, `${table} 外键目标不符`).toEqual(expect.arrayContaining(EXPECTED_FOREIGN_KEYS[table]))
    }
    db.close()
  })

  it('自动进度、人工进度、计划区间、基线和依赖约束拒绝非法状态', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    await insertScheduleAncestors(db)

    await expect(db.execute(`INSERT INTO schedule_tasks
      (id, project_id, group_id, name, planned_start, planned_finish, has_qty, manual_progress)
      VALUES ('task-auto-invalid', 'project-schedule', 'group-schedule', '自动工序', '2026-07-01', '2026-07-10', 1, 0.5)`))
      .rejects
      .toThrow(/CHECK constraint failed/i)
    await expect(db.execute(`INSERT INTO schedule_tasks
      (id, project_id, group_id, name, planned_start, planned_finish, has_qty, manual_progress)
      VALUES ('task-manual-invalid', 'project-schedule', 'group-schedule', '人工工序', '2026-07-01', '2026-07-10', 0, 1.2)`))
      .rejects
      .toThrow(/CHECK constraint failed/i)
    await expect(db.execute(`INSERT INTO schedule_tasks
      (id, project_id, group_id, name, planned_start, planned_finish, has_qty, manual_progress)
      VALUES ('task-window-invalid', 'project-schedule', 'group-schedule', '倒排工序', '2026-07-10', '2026-07-01', 0, 0)`))
      .rejects
      .toThrow(/CHECK constraint failed/i)

    await db.execute(`INSERT INTO schedule_tasks
      (id, project_id, group_id, name, planned_start, planned_finish, has_qty, stage_id)
      VALUES ('task-auto', 'project-schedule', 'group-schedule', '墙砖铺贴', '2026-07-01', '2026-07-10', 1, 'stage-schedule')`)
    await db.execute(`INSERT INTO schedule_tasks
      (id, project_id, group_id, name, planned_start, planned_finish, has_qty, manual_progress)
      VALUES ('task-manual', 'project-schedule', 'group-schedule', '放线', '2026-07-11', '2026-07-20', 0, 0.4)`)

    await expect(db.execute(`UPDATE schedule_tasks
      SET baseline_start = '2026-07-01', baseline_finish = NULL WHERE id = 'task-auto'`))
      .rejects
      .toThrow(/CHECK constraint failed/i)
    await expect(db.execute(`INSERT INTO task_dependencies
      (id, pred_id, succ_id, dependency_type, lag_days)
      VALUES ('dep-self', 'task-auto', 'task-auto', 'FS', 0)`))
      .rejects
      .toThrow(/CHECK constraint failed/i)
    await expect(db.execute(`INSERT INTO task_dependencies
      (id, pred_id, succ_id, dependency_type, lag_days)
      VALUES ('dep-kind', 'task-auto', 'task-manual', 'XX', 0)`))
      .rejects
      .toThrow(/CHECK constraint failed/i)

    db.close()
  })

  it('分项×楼层计划保持唯一范围并拒绝倒排日期', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    await insertScheduleAncestors(db)
    await db.execute(`INSERT INTO floors (id, building_id, code, name)
      VALUES ('floor-schedule', 'building-schedule', 'F1', '1层')`)
    await db.execute(`INSERT INTO contracts (id, project_id, kind, name)
      VALUES ('contract-schedule', 'project-schedule', '施工', '排程合同')`)
    await db.execute(`INSERT INTO boq_files (id, contract_id, file_name, parse_status)
      VALUES ('boq-file-schedule', 'contract-schedule', '清单.xlsx', 'parsed')`)
    await db.execute(`INSERT INTO boq_lines
      (id, boq_file_id, project_id, contract_id, item_id, item_name, trace_key)
      VALUES (
        'boq-line-schedule',
        'boq-file-schedule',
        'project-schedule',
        'contract-schedule',
        'item-schedule',
        '墙砖',
        '清单·1'
      )`)
    await db.execute(`INSERT INTO schedule_tasks
      (id, project_id, group_id, name, planned_start, planned_finish, has_qty, stage_id)
      VALUES (
        'task-floor-plan',
        'project-schedule',
        'group-schedule',
        '墙砖铺贴',
        '2026-07-01',
        '2026-07-10',
        1,
        'stage-schedule'
      )`)
    await db.execute(`INSERT INTO schedule_task_floor_plans
      (id, task_id, floor_id, boq_line_id, planned_start, planned_finish)
      VALUES (
        'floor-plan',
        'task-floor-plan',
        'floor-schedule',
        'boq-line-schedule',
        '2026-07-01',
        '2026-07-05'
      )`)

    await expect(db.execute(`INSERT INTO schedule_task_floor_plans
      (id, task_id, floor_id, boq_line_id, planned_start, planned_finish)
      VALUES (
        'floor-plan-duplicate',
        'task-floor-plan',
        'floor-schedule',
        'boq-line-schedule',
        '2026-07-06',
        '2026-07-10'
      )`))
      .rejects
      .toThrow(/UNIQUE constraint failed/i)
    await expect(db.execute(`INSERT INTO schedule_task_floor_plans
      (id, task_id, floor_id, boq_line_id, planned_start, planned_finish)
      VALUES (
        'floor-plan-invalid',
        'task-floor-plan',
        'floor-schedule',
        'boq-line-schedule',
        '2026-07-10',
        '2026-07-01'
      )`))
      .rejects
      .toThrow(/CHECK constraint failed/i)

    db.close()
  })

  it('从 v13 升级只新增排程底座并保留既有工程量数据', async () => {
    const db = await createMemoryDb()
    await runMigrations(db, migrations.filter(migration => migration.version < SCHEDULE_MIGRATION_VERSION))
    await db.execute(`INSERT INTO projects (id, name) VALUES ('project-v13', '存量工程量项目')`)
    await db.execute(`INSERT INTO items (id, project_id, code, name, trade) VALUES ('item-v13', 'project-v13', 'ITEM-13', '存量分项', '泥水工')`)

    const result = await runMigrations(
      db,
      migrations.filter(migration => migration.version <= SCHEDULE_MIGRATION_VERSION),
    )

    expect(result.from).toBe(SCHEDULE_MIGRATION_VERSION - 1)
    expect(result.to).toBe(SCHEDULE_MIGRATION_VERSION)
    expect(result.applied).toHaveLength(1)
    expect(await db.select(`SELECT id, name FROM items WHERE id = 'item-v13'`))
      .toEqual([{ id: 'item-v13', name: '存量分项' }])
    db.close()
  })
})
