import type { MigrationDb } from '~/lib/db/migrations'
import { describe, expect, it } from 'vitest'
import {
  LATEST_VERSION,
  migrations,
  runMigrations,
} from '~/lib/db/migrations'
import { columnNames, createMemoryDb, listTables } from '../helpers/memory-db'

const F5_MIGRATION_VERSION = 24

async function createPreF5Db() {
  const db = await createMemoryDb()
  await runMigrations(
    db,
    migrations.filter(migration => migration.version < F5_MIGRATION_VERSION),
  )
  return db
}

async function seedReferences(db: MigrationDb) {
  await db.execute(`
    INSERT INTO customers (id, name)
    VALUES ('customer-f5', 'F5 客户')
  `)
  await db.execute(`
    INSERT INTO projects (id, name, customer_id)
    VALUES ('project-f5', 'F5 项目', 'customer-f5')
  `)
  await db.execute(`
    INSERT INTO suppliers (id, name)
    VALUES ('supplier-f5', 'F5 分供方')
  `)
  await db.execute(`
    INSERT INTO crews (id, name)
    VALUES ('crew-f5', 'F5 班组')
  `)
  await db.execute(`
    INSERT INTO contracts (
      id, no, name, kind, project_id, supplier_id, amount, changed, status
    )
    VALUES
      (
        'contract-owner-f5', 'SG-F5', 'F5 施工合同', '施工',
        'project-f5', NULL, 1000, 1200, '履约中'
      ),
      (
        'contract-sub-f5', 'FB-F5', 'F5 分包合同', '分包',
        'project-f5', 'supplier-f5', 500, 560, '履约中'
      )
  `)
}

describe('v24 F5 甲方/分包单据迁移', () => {
  it('冷启动建立目标表、扩展列、真实外键和抵扣关系索引', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)

    expect(LATEST_VERSION).toBeGreaterThanOrEqual(F5_MIGRATION_VERSION)
    const tables = await listTables(db)
    for (const table of [
      'project_acceptances',
      'owner_final_settlements',
      'owner_penalties',
      'subcontract_change_orders',
      'penalty_records',
      'penalty_settlement_deductions',
    ]) {
      expect(tables).toContain(table)
    }

    expect(await columnNames(db, 'boq_change_orders')).toEqual(expect.arrayContaining([
      'change_type',
      'document_type',
      'application_date',
      'reason',
      'approved_tax_inclusive_amount',
      'approved_tax_exclusive_amount',
      'applied_tax_exclusive_amount',
    ]))
    expect(await columnNames(db, 'monthly_statements')).toEqual(expect.arrayContaining([
      'no',
      'period_no',
      'application_date',
      'reported_amount',
      'audited_amount',
    ]))
    expect(await columnNames(db, 'monthly_statement_lines')).toEqual(expect.arrayContaining([
      'auto_qty',
      'reported_qty',
      'audited_qty',
      'audited_amount',
    ]))
    expect(await columnNames(db, 'penalty_records')).toEqual(expect.arrayContaining([
      'projectId',
      'crewId',
      'supplier_id',
      'contract_id',
      'deduction_method',
      'rectification_note',
      'deleted_at',
    ]))
    for (const [table, column] of [
      ['owner_change_orders', 'project_id'],
      ['monthly_statements', 'project_id'],
      ['monthly_statements', 'contract_id'],
      ['penalty_records', 'projectId'],
    ] as const) {
      const columns = await db.select<{ name: string, notnull: number }>(
        `PRAGMA table_info('${table}')`,
      )
      expect(columns.find(item => item.name === column)?.notnull).toBe(0)
    }

    const penaltyForeignKeys = await db.select<{ table: string, from: string }>(
      `PRAGMA foreign_key_list('penalty_records')`,
    )
    expect(penaltyForeignKeys).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'projects', from: 'projectId' }),
      expect.objectContaining({ table: 'crews', from: 'crewId' }),
      expect.objectContaining({ table: 'suppliers', from: 'supplier_id' }),
      expect.objectContaining({ table: 'contracts', from: 'contract_id' }),
    ]))

    const deductionForeignKeys = await db.select<{ table: string, from: string }>(
      `PRAGMA foreign_key_list('penalty_settlement_deductions')`,
    )
    expect(deductionForeignKeys).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'penalty_records', from: 'penalty_id' }),
      expect.objectContaining({ table: 'expenditure_settlements', from: 'settlement_id' }),
    ]))

    const indexes = await db.select<{ name: string }>(`
      SELECT name FROM sqlite_master
      WHERE type = 'index'
        AND (
          name LIKE 'idx_owner_%'
          OR name LIKE 'idx_project_acceptances_%'
          OR name LIKE 'idx_subcontract_change_%'
          OR name LIKE 'idx_penalty_%'
        )
      ORDER BY name
    `)
    expect(indexes.map(index => index.name)).toEqual(expect.arrayContaining([
      'idx_project_acceptances_project',
      'idx_owner_final_settlements_contract',
      'idx_owner_penalties_project',
      'idx_subcontract_change_contract',
      'idx_penalty_records_project',
      'idx_penalty_deductions_settlement',
    ]))
    expect(await db.select('PRAGMA foreign_key_check')).toEqual([])
    db.close()
  })

  it('从 v23 升级保留 BOQ 与报量事实，且单据类型不复用行操作类型', async () => {
    const db = await createPreF5Db()
    await seedReferences(db)
    await db.execute(`
      INSERT INTO boq_change_orders (
        id, project_id, contract_id, code, name, change_type, status
      )
      VALUES (
        'boq-change-before-f5', 'project-f5', 'contract-owner-f5',
        'BQ-F5', '迁移前调量', 'qty', 'draft'
      )
    `)
    await db.execute(`
      INSERT INTO monthly_statements (
        id, project_id, contract_id, month, status, total_amount
      )
      VALUES (
        'monthly-before-f5', 'project-f5', 'contract-owner-f5',
        '2026-07', 'adjusted', 88
      )
    `)

    const result = await runMigrations(db)
    expect(result.applied).toContain('v24 f5-owner-subcontract-documents')
    expect(await db.select(`
      SELECT id, change_type, document_type
      FROM boq_change_orders
      WHERE id = 'boq-change-before-f5'
    `)).toEqual([{
      id: 'boq-change-before-f5',
      change_type: 'qty',
      document_type: 'change_negotiation',
    }])
    expect(await db.select(`
      SELECT id, status, total_amount, reported_amount, audited_amount
      FROM monthly_statements
      WHERE id = 'monthly-before-f5'
    `)).toEqual([{
      id: 'monthly-before-f5',
      status: 'adjusted',
      total_amount: 88,
      reported_amount: null,
      audited_amount: null,
    }])

    await db.execute(`
      UPDATE boq_change_orders
      SET document_type = 'site_visa'
      WHERE id = 'boq-change-before-f5'
    `)
    expect(await db.select(`
      SELECT change_type, document_type
      FROM boq_change_orders
      WHERE id = 'boq-change-before-f5'
    `)).toEqual([{
      change_type: 'qty',
      document_type: 'site_visa',
    }])
    expect((await runMigrations(db)).applied).toEqual([])
    expect(await db.select('PRAGMA foreign_key_check')).toEqual([])
    db.close()
  })

  it('数据库拒绝无效单据类型、负罚扣金额和重复抵扣关系', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    await seedReferences(db)

    await expect(db.execute(`
      INSERT INTO boq_change_orders (
        id, project_id, contract_id, code, name, change_type, document_type
      )
      VALUES (
        'bad-document-type', 'project-f5', 'contract-owner-f5',
        'BQ-BAD', '错误类型', 'qty', 'qty'
      )
    `)).rejects.toThrow()

    await expect(db.execute(`
      INSERT INTO owner_penalties (
        id, project_id, amount, penalty_date, reason
      )
      VALUES (
        'bad-owner-penalty', 'project-f5', -1, '2026-07-26', '错误金额'
      )
    `)).rejects.toThrow()
    await expect(db.execute(`
      INSERT INTO project_acceptances (id, status)
      VALUES ('bad-acceptance-status', 'unknown')
    `)).rejects.toThrow()

    await db.execute(`
      INSERT INTO expenditure_settlements (
        id, no, name, biz_type, project_id, supplier_id, contract_id,
        total_amount, status
      )
      VALUES (
        'settlement-f5', 'FBJS-F5', 'F5 分包结算', '分包',
        'project-f5', 'supplier-f5', 'contract-sub-f5', 100, 'draft'
      )
    `)
    await db.execute(`
      INSERT INTO penalty_records (
        id, projectId, supplier_id, contract_id, reason, amount, penaltyDate
      )
      VALUES (
        'penalty-f5', 'project-f5', 'supplier-f5', 'contract-sub-f5',
        '质量罚扣', 20, '2026-07-26'
      )
    `)
    await db.execute(`
      INSERT INTO penalty_settlement_deductions (
        id, penalty_id, settlement_id, amount
      )
      VALUES (
        'deduction-f5-a', 'penalty-f5', 'settlement-f5', 20
      )
    `)
    await expect(db.execute(`
      INSERT INTO penalty_settlement_deductions (
        id, penalty_id, settlement_id, amount
      )
      VALUES (
        'deduction-f5-b', 'penalty-f5', 'settlement-f5', 1
      )
    `)).rejects.toThrow()
    db.close()
  })
})
