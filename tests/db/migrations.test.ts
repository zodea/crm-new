import type { Migration } from '~/lib/db/migrations'
import { describe, expect, it } from 'vitest'
import {
  addColumnIfMissing,
  execScript,
  getCurrentVersion,
  LATEST_VERSION,
  migrations,
  runMigrations,
} from '~/lib/db/migrations'
import { ALL_SCHEMA } from '~/lib/db/schema'
import { columnNames, createMemoryDb, listTables } from '../helpers/memory-db'

/** 基线 schema 的全部业务表（与 schema.ts 四批建表一一对应） */
const BASELINE_TABLES = [
  'projects', 'suppliers', 'invoices', 'crews',
  'supplier_credentials', 'project_suppliers', 'phase_tasks',
  'construction_contracts', 'owner_change_orders', 'expenditure_contracts',
  'invoice_applications', 'receipt_registrations', 'current_receipts',
  'current_payments', 'payment_records', 'workers',
  'settlements', 'supplement_agreements', 'contract_line_items',
  'ticket_registrations', 'payment_applications', 'file_refs',
]

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
