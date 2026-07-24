import type { Migration, MigrationDb } from '~/lib/db/migrations'
import { describe, expect, it } from 'vitest'
import {
  addColumnIfMissing,
  execScript,
  LATEST_VERSION,
  migrations,
  runMigrations,
} from '~/lib/db/migrations'
import { ALL_SCHEMA } from '~/lib/db/schema'
import { columnNames, createMemoryDb, listTables } from '../helpers/memory-db'

/** 基线 schema 的全部业务表（与 schema.ts 四批建表一一对应） */
const BASELINE_TABLES = [
  'projects',
  'suppliers',
  'invoices',
  'crews',
  'supplier_credentials',
  'project_suppliers',
  'phase_tasks',
  'construction_contracts',
  'owner_change_orders',
  'expenditure_contracts',
  'invoice_applications',
  'receipt_registrations',
  'current_receipts',
  'current_payments',
  'payment_records',
  'workers',
  'settlements',
  'supplement_agreements',
  'contract_line_items',
  'ticket_registrations',
  'payment_applications',
  'file_refs',
  'file_payloads',
]

const QUANTITY_TABLES = [
  'items',
  'buildings',
  'floors',
  'house_type_templates',
  'rooms',
  'units',
  'house_type_template_items',
  'construction_stages',
  'construction_stage_items',
  'unit_assignments',
  'unit_stage_completions',
  'unit_assignment_scopes',
]

const QUANTITY_MIGRATION_VERSION = 12

const QUANTITY_QUERY_INDEXES = [
  'idx_buildings_project',
  'idx_floors_building',
  'idx_units_floor',
  'idx_units_template',
  'idx_rooms_template',
  'idx_items_project',
  'idx_ht_project',
  'idx_hti_room',
  'idx_hti_item',
  'idx_stages_project',
  'idx_stage_items_stage',
  'idx_unit_assignments_unit',
  'idx_unit_assignments_crew',
  'idx_unit_assignments_worker',
  'idx_unit_assignments_trade',
  'idx_uas_assignment',
  'idx_usc_stage_date',
  'idx_usc_unit',
  'idx_usc_assignment',
  ...QUANTITY_TABLES.map(table => `idx_${table}_deleted`),
]

const QUANTITY_ACTIVE_UNIQUE_INDEXES = [
  'uq_building_code',
  'uq_floor_code',
  'uq_unit_code',
  'uq_room_code',
  'uq_room_whole_unit',
  'uq_item_code',
  'uq_ht_code',
  'uq_hti_room_item',
  'uq_stage_code',
  'uq_stage_item',
  'uq_unit_assignment_trade',
  'uq_uas_scope',
  'uq_usc_unit_stage',
]

const QUANTITY_REQUIRED_COLUMNS: Record<string, string[]> = {
  items: ['id', 'project_id', 'code', 'name', 'section', 'trade', 'unit', 'sort_order', 'created_at', 'updated_at', 'deleted_at'],
  buildings: ['id', 'project_id', 'code', 'name', 'sort_order', 'created_at', 'updated_at', 'deleted_at'],
  floors: ['id', 'building_id', 'code', 'name', 'sort_order', 'created_at', 'updated_at', 'deleted_at'],
  house_type_templates: ['id', 'project_id', 'code', 'name', 'copied_from_template_id', 'sort_order', 'created_at', 'updated_at', 'deleted_at'],
  rooms: ['id', 'template_id', 'code', 'name', 'kind', 'sort_order', 'created_at', 'updated_at', 'deleted_at'],
  units: ['id', 'floor_id', 'house_type_template_id', 'code', 'name', 'sort_order', 'created_at', 'updated_at', 'deleted_at'],
  house_type_template_items: ['id', 'room_id', 'item_id', 'recognized_contract_qty', 'contract_qty', 'provisional_qty', 'field_formula', 'field_qty', 'note', 'sort_order', 'created_at', 'updated_at', 'deleted_at'],
  construction_stages: ['id', 'project_id', 'code', 'name', 'trade', 'completion_mode', 'sort_order', 'created_at', 'updated_at', 'deleted_at'],
  construction_stage_items: ['id', 'stage_id', 'item_id', 'created_at', 'updated_at', 'deleted_at'],
  unit_assignments: ['id', 'unit_id', 'trade', 'crew_id', 'worker_id', 'note', 'created_at', 'updated_at', 'deleted_at'],
  unit_stage_completions: ['id', 'unit_id', 'stage_id', 'assignment_id', 'status', 'completed_at', 'note', 'created_at', 'updated_at', 'deleted_at'],
  unit_assignment_scopes: ['id', 'assignment_id', 'room_id', 'item_id', 'created_at', 'updated_at', 'deleted_at'],
}

interface ForeignKeyDescription {
  source_column: string
  target_table: string
  target_column: string
}

const QUANTITY_FOREIGN_KEYS: Record<string, ForeignKeyDescription[]> = {
  items: [{ source_column: 'project_id', target_table: 'projects', target_column: 'id' }],
  buildings: [{ source_column: 'project_id', target_table: 'projects', target_column: 'id' }],
  floors: [{ source_column: 'building_id', target_table: 'buildings', target_column: 'id' }],
  house_type_templates: [
    { source_column: 'project_id', target_table: 'projects', target_column: 'id' },
    { source_column: 'copied_from_template_id', target_table: 'house_type_templates', target_column: 'id' },
  ],
  rooms: [{ source_column: 'template_id', target_table: 'house_type_templates', target_column: 'id' }],
  units: [
    { source_column: 'floor_id', target_table: 'floors', target_column: 'id' },
    { source_column: 'house_type_template_id', target_table: 'house_type_templates', target_column: 'id' },
  ],
  house_type_template_items: [
    { source_column: 'room_id', target_table: 'rooms', target_column: 'id' },
    { source_column: 'item_id', target_table: 'items', target_column: 'id' },
  ],
  construction_stages: [{ source_column: 'project_id', target_table: 'projects', target_column: 'id' }],
  construction_stage_items: [
    { source_column: 'stage_id', target_table: 'construction_stages', target_column: 'id' },
    { source_column: 'item_id', target_table: 'items', target_column: 'id' },
  ],
  unit_assignments: [
    { source_column: 'unit_id', target_table: 'units', target_column: 'id' },
    { source_column: 'crew_id', target_table: 'crews', target_column: 'id' },
    { source_column: 'worker_id', target_table: 'workers', target_column: 'id' },
  ],
  unit_stage_completions: [
    { source_column: 'unit_id', target_table: 'units', target_column: 'id' },
    { source_column: 'stage_id', target_table: 'construction_stages', target_column: 'id' },
    { source_column: 'assignment_id', target_table: 'unit_assignments', target_column: 'id' },
  ],
  unit_assignment_scopes: [
    { source_column: 'assignment_id', target_table: 'unit_assignments', target_column: 'id' },
    { source_column: 'room_id', target_table: 'rooms', target_column: 'id' },
    { source_column: 'item_id', target_table: 'items', target_column: 'id' },
  ],
}

async function seedQuantityFixture(db: MigrationDb): Promise<void> {
  await db.execute(`INSERT INTO projects (id, name, region) VALUES ('project-q', '存量项目', '华东')`)
  await db.execute(`INSERT INTO crews (id, name, trade) VALUES ('crew-q', '墙地砖班组', '瓦工')`)
  await db.execute(`INSERT INTO workers (id, crew_id, name, trade) VALUES ('worker-q', 'crew-q', '王工', '瓦工')`)
  await db.execute(`INSERT INTO items (id, project_id, code, name, trade) VALUES ('item-q', 'project-q', 'ITEM-01', '墙砖铺贴', '瓦工')`)
  await db.execute(`INSERT INTO buildings (id, project_id, code, name) VALUES ('building-q', 'project-q', 'B-01', '1#楼')`)
  await db.execute(`INSERT INTO floors (id, building_id, code, name) VALUES ('floor-q', 'building-q', 'F-01', '1层')`)
  await db.execute(`INSERT INTO house_type_templates (id, project_id, code, name) VALUES ('template-q', 'project-q', 'HT-A', 'A户型')`)
  await db.execute(`INSERT INTO rooms (id, template_id, code, name) VALUES ('room-q', 'template-q', 'ROOM-01', '次卧')`)
  await db.execute(`INSERT INTO units (id, floor_id, house_type_template_id, code, name) VALUES ('unit-q', 'floor-q', 'template-q', 'U-101', '101')`)
  await db.execute(`INSERT INTO construction_stages (id, project_id, code, name, trade) VALUES ('stage-q', 'project-q', 'STAGE-01', '墙砖铺贴', '瓦工')`)
}

describe('迁移机制：版本化顺序迁移', () => {
  it('冷启动：空库收敛到最新版本，全量表建齐', async () => {
    const db = await createMemoryDb()
    const result = await runMigrations(db)

    expect(result.from).toBe(0)
    expect(result.to).toBe(LATEST_VERSION)
    expect(result.applied.length).toBe(migrations.length)

    const tables = await listTables(db)
    for (const t of BASELINE_TABLES) {
      expect(tables, `缺表 ${t}`).toContain(t)
    }
    expect(tables).toContain('schema_migrations')
    db.close()
  })

  it('重复启动幂等：第二次运行不执行任何迁移，已有数据不丢', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    await db.execute(
      `INSERT INTO projects (id, name) VALUES (?, ?)`,
      ['p1', '合和新城'],
    )

    const second = await runMigrations(db)
    expect(second.applied).toEqual([])
    expect(second.from).toBe(LATEST_VERSION)
    expect(second.to).toBe(LATEST_VERSION)

    const rows = await db.select<{ id: string, name: string }>(
      'SELECT id, name FROM projects',
    )
    expect(rows).toEqual([{ id: 'p1', name: '合和新城' }])
    db.close()
  })

  it('升级启动：存量库（有表无版本记录）收敛到最新版本，数据保留', async () => {
    const db = await createMemoryDb()
    // 模拟旧版应用：直接建全量表、写入数据，但没有 schema_migrations
    await execScript(db, ALL_SCHEMA)
    await db.execute(
      `INSERT INTO suppliers (id, name) VALUES (?, ?)`,
      ['s1', '瑞航建材'],
    )
    expect(await listTables(db)).not.toContain('schema_migrations')

    const result = await runMigrations(db)
    expect(result.from).toBe(0)
    expect(result.to).toBe(LATEST_VERSION)

    const rows = await db.select<{ name: string }>('SELECT name FROM suppliers')
    expect(rows).toEqual([{ name: '瑞航建材' }])
    db.close()
  })

  it('版本记录：schema_migrations 留有每个已应用迁移的名称', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    const rows = await db.select<{ version: number, name: string }>(
      'SELECT version, name FROM schema_migrations ORDER BY version',
    )
    expect(rows.map(r => r.version)).toEqual(migrations.map(m => m.version).sort((a, b) => a - b))
    expect(rows[0]?.name).toBe('baseline-full-schema')
    db.close()
  })

  it('顺序执行：迁移列表乱序注册也按 version 升序执行', async () => {
    const db = await createMemoryDb()
    const order: number[] = []
    const list: Migration[] = [
      { version: 3, name: 'third', up: async () => { order.push(3) } },
      { version: 1, name: 'first', up: async () => { order.push(1) } },
      { version: 2, name: 'second', up: async () => { order.push(2) } },
    ]
    const result = await runMigrations(db, list)
    expect(order).toEqual([1, 2, 3])
    expect(result.to).toBe(3)
    db.close()
  })

  it('版本号重复的迁移列表直接报错，不执行任何迁移', async () => {
    const db = await createMemoryDb()
    const list: Migration[] = [
      { version: 1, name: 'a', up: async () => {} },
      { version: 1, name: 'b', up: async () => {} },
    ]
    await expect(runMigrations(db, list)).rejects.toThrow('版本号重复')
    db.close()
  })
})

describe('迁移机制：存量表 ALTER 补列', () => {
  // 版本无关的机制测试：真实 deleted_at 补列已由 v2 落地（见 tests/db/soft-delete.test.ts），
  // 这里用示例列 + LATEST_VERSION+1 验证 ALTER 升级路径本身
  const vNextAddSampleCol: Migration = {
    version: LATEST_VERSION + 1,
    name: 'add-sample-col-projects',
    async up(db) {
      await addColumnIfMissing(db, 'projects', 'sample_col', 'TEXT DEFAULT NULL')
    },
  }

  it('升级路径：存量表补列成功，存量行新列值为 NULL', async () => {
    const db = await createMemoryDb()
    // 先收敛到当前最新版本并写入存量数据
    await runMigrations(db)
    await db.execute(`INSERT INTO projects (id, name) VALUES (?, ?)`, ['p1', '老项目'])

    // 升级到下一版（ALTER 补列）
    const result = await runMigrations(db, [...migrations, vNextAddSampleCol])
    expect(result.from).toBe(LATEST_VERSION)
    expect(result.to).toBe(LATEST_VERSION + 1)

    expect(await columnNames(db, 'projects')).toContain('sample_col')

    const rows = await db.select<{ name: string, sample_col: string | null }>(
      'SELECT name, sample_col FROM projects',
    )
    expect(rows).toEqual([{ name: '老项目', sample_col: null }])
    db.close()
  })

  it('冷启动路径：基线+补列一次跑完，效果与升级路径一致', async () => {
    const db = await createMemoryDb()
    const result = await runMigrations(db, [...migrations, vNextAddSampleCol])
    expect(result.from).toBe(0)
    expect(result.to).toBe(LATEST_VERSION + 1)
    expect(await columnNames(db, 'projects')).toContain('sample_col')
    db.close()
  })

  it('addColumnIfMissing 幂等：列已存在时跳过不报错', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)

    const first = await addColumnIfMissing(db, 'projects', 'sample_col', 'TEXT DEFAULT NULL')
    const second = await addColumnIfMissing(db, 'projects', 'sample_col', 'TEXT DEFAULT NULL')
    expect(first).toBe(true)
    expect(second).toBe(false)
    db.close()
  })

  it('addColumnIfMissing 拒绝非法标识符', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    await expect(
      addColumnIfMissing(db, 'projects; DROP TABLE projects', 'x', 'TEXT'),
    ).rejects.toThrow('非法标识符')
    db.close()
  })

  it('v4 升级路径：存量库遗留的 account_status=\'confirmed\' 回填为 \'none\'，不从台账口径凭空消失', async () => {
    // 只跑到 v3，模拟本 PR 落地前已跑过旧版 confirmInvoice()（写 account_status='confirmed'）的存量库
    // （该 app 走 Tauri 持久化 sqlite 文件，非纯内存，升级前的历史值必须被迁移正确处理）
    const db = await createMemoryDb()
    await runMigrations(db, migrations.filter(m => m.version <= 3))
    await db.execute(
      `INSERT INTO invoices (id, review_status, account_status) VALUES ('inv_legacy', 'reviewed', 'confirmed')`,
    )

    const result = await runMigrations(db)
    expect(result.from).toBe(3)
    expect(result.to).toBe(LATEST_VERSION)

    const [row] = await db.select<{ account_status: string, review_status: string }>(
      `SELECT account_status, review_status FROM invoices WHERE id = 'inv_legacy'`,
    )
    // 回填为 'none'（两态口径的合法值），review_status 不受影响——落回「已确认待归档」过渡态，
    // 而不是既不匹配 'archived' 也不匹配 'none' 从所有台账筛选视图里静默消失
    expect(row.account_status).toBe('none')
    expect(row.review_status).toBe('reviewed')
    db.close()
  })

  it('v5：invoices 增列 items/field_confidence，冷启动与 v4 存量升级两条路径均齐、缺省值合法 JSON', async () => {
    // 冷启动
    const cold = await createMemoryDb()
    await runMigrations(cold)
    const coldCols = await columnNames(cold, 'invoices')
    expect(coldCols).toContain('items')
    expect(coldCols).toContain('field_confidence')
    cold.close()

    // v4 存量升级：先到 v4 插一行，再升到最新，存量行两列取 JSON 缺省
    const db = await createMemoryDb()
    await runMigrations(db, migrations.filter(m => m.version <= 4))
    await db.execute(`INSERT INTO invoices (id) VALUES ('inv_v4')`)
    await runMigrations(db)
    const [row] = await db.select<{ items: string | null, field_confidence: string | null }>(
      `SELECT items, field_confidence FROM invoices WHERE id = 'inv_v4'`,
    )
    // ALTER ADD COLUMN 的 DEFAULT 对存量行按 SQLite 语义生效；无论取到缺省串还是 NULL，读路径都必须能安全解析
    expect(JSON.parse(row.items || '[]')).toEqual([])
    expect(JSON.parse(row.field_confidence || '{}')).toEqual({})
    db.close()
  })

  it('v9：送货明细持久化金额来源，存量独立金额按人工值冻结', async () => {
    const db = await createMemoryDb()
    await runMigrations(db, migrations.filter(m => m.version <= 8))
    await db.execute(`INSERT INTO projects (id, name) VALUES ('p-v8', '存量项目')`)
    await db.execute(`INSERT INTO delivery_records (id, project_id) VALUES ('del-v8', 'p-v8')`)
    await db.execute(`
      INSERT INTO delivery_lines
        (id, delivery_record_id, material_name, qty, unit_price, amount)
      VALUES ('line-v8', 'del-v8', '存量材料', 2, 10, 20)
    `)

    await runMigrations(db)

    expect(await columnNames(db, 'delivery_lines')).toContain('amount_source')
    const [row] = await db.select<{ amount_source: string }>(
      `SELECT amount_source FROM delivery_lines WHERE id = 'line-v8'`,
    )
    expect(row.amount_source).toBe('manual')
    db.close()
  })

  it('v10：送货单原件元数据与正文分表，source 附件对每条归档唯一', async () => {
    const db = await createMemoryDb()
    await runMigrations(db, migrations.filter(m => m.version <= 9))
    await db.execute(`
      INSERT INTO file_refs
        (id, owner_type, owner_id, file_name, category)
      VALUES ('file-legacy', 'delivery_record', 'del-legacy', '旧附件.pdf', 'other')
    `)

    const result = await runMigrations(db)

    expect(result.from).toBe(9)
    expect(result.to).toBe(LATEST_VERSION)
    expect(await columnNames(db, 'file_refs')).toContain('mime_type')
    expect(await columnNames(db, 'file_refs')).not.toContain('content_base64')
    expect(await listTables(db)).toContain('file_payloads')
    expect(await columnNames(db, 'file_payloads')).toEqual(expect.arrayContaining([
      'file_ref_id',
      'encoding',
      'content',
    ]))

    const [legacy] = await db.select<{ mime_type: string | null }>(
      `SELECT mime_type FROM file_refs WHERE id = 'file-legacy'`,
    )
    expect(legacy.mime_type ?? '').toBe('')

    await db.execute(`
      INSERT INTO file_refs
        (id, owner_type, owner_id, file_name, category)
      VALUES ('file-source-1', 'delivery_record', 'del-legacy', '原件一.pdf', 'source')
    `)
    await expect(db.execute(`
      INSERT INTO file_refs
        (id, owner_type, owner_id, file_name, category)
      VALUES ('file-source-2', 'delivery_record', 'del-legacy', '原件二.pdf', 'source')
    `)).rejects.toThrow()
    db.close()
  })

  it('v11：分供方外部旧 ID 持久化并对可见记录去重', async () => {
    const db = await createMemoryDb()
    await runMigrations(db, migrations.filter(m => m.version <= 10))
    await db.execute(`INSERT INTO suppliers (id, name) VALUES ('sup-legacy', '存量分供方')`)

    const result = await runMigrations(db)

    expect(result.from).toBe(10)
    expect(result.to).toBe(LATEST_VERSION)
    expect(await columnNames(db, 'suppliers')).toContain('external_ref')
    const [legacy] = await db.select<{ external_ref: string | null }>(
      `SELECT external_ref FROM suppliers WHERE id = 'sup-legacy'`,
    )
    expect(legacy.external_ref ?? '').toBe('')

    await db.execute(`INSERT INTO suppliers (id, name, external_ref) VALUES ('sup-a', '甲', 'OLD-001')`)
    await expect(db.execute(
      `INSERT INTO suppliers (id, name, external_ref) VALUES ('sup-b', '乙', 'OLD-001')`,
    )).rejects.toThrow()
    db.close()
  })

  it('v12：冷启动建立工程量域表，并为项目增加独立矩阵归档时间', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)

    expect(await listTables(db)).toEqual(expect.arrayContaining(QUANTITY_TABLES))
    expect(await columnNames(db, 'projects')).toContain('matrix_archived_at')
    db.close()
  })

  it('v12：工程量查询链与每张新业务表都有目标索引', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)

    const indexes = await db.select<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'index'`,
    )
    expect(indexes.map(index => index.name)).toEqual(expect.arrayContaining(QUANTITY_QUERY_INDEXES))
    db.close()
  })

  it('v12：工程量自然键只约束未软删记录', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)

    const indexes = await db.select<{ name: string, sql: string }>(
      `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name LIKE 'uq_%'`,
    )
    const quantityIndexes = indexes.filter(index => QUANTITY_ACTIVE_UNIQUE_INDEXES.includes(index.name))
    expect(quantityIndexes.map(index => index.name)).toEqual(expect.arrayContaining(QUANTITY_ACTIVE_UNIQUE_INDEXES))
    expect(quantityIndexes).toHaveLength(QUANTITY_ACTIVE_UNIQUE_INDEXES.length)
    expect(quantityIndexes.every(index => /WHERE deleted_at IS NULL/i.test(index.sql))).toBe(true)
    expect(quantityIndexes.find(index => index.name === 'uq_room_whole_unit')?.sql)
      .toMatch(/kind\s*=\s*'whole_unit'/i)
    db.close()
  })

  it('v12：每个户型模板始终拥有唯一且不可单删的整户范围', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    await db.execute(`INSERT INTO projects (id, name) VALUES ('project-whole', '整户范围项目')`)

    await db.execute(`
      INSERT INTO house_type_templates (id, project_id, code, name)
      VALUES ('template-whole', 'project-whole', 'A', 'A户型')
    `)

    expect(await db.select(`
      SELECT id, template_id, code, name, kind
      FROM rooms
      WHERE template_id = 'template-whole' AND kind = 'whole_unit' AND deleted_at IS NULL
    `)).toEqual([{
      id: 'template-whole:whole_unit',
      template_id: 'template-whole',
      code: '__whole_unit__',
      name: '整户范围',
      kind: 'whole_unit',
    }])
    await expect(db.execute(`
      UPDATE rooms SET deleted_at = '2026-07-20 12:00:00'
      WHERE id = 'template-whole:whole_unit'
    `)).rejects.toThrow(/whole_unit room cannot be deleted/i)
    await expect(db.execute(`
      INSERT INTO rooms (id, template_id, code, name, kind)
      VALUES ('whole-duplicate', 'template-whole', 'WHOLE-2', '另一整户', 'whole_unit')
    `)).rejects.toThrow(/UNIQUE constraint failed/i)
    db.close()
  })
})

describe('v12 工程量底座：升级与约束行为', () => {
  it('v11 升级保留项目、区域、班组和工人，新建工程量树为空', async () => {
    const db = await createMemoryDb()
    const previousMigrations = migrations.filter(migration => migration.version < QUANTITY_MIGRATION_VERSION)
    const quantityMigrations = migrations.filter(migration => migration.version <= QUANTITY_MIGRATION_VERSION)
    await runMigrations(db, previousMigrations)
    await db.execute(`INSERT INTO projects (id, name, region) VALUES ('project-v11', '存量项目', '华南')`)
    await db.execute(`INSERT INTO crews (id, name, trade) VALUES ('crew-v11', '存量班组', '油漆工')`)
    await db.execute(`INSERT INTO workers (id, crew_id, name, trade) VALUES ('worker-v11', 'crew-v11', '存量工人', '油漆工')`)

    const result = await runMigrations(db, quantityMigrations)

    expect(result.from).toBe(QUANTITY_MIGRATION_VERSION - 1)
    expect(result.to).toBe(QUANTITY_MIGRATION_VERSION)
    expect(result.applied).toHaveLength(1)
    expect(await db.select('SELECT id, name, region FROM projects WHERE id = ?', ['project-v11']))
      .toEqual([{ id: 'project-v11', name: '存量项目', region: '华南' }])
    expect(await db.select('SELECT id, name, trade FROM crews WHERE id = ?', ['crew-v11']))
      .toEqual([{ id: 'crew-v11', name: '存量班组', trade: '油漆工' }])
    expect(await db.select('SELECT id, crew_id, name, trade FROM workers WHERE id = ?', ['worker-v11']))
      .toEqual([{ id: 'worker-v11', crew_id: 'crew-v11', name: '存量工人', trade: '油漆工' }])

    for (const table of QUANTITY_TABLES) {
      const [row] = await db.select<{ total: number }>(`SELECT COUNT(*) AS total FROM "${table}"`)
      expect(row.total, `${table} 应为空表`).toBe(0)
    }
    db.close()
  })

  it('新建工程量表使用规格中的 snake_case 物理列', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)

    for (const [table, requiredColumns] of Object.entries(QUANTITY_REQUIRED_COLUMNS)) {
      const columns = await columnNames(db, table)
      expect(columns, `${table} 缺少规格列`).toEqual(expect.arrayContaining(requiredColumns))
      expect(columns.every(column => /^[a-z][a-z0-9_]*$/.test(column)), `${table} 存在非 snake_case 列`).toBe(true)
    }
    expect(await columnNames(db, 'projects')).toContain('matrix_archived_at')
    expect(await columnNames(db, 'projects')).not.toContain('matrixArchivedAt')
    db.close()
  })

  it('pragma 列出完整外键，显式开启外键后拒绝孤儿写入', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)

    for (const [table, expectedForeignKeys] of Object.entries(QUANTITY_FOREIGN_KEYS)) {
      const actualForeignKeys = await db.select<ForeignKeyDescription>(`
        SELECT "from" AS source_column, "table" AS target_table, "to" AS target_column
        FROM pragma_foreign_key_list(?)
      `, [table])
      expect(actualForeignKeys, `${table} 外键数量不符`).toHaveLength(expectedForeignKeys.length)
      expect(actualForeignKeys, `${table} 外键目标不符`).toEqual(expect.arrayContaining(expectedForeignKeys))
    }

    await db.execute('PRAGMA foreign_keys = ON')
    const [foreignKeysPragma] = await db.select<{ foreign_keys: number }>('PRAGMA foreign_keys')
    expect(foreignKeysPragma.foreign_keys).toBe(1)
    await expect(db.execute(`
      INSERT INTO buildings (id, project_id, code, name)
      VALUES ('building-orphan', 'missing-project', 'B-X', '孤儿楼栋')
    `)).rejects.toThrow(/FOREIGN KEY constraint failed/i)
    db.close()
  })

  it('未软删的户工种责任不可重复，软删后可复用同一自然键', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    await seedQuantityFixture(db)
    await db.execute(`
      INSERT INTO unit_assignments (id, unit_id, trade, crew_id)
      VALUES ('assignment-old', 'unit-q', '瓦工', 'crew-q')
    `)

    await expect(db.execute(`
      INSERT INTO unit_assignments (id, unit_id, trade, worker_id)
      VALUES ('assignment-conflict', 'unit-q', '瓦工', 'worker-q')
    `)).rejects.toThrow(/UNIQUE constraint failed/i)

    await db.execute(`UPDATE unit_assignments SET deleted_at = '2026-07-20 12:00:00' WHERE id = 'assignment-old'`)
    await db.execute(`
      INSERT INTO unit_assignments (id, unit_id, trade, worker_id)
      VALUES ('assignment-new', 'unit-q', '瓦工', 'worker-q')
    `)
    expect(await db.select(`
      SELECT id, worker_id
      FROM unit_assignments
      WHERE unit_id = 'unit-q' AND trade = '瓦工' AND deleted_at IS NULL
    `)).toEqual([{ id: 'assignment-new', worker_id: 'worker-q' }])
    db.close()
  })

  it('户工种责任强制班组与个人 XOR', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    await seedQuantityFixture(db)

    await db.execute(`
      INSERT INTO unit_assignments (id, unit_id, trade, crew_id)
      VALUES ('assignment-crew', 'unit-q', '班组责任', 'crew-q')
    `)
    await db.execute(`
      INSERT INTO unit_assignments (id, unit_id, trade, worker_id)
      VALUES ('assignment-worker', 'unit-q', '个人责任', 'worker-q')
    `)
    await expect(db.execute(`
      INSERT INTO unit_assignments (id, unit_id, trade)
      VALUES ('assignment-neither', 'unit-q', '无责任')
    `)).rejects.toThrow(/CHECK constraint failed/i)
    await expect(db.execute(`
      INSERT INTO unit_assignments (id, unit_id, trade, crew_id, worker_id)
      VALUES ('assignment-both', 'unit-q', '双责任', 'crew-q', 'worker-q')
    `)).rejects.toThrow(/CHECK constraint failed/i)

    expect(await db.select<{ id: string }>('SELECT id FROM unit_assignments ORDER BY id'))
      .toEqual([{ id: 'assignment-crew' }, { id: 'assignment-worker' }])
    db.close()
  })

  it('阶段完成事实必须同时带完成时间和当时责任', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    await seedQuantityFixture(db)
    await db.execute(`
      INSERT INTO unit_assignments (id, unit_id, trade, crew_id)
      VALUES ('assignment-completion', 'unit-q', '瓦工', 'crew-q')
    `)

    await expect(db.execute(`
      INSERT INTO unit_stage_completions (id, unit_id, stage_id, status)
      VALUES ('completion-empty', 'unit-q', 'stage-q', 'completed')
    `)).rejects.toThrow(/CHECK constraint failed/i)
    await expect(db.execute(`
      INSERT INTO unit_stage_completions (id, unit_id, stage_id, status, completed_at)
      VALUES ('completion-no-assignment', 'unit-q', 'stage-q', 'completed', '2026-07-20 12:00:00')
    `)).rejects.toThrow(/CHECK constraint failed/i)
    await expect(db.execute(`
      INSERT INTO unit_stage_completions (id, unit_id, stage_id, assignment_id, status)
      VALUES ('completion-no-time', 'unit-q', 'stage-q', 'assignment-completion', 'completed')
    `)).rejects.toThrow(/CHECK constraint failed/i)
    await expect(db.execute(`
      INSERT INTO unit_stage_completions (id, unit_id, stage_id, status)
      VALUES ('completion-invalid-status', 'unit-q', 'stage-q', 'cancelled')
    `)).rejects.toThrow(/CHECK constraint failed/i)

    await db.execute(`
      INSERT INTO unit_stage_completions
        (id, unit_id, stage_id, assignment_id, status, completed_at)
      VALUES
        ('completion-valid', 'unit-q', 'stage-q', 'assignment-completion', 'completed', '2026-07-20 12:00:00')
    `)
    await db.execute(`
      INSERT INTO construction_stages (id, project_id, code, name, trade)
      VALUES ('stage-draft', 'project-q', 'STAGE-02', '墙砖草稿', '瓦工')
    `)
    await db.execute(`
      INSERT INTO unit_stage_completions (id, unit_id, stage_id, status)
      VALUES ('completion-draft', 'unit-q', 'stage-draft', 'draft')
    `)

    expect(await db.select(`
      SELECT id, status, assignment_id, completed_at
      FROM unit_stage_completions
      ORDER BY id
    `)).toEqual([
      { id: 'completion-draft', status: 'draft', assignment_id: null, completed_at: null },
      {
        id: 'completion-valid',
        status: 'completed',
        assignment_id: 'assignment-completion',
        completed_at: '2026-07-20 12:00:00',
      },
    ])
    db.close()
  })

  it('v12 up 半途失败后可重跑，且保留已建表中的数据', async () => {
    const db = await createMemoryDb()
    const previousMigrations = migrations.filter(migration => migration.version < QUANTITY_MIGRATION_VERSION)
    const quantityMigrations = migrations.filter(migration => migration.version <= QUANTITY_MIGRATION_VERSION)
    await runMigrations(db, previousMigrations)
    await db.execute(`INSERT INTO projects (id, name) VALUES ('project-retry', '重跑项目')`)

    let injectedFailure = false
    const interruptedDb: MigrationDb = {
      async execute(sql, params = []) {
        if (!injectedFailure && /CREATE TABLE IF NOT EXISTS floors\b/i.test(sql)) {
          injectedFailure = true
          throw new Error('测试注入：v12 执行中断')
        }
        await db.execute(sql, params)
      },
      select(sql, params = []) {
        return db.select(sql, params)
      },
    }

    await expect(runMigrations(interruptedDb, quantityMigrations)).rejects.toThrow('测试注入：v12 执行中断')
    expect(injectedFailure).toBe(true)
    expect(await listTables(db)).toContain('items')
    expect(await listTables(db)).not.toContain('floors')
    await db.execute(`
      INSERT INTO items (id, project_id, code, name, trade)
      VALUES ('item-before-retry', 'project-retry', 'ITEM-R', '中断前数据', '瓦工')
    `)

    const resumed = await runMigrations(db, quantityMigrations)

    expect(resumed.from).toBe(QUANTITY_MIGRATION_VERSION - 1)
    expect(resumed.to).toBe(QUANTITY_MIGRATION_VERSION)
    expect(resumed.applied).toHaveLength(1)
    expect(await db.select(`
      SELECT id, project_id, code, name, trade
      FROM items
      WHERE id = 'item-before-retry'
    `)).toEqual([{
      id: 'item-before-retry',
      project_id: 'project-retry',
      code: 'ITEM-R',
      name: '中断前数据',
      trade: '瓦工',
    }])
    const [versionRecord] = await db.select<{ total: number }>(
      'SELECT COUNT(*) AS total FROM schema_migrations WHERE version = ?',
      [QUANTITY_MIGRATION_VERSION],
    )
    expect(versionRecord.total).toBe(1)
    db.close()
  })

  it('模板房间改名后三量明细与个人范围仍按稳定 ID 指向同一房间', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    await seedQuantityFixture(db)
    await db.execute(`
      INSERT INTO house_type_template_items (id, room_id, item_id, contract_qty)
      VALUES ('template-item-q', 'room-q', 'item-q', 12.5)
    `)
    await db.execute(`
      INSERT INTO unit_assignments (id, unit_id, trade, worker_id)
      VALUES ('assignment-room-q', 'unit-q', '瓦工', 'worker-q')
    `)
    await db.execute(`
      INSERT INTO unit_assignment_scopes (id, assignment_id, room_id, item_id)
      VALUES ('scope-room-q', 'assignment-room-q', 'room-q', 'item-q')
    `)

    await db.execute(`UPDATE rooms SET name = '主卧' WHERE id = 'room-q'`)

    const links = await db.select(`
      SELECT
        template_item.room_id AS template_room_id,
        assignment_scope.room_id AS scope_room_id,
        room.name AS room_name
      FROM house_type_template_items AS template_item
      JOIN unit_assignment_scopes AS assignment_scope
        ON assignment_scope.room_id = template_item.room_id
        AND assignment_scope.item_id = template_item.item_id
      JOIN rooms AS room ON room.id = template_item.room_id
      WHERE template_item.id = 'template-item-q'
        AND assignment_scope.id = 'scope-room-q'
    `)
    expect(links).toEqual([{
      template_room_id: 'room-q',
      scope_room_id: 'room-q',
      room_name: '主卧',
    }])
    expect(await db.select(`SELECT id FROM rooms WHERE name = '次卧'`)).toEqual([])
    db.close()
  })
})

describe('v13 工程量报量阶段映射：单一计量入口', () => {
  it('升级时为每个分项选择最终阶段，并禁止多个活跃报量阶段', async () => {
    const db = await createMemoryDb()
    await runMigrations(db, migrations.filter(migration => migration.version <= QUANTITY_MIGRATION_VERSION))
    await db.execute(`INSERT INTO projects (id, name) VALUES ('project-reporting', '报量项目')`)
    await db.execute(`INSERT INTO items
      (id, project_id, code, name, trade) VALUES
      ('item-reporting', 'project-reporting', 'ITEM-R', '防水', '防水工')`)
    await db.execute(`INSERT INTO construction_stages
      (id, project_id, code, name, trade, sort_order) VALUES
      ('stage-reporting-1', 'project-reporting', 'WP-01', '防水一遍', '防水工', 10),
      ('stage-reporting-2', 'project-reporting', 'WP-02', '防水二遍', '防水工', 20)`)
    await db.execute(`INSERT INTO construction_stage_items
      (id, stage_id, item_id) VALUES
      ('mapping-reporting-1', 'stage-reporting-1', 'item-reporting'),
      ('mapping-reporting-2', 'stage-reporting-2', 'item-reporting')`)

    const result = await runMigrations(db)

    expect(result.to).toBe(LATEST_VERSION)
    expect(await columnNames(db, 'construction_stage_items')).toContain('is_reporting_stage')
    expect(await db.select(`SELECT id, is_reporting_stage
      FROM construction_stage_items ORDER BY id`)).toEqual([
      { id: 'mapping-reporting-1', is_reporting_stage: 0 },
      { id: 'mapping-reporting-2', is_reporting_stage: 1 },
    ])
    await expect(db.execute(`UPDATE construction_stage_items
      SET is_reporting_stage = 1 WHERE id = 'mapping-reporting-1'`)).rejects.toThrow(/UNIQUE constraint failed/i)
    db.close()
  })
})

describe('vitest 基建：sql.js 内存库可跑业务断言', () => {
  it('示例：全量 schema 上插入并查回一条项目记录', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)

    await db.execute(
      `INSERT INTO projects (id, name, contract_amount, status) VALUES (?, ?, ?, ?)`,
      ['demo-1', '示例项目', 1234567.89, '施工中'],
    )
    const [row] = await db.select<{
      id: string
      name: string
      contract_amount: number
      status: string
      created_at: string
    }>('SELECT id, name, contract_amount, status, created_at FROM projects WHERE id = ?', ['demo-1'])

    expect(row.name).toBe('示例项目')
    expect(row.contract_amount).toBeCloseTo(1234567.89)
    expect(row.status).toBe('施工中')
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    db.close()
  })
})
