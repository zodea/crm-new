import type { MigrationDb } from '~/lib/db/migrations'
import { describe, expect, it } from 'vitest'
import {
  LATEST_VERSION,
  migrations,
  runMigrations,
} from '~/lib/db/migrations'
import { columnNames, createMemoryDb, listTables } from '../helpers/memory-db'

const F1_MIGRATION_VERSION = 19

const F1_TABLES = [
  'customers',
  'target_costs',
  'target_cost_items',
  'import_batches',
  'reconciliation_issues',
]

const REQUIRED_COLUMNS: Record<string, string[]> = {
  customers: [
    'id',
    'name',
    'aliases',
    'tax_no',
    'legal_rep',
    'registered_address',
    'invoice_name',
    'bank',
    'bank_account',
    'contact',
    'contact_phone',
    'status',
    'note',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  suppliers: [
    'contact_title',
    'credential_reviewed_at',
    'credential_review_note',
    'deleted_at',
  ],
  crews: [
    'default_pay_ratio',
    'rent_subsidy_enabled',
    'rent_subsidy_price',
    'mgmt_fee_enabled',
    'mgmt_fee_price',
    'assignment_level',
    'status',
    'updated_at',
    'deleted_at',
  ],
  workers: [
    'bank_name',
    'bank_account',
    'bank_code',
    'current_project_id',
    'family_group_id',
    'safety_education',
    'status',
    'deleted_at',
  ],
  projects: [
    'customer_id',
    'secondary_customer_id',
    'developer_supervisor',
    'deleted_at',
  ],
  target_costs: [
    'id',
    'project_id',
    'name',
    'is_baseline',
    'contract_revenue',
    'planned_profit',
    'signed_contract_sum',
    'tax_inclusive_total',
    'tax_exclusive_total',
    'tax_amount',
    'status',
    'note',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  target_cost_items: [
    'id',
    'target_cost_id',
    'cost_category',
    'item_name',
    'unit',
    'qty',
    'unit_price',
    'amount',
    'note',
    'sort_order',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  reconciliation_issues: [
    'id',
    'import_batch_id',
    'project_id',
    'entity_type',
    'entity_id',
    'field_name',
    'source_value',
    'metric_key',
    'attribution',
    'status',
    'resolution',
    'created_at',
    'resolved_at',
  ],
}

async function createPreF1Db() {
  const db = await createMemoryDb()
  await runMigrations(
    db,
    migrations.filter(migration => migration.version < F1_MIGRATION_VERSION),
  )
  return db
}

async function createCustomerTableForInterruptedUpgrade(db: MigrationDb) {
  await db.execute(`
    CREATE TABLE customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      aliases TEXT NOT NULL DEFAULT '[]',
      tax_no TEXT NOT NULL DEFAULT '',
      legal_rep TEXT NOT NULL DEFAULT '',
      registered_address TEXT NOT NULL DEFAULT '',
      invoice_name TEXT NOT NULL DEFAULT '',
      bank TEXT NOT NULL DEFAULT '',
      bank_account TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL DEFAULT '',
      contact_phone TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT DEFAULT NULL
    )
  `)
}

describe('v19 F1 基础主数据迁移', () => {
  it('冷启动建立 F1 表、目标列与索引，并移除停止写入的旧列', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)

    expect(LATEST_VERSION).toBe(F1_MIGRATION_VERSION)
    const tables = await listTables(db)
    for (const table of F1_TABLES)
      expect(tables).toContain(table)

    for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
      const columns = await columnNames(db, table)
      for (const column of required)
        expect(columns, `${table} 缺少 ${column}`).toContain(column)
    }

    expect(await columnNames(db, 'suppliers')).not.toContain('parent_supplier_id')
    expect(await columnNames(db, 'projects')).not.toContain('developer')
    expect(await columnNames(db, 'projects')).not.toContain('developer2')
    expect(await columnNames(db, 'workers')).not.toContain('current_project')

    const indexes = (await db.select<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'index'`,
    )).map(row => row.name)
    for (const index of [
      'uq_customers_tax_no',
      'idx_projects_customer',
      'idx_projects_secondary_customer',
      'idx_workers_current_project',
      'idx_target_costs_proj',
      'uq_target_costs_baseline',
      'idx_tci_target',
      'idx_reconciliation_issues_batch',
    ]) {
      expect(indexes).toContain(index)
    }
    db.close()
  })

  it('升级时把唯一旧名称映射到真实 ID，把歧义、缺失和废弃层级写入对账表', async () => {
    const db = await createPreF1Db()
    await createCustomerTableForInterruptedUpgrade(db)
    await db.execute(`
      INSERT INTO customers (id, name)
      VALUES ('customer-ambiguous-a', '重名甲方'), ('customer-ambiguous-b', '重名甲方')
    `)
    await db.execute(`
      INSERT INTO projects (id, name, developer, developer2)
      VALUES
        ('project-form', '表单项目', '新甲方', '重名甲方'),
        ('project-unique', '唯一项目', '', ''),
        ('project-duplicate-a', '重名项目', '', ''),
        ('project-duplicate-b', '重名项目', '', '')
    `)
    await db.execute(`
      INSERT INTO workers (id, name, current_project)
      VALUES
        ('worker-unique', '唯一匹配工人', '唯一项目'),
        ('worker-ambiguous', '重名项目工人', '重名项目'),
        ('worker-missing', '缺失项目工人', '不存在项目'),
        ('worker-empty', '未分配工人', '')
    `)
    await db.execute(`
      INSERT INTO suppliers (id, name, parent_supplier_id)
      VALUES
        ('supplier-parent', '旧总公司', NULL),
        ('supplier-child', '旧分公司', 'supplier-parent')
    `)

    const result = await runMigrations(db)

    expect(result.from).toBe(F1_MIGRATION_VERSION - 1)
    expect(result.to).toBe(F1_MIGRATION_VERSION)
    expect(result.applied).toEqual(['v19 f1-master-data'])

    const [project] = await db.select<{
      customer_id: string | null
      secondary_customer_id: string | null
    }>(`
      SELECT customer_id, secondary_customer_id
      FROM projects
      WHERE id = 'project-form'
    `)
    expect(project.customer_id).toMatch(/^customer_migrated_/)
    expect(project.secondary_customer_id).toBeNull()
    expect(await db.select<{ id: string }>(`
      SELECT id FROM customers WHERE name = '新甲方'
    `)).toEqual([{ id: project.customer_id }])

    expect(await db.select(`
      SELECT id, current_project_id
      FROM workers
      ORDER BY id
    `)).toEqual([
      { id: 'worker-ambiguous', current_project_id: null },
      { id: 'worker-empty', current_project_id: null },
      { id: 'worker-missing', current_project_id: null },
      { id: 'worker-unique', current_project_id: 'project-unique' },
    ])

    expect(await db.select(`
      SELECT entity_type, entity_id, field_name, source_value, attribution
      FROM reconciliation_issues
      ORDER BY entity_type, entity_id, field_name
    `)).toEqual([
      {
        entity_type: 'project',
        entity_id: 'project-form',
        field_name: 'secondary_customer_id',
        source_value: '重名甲方',
        attribution: 'mapping',
      },
      {
        entity_type: 'supplier',
        entity_id: 'supplier-child',
        field_name: 'parent_supplier_id',
        source_value: 'supplier-parent',
        attribution: 'mapping',
      },
      {
        entity_type: 'worker',
        entity_id: 'worker-ambiguous',
        field_name: 'current_project_id',
        source_value: '重名项目',
        attribution: 'mapping',
      },
      {
        entity_type: 'worker',
        entity_id: 'worker-missing',
        field_name: 'current_project_id',
        source_value: '不存在项目',
        attribution: 'missing_source',
      },
    ])
    db.close()
  })

  it('客户税号和目标成本基线唯一约束仅作用于未软删记录', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    await db.execute(`
      INSERT INTO projects (id, name) VALUES ('project-cost', '目标成本项目')
    `)
    await db.execute(`
      INSERT INTO customers (id, name, tax_no)
      VALUES ('customer-active', '活跃客户', '91440000123456789X')
    `)
    await expect(db.execute(`
      INSERT INTO customers (id, name, tax_no)
      VALUES ('customer-duplicate', '重复客户', '91440000123456789X')
    `)).rejects.toThrow(/UNIQUE constraint failed/i)
    await db.execute(`
      UPDATE customers SET deleted_at = '2026-07-25T00:00:00.000Z'
      WHERE id = 'customer-active'
    `)
    await db.execute(`
      INSERT INTO customers (id, name, tax_no)
      VALUES ('customer-after-delete', '软删后客户', '91440000123456789X')
    `)

    await db.execute(`
      INSERT INTO target_costs (id, project_id, name, is_baseline)
      VALUES ('target-baseline', 'project-cost', '开工基线', 1)
    `)
    await expect(db.execute(`
      INSERT INTO target_costs (id, project_id, name, is_baseline)
      VALUES ('target-duplicate', 'project-cost', '重复基线', 1)
    `)).rejects.toThrow(/UNIQUE constraint failed/i)
    await db.execute(`
      UPDATE target_costs SET deleted_at = '2026-07-25T00:00:00.000Z'
      WHERE id = 'target-baseline'
    `)
    await db.execute(`
      INSERT INTO target_costs (id, project_id, name, is_baseline)
      VALUES ('target-after-delete', 'project-cost', '软删后基线', 1)
    `)
    db.close()
  })

  it('比例、布尔、责任层级、目标金额和成本类别由数据库约束兜底', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    await db.execute(`INSERT INTO projects (id, name) VALUES ('project-check', '约束项目')`)

    await expect(db.execute(`
      INSERT INTO crews (id, name, default_pay_ratio)
      VALUES ('crew-invalid-ratio', '比例异常班组', 1.01)
    `)).rejects.toThrow(/CHECK constraint failed/i)
    await expect(db.execute(`
      INSERT INTO crews (id, name, rent_subsidy_enabled)
      VALUES ('crew-invalid-boolean', '布尔异常班组', 2)
    `)).rejects.toThrow(/CHECK constraint failed/i)
    await expect(db.execute(`
      INSERT INTO crews (id, name, assignment_level)
      VALUES ('crew-invalid-level', '层级异常班组', 'project')
    `)).rejects.toThrow(/CHECK constraint failed/i)
    await expect(db.execute(`
      INSERT INTO target_costs (id, project_id, name, planned_profit)
      VALUES ('target-negative', 'project-check', '负数目标', -0.01)
    `)).rejects.toThrow(/CHECK constraint failed/i)

    await db.execute(`
      INSERT INTO target_costs (id, project_id, name)
      VALUES ('target-check', 'project-check', '合法目标')
    `)
    await expect(db.execute(`
      INSERT INTO target_cost_items (id, target_cost_id, cost_category, amount)
      VALUES ('item-invalid-category', 'target-check', '人工', 1)
    `)).rejects.toThrow(/CHECK constraint failed/i)
    await expect(db.execute(`
      INSERT INTO target_cost_items (id, target_cost_id, cost_category, amount)
      VALUES ('item-negative', 'target-check', '工人工资', -1)
    `)).rejects.toThrow(/CHECK constraint failed/i)
    db.close()
  })

  it('v19 up 半途重跑不会重复客户或对账记录', async () => {
    const db = await createPreF1Db()
    await db.execute(`
      INSERT INTO projects (id, name, developer)
      VALUES ('project-retry', '重跑项目', '重跑甲方')
    `)
    await db.execute(`
      INSERT INTO workers (id, name, current_project)
      VALUES ('worker-retry', '重跑工人', '不存在项目')
    `)
    const migration = migrations.find(item => item.version === F1_MIGRATION_VERSION)
    expect(migration).toBeDefined()

    await migration!.up(db)
    await migration!.up(db)

    const [customers] = await db.select<{ total: number }>(`
      SELECT COUNT(*) AS total FROM customers WHERE name = '重跑甲方'
    `)
    const [issues] = await db.select<{ total: number }>(`
      SELECT COUNT(*) AS total
      FROM reconciliation_issues
      WHERE entity_type = 'worker' AND entity_id = 'worker-retry'
    `)
    expect(customers.total).toBe(1)
    expect(issues.total).toBe(1)
    db.close()
  })
})
