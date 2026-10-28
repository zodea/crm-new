import type { MigrationDb } from '~/lib/db/migrations'
import { describe, expect, it } from 'vitest'
import { LATEST_VERSION, migrations, runMigrations } from '~/lib/db/migrations'
import { columnNames, createMemoryDb, createMigratedMemoryDb, listTables } from '../helpers/memory-db'

const BOQ_MIGRATION_VERSION = 15

const BOQ_TABLES = [
  'boq_files',
  'boq_lines',
  'boq_change_orders',
  'boq_change_lines',
  'monthly_statements',
  'monthly_statement_lines',
] as const

const REQUIRED_COLUMNS: Record<(typeof BOQ_TABLES)[number], string[]> = {
  boq_files: [
    'id',
    'contract_id',
    'file_name',
    'file_path',
    'format_class',
    'parse_status',
    'line_count',
    'note',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  boq_lines: [
    'id',
    'boq_file_id',
    'project_id',
    'contract_id',
    'item_id',
    'section',
    'trade',
    'item_name',
    'unit',
    'qty',
    'unit_price',
    'amount',
    'trace_key',
    'source_sheet',
    'source_row',
    'recognized_qty',
    'recognized_unit_price',
    'building',
    'unit_type',
    'multiplier',
    'room',
    'floor_zone',
    'spec',
    'tax_rate',
    'owner_supplied',
    'change_order_id',
    'sort_order',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  boq_change_orders: [
    'id',
    'project_id',
    'contract_id',
    'code',
    'name',
    'change_type',
    'status',
    'status_note',
    'directive_no',
    'directive_type',
    'total_amount',
    'approved_at',
    'ledger_id',
    'note',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  boq_change_lines: [
    'id',
    'change_order_id',
    'boq_line_id',
    'result_boq_line_id',
    'item_id',
    'operation',
    'section',
    'trade',
    'item_name',
    'unit',
    'spec',
    'delta_qty',
    'new_unit_price',
    'amount',
    'note',
    'sort_order',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  monthly_statements: [
    'id',
    'project_id',
    'contract_id',
    'month',
    'status',
    'total_amount',
    'note',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  monthly_statement_lines: [
    'id',
    'statement_id',
    'boq_line_id',
    'item_name',
    'unit',
    'auto_qty',
    'adjusted_qty',
    'unit_price',
    'amount',
    'note',
    'sort_order',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
}

const REQUIRED_INDEXES = [
  'idx_boq_files_contract',
  'idx_boq_lines_file',
  'idx_boq_lines_project',
  'idx_boq_lines_contract',
  'idx_boq_lines_item',
  'idx_boq_change_orders_project',
  'idx_boq_change_orders_contract',
  'idx_boq_change_orders_status',
  'idx_boq_change_lines_order',
  'idx_monthly_statements_project_month',
  'idx_monthly_statement_lines_statement',
  'idx_hti_boq_line',
  'idx_schedule_groups_contract',
  'idx_task_item_map_boq_line',
  'uq_boq_change_order_ledger',
  'uq_owner_change_order_boq_source',
  'uq_monthly_statement_contract_month',
  ...BOQ_TABLES.map(table => `idx_${table}_deleted`),
]

interface ForeignKeyDescription {
  source_column: string
  target_table: string
  target_column: string
}

async function insertAncestors(db: MigrationDb) {
  await db.execute(`INSERT INTO projects (id, name) VALUES ('project-boq', '清单测试项目')`)
  await db.execute(`INSERT INTO contracts
    (id, no, name, kind, project_id)
    VALUES ('contract-boq', 'SG-001', '施工合同', '施工', 'project-boq')`)
  await db.execute(`INSERT INTO items
    (id, project_id, code, name, trade, unit)
    VALUES ('item-boq', 'project-boq', 'ITEM-001', '墙砖铺贴', '泥水工', '㎡')`)
  await db.execute(`INSERT INTO boq_files
    (id, contract_id, file_name, parse_status)
    VALUES ('boq-file', 'contract-boq', '施工清单.xlsx', 'parsed')`)
  await db.execute(`INSERT INTO boq_lines
    (id, boq_file_id, project_id, contract_id, item_id, item_name, unit, qty, unit_price, amount, trace_key)
    VALUES ('boq-line', 'boq-file', 'project-boq', 'contract-boq', 'item-boq', '墙砖铺贴', '㎡', 100, 80, 8000, '施工清单.xlsx·户内·12')`)
}

describe('v15 BOQ 清单、变更与月度报量数据底座', () => {
  it('冷启动建立六张领域表、跨域引用列和查询索引', async () => {
    const db = await createMigratedMemoryDb()

    expect(await listTables(db)).toEqual(expect.arrayContaining([...BOQ_TABLES]))
    for (const table of BOQ_TABLES) {
      const columns = await columnNames(db, table)
      expect(columns, `${table} 缺少规格列`).toEqual(expect.arrayContaining(REQUIRED_COLUMNS[table]))
    }
    expect(await columnNames(db, 'house_type_template_items')).toContain('boq_line_id')
    expect(await columnNames(db, 'schedule_groups')).toContain('contract_id')
    expect(await columnNames(db, 'task_item_map')).toContain('boq_line_id')
    expect(await columnNames(db, 'owner_change_orders')).toEqual(expect.arrayContaining([
      'source_type',
      'source_id',
      'source_locked',
    ]))

    const indexes = await db.select<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'index'`)
    expect(indexes.map(index => index.name)).toEqual(expect.arrayContaining(REQUIRED_INDEXES))
    db.close()
  })

  it('boq 使用 contracts 施工合同作为 canonical ID，并以 boq_line_id 接入工程量与排程', async () => {
    const db = await createMigratedMemoryDb()

    const expectedForeignKeys: Record<string, ForeignKeyDescription[]> = {
      boq_files: [
        { source_column: 'contract_id', target_table: 'contracts', target_column: 'id' },
      ],
      boq_lines: [
        { source_column: 'boq_file_id', target_table: 'boq_files', target_column: 'id' },
        { source_column: 'project_id', target_table: 'projects', target_column: 'id' },
        { source_column: 'contract_id', target_table: 'contracts', target_column: 'id' },
        { source_column: 'item_id', target_table: 'items', target_column: 'id' },
        { source_column: 'change_order_id', target_table: 'boq_change_orders', target_column: 'id' },
      ],
      boq_change_orders: [
        { source_column: 'project_id', target_table: 'projects', target_column: 'id' },
        { source_column: 'contract_id', target_table: 'contracts', target_column: 'id' },
        { source_column: 'ledger_id', target_table: 'owner_change_orders', target_column: 'id' },
      ],
      boq_change_lines: [
        { source_column: 'change_order_id', target_table: 'boq_change_orders', target_column: 'id' },
        { source_column: 'boq_line_id', target_table: 'boq_lines', target_column: 'id' },
        { source_column: 'result_boq_line_id', target_table: 'boq_lines', target_column: 'id' },
        { source_column: 'item_id', target_table: 'items', target_column: 'id' },
      ],
      monthly_statements: [
        { source_column: 'project_id', target_table: 'projects', target_column: 'id' },
        { source_column: 'contract_id', target_table: 'contracts', target_column: 'id' },
      ],
      monthly_statement_lines: [
        { source_column: 'statement_id', target_table: 'monthly_statements', target_column: 'id' },
        { source_column: 'boq_line_id', target_table: 'boq_lines', target_column: 'id' },
      ],
      house_type_template_items: [
        { source_column: 'boq_line_id', target_table: 'boq_lines', target_column: 'id' },
      ],
      schedule_groups: [
        { source_column: 'contract_id', target_table: 'contracts', target_column: 'id' },
      ],
      task_item_map: [
        { source_column: 'boq_line_id', target_table: 'boq_lines', target_column: 'id' },
      ],
    }

    for (const [table, expected] of Object.entries(expectedForeignKeys)) {
      const foreignKeys = await db.select<ForeignKeyDescription>(`
        SELECT "from" AS source_column, "table" AS target_table, "to" AS target_column
        FROM pragma_foreign_key_list(?)
      `, [table])
      expect(foreignKeys, `${table} 缺少领域外键`).toEqual(expect.arrayContaining(expected))
    }
    db.close()
  })

  it('状态、行类型、唯一单据和自动台账来源约束拒绝重复或非法数据', async () => {
    const db = await createMigratedMemoryDb()
    await insertAncestors(db)

    await expect(db.execute(`INSERT INTO boq_files
      (id, contract_id, file_name, parse_status)
      VALUES ('boq-file-invalid', 'contract-boq', '错误.xlsx', 'confirmed')`))
      .rejects
      .toThrow(/CHECK constraint failed/i)

    await db.execute(`INSERT INTO boq_change_orders
      (id, project_id, contract_id, code, name)
      VALUES ('change-boq', 'project-boq', 'contract-boq', 'BG-001', '墙砖增量')`)
    await expect(db.execute(`INSERT INTO boq_change_lines
      (id, change_order_id, boq_line_id, operation, delta_qty)
      VALUES ('change-line-invalid', 'change-boq', 'boq-line', 'remove', -10)`))
      .rejects
      .toThrow(/CHECK constraint failed/i)
    await expect(db.execute(`UPDATE boq_change_orders SET status = 'cancelled' WHERE id = 'change-boq'`))
      .rejects
      .toThrow(/CHECK constraint failed/i)

    await db.execute(`INSERT INTO monthly_statements
      (id, project_id, contract_id, month)
      VALUES ('monthly-1', 'project-boq', 'contract-boq', '2026-07')`)
    await expect(db.execute(`INSERT INTO monthly_statements
      (id, project_id, contract_id, month)
      VALUES ('monthly-2', 'project-boq', 'contract-boq', '2026-07')`))
      .rejects
      .toThrow(/UNIQUE constraint failed/i)

    await db.execute(`INSERT INTO owner_change_orders
      (id, project_id, source_type, source_id, source_locked)
      VALUES ('ledger-1', 'project-boq', 'boq_change_order', 'change-boq', 1)`)
    await expect(db.execute(`INSERT INTO owner_change_orders
      (id, project_id, source_type, source_id, source_locked)
      VALUES ('ledger-2', 'project-boq', 'boq_change_order', 'change-boq', 1)`))
      .rejects
      .toThrow(/UNIQUE constraint failed/i)
    db.close()
  })

  it('从 v14 升级合并旧施工合同到 canonical contracts，并回填唯一合同的既有排程分组', async () => {
    const db = await createMemoryDb()
    await runMigrations(db, migrations.filter(migration => migration.version < BOQ_MIGRATION_VERSION))
    await db.execute(`INSERT INTO projects (id, name) VALUES ('project-v14-boq', '存量清单项目')`)
    await db.execute(`INSERT INTO construction_contracts
      (id, project_id, name, contract_no, amount, status)
      VALUES ('legacy-contract', 'project-v14-boq', '存量施工合同', 'LEGACY-001', 120000, '履约中')`)
    await db.execute(`INSERT INTO schedule_groups
      (id, project_id, name)
      VALUES ('legacy-schedule-group', 'project-v14-boq', '存量排程分组')`)

    const result = await runMigrations(db)

    expect(result.from).toBe(BOQ_MIGRATION_VERSION - 1)
    expect(result.to).toBe(LATEST_VERSION)
    expect(result.applied).toHaveLength(LATEST_VERSION - (BOQ_MIGRATION_VERSION - 1))
    expect(await db.select(`
      SELECT id, no, name, kind, project_id, amount
      FROM contracts
      WHERE id = 'legacy-contract'
    `)).toEqual([{
      id: 'legacy-contract',
      no: 'LEGACY-001',
      name: '存量施工合同',
      kind: '施工',
      project_id: 'project-v14-boq',
      amount: 120000,
    }])
    expect(await db.select(`
      SELECT id, contract_id
      FROM schedule_groups
      WHERE id = 'legacy-schedule-group'
    `)).toEqual([{
      id: 'legacy-schedule-group',
      contract_id: 'legacy-contract',
    }])
    db.close()
  })
})
