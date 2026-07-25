import type { MigrationDb } from '~/lib/db/migrations'
import { describe, expect, it } from 'vitest'
import {
  LATEST_VERSION,
  migrations,
  runMigrations,
} from '~/lib/db/migrations'
import { columnNames, createMemoryDb, listTables } from '../helpers/memory-db'

const F3_MIGRATION_VERSION = 22

async function createPreF3Db() {
  const db = await createMemoryDb()
  await runMigrations(
    db,
    migrations.filter(migration => migration.version < F3_MIGRATION_VERSION),
  )
  return db
}

async function seedReferences(db: MigrationDb) {
  await db.execute(`
    INSERT INTO customers (id, name)
    VALUES ('customer-f3', '资金客户')
  `)
  await db.execute(`
    INSERT INTO projects (id, name, customer_id)
    VALUES ('project-f3', 'F3 项目', 'customer-f3')
  `)
  await db.execute(`
    INSERT INTO suppliers (id, name)
    VALUES ('supplier-f3', '资金分供方')
  `)
}

describe('v22 F3 资金表单与票款分摊迁移', () => {
  it('冷启动建立目标表、约束、真实外键和索引', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)

    expect(LATEST_VERSION).toBe(F3_MIGRATION_VERSION)
    const tables = await listTables(db)
    for (const table of [
      'receipt_registrations',
      'invoice_applications',
      'current_transactions',
      'payment_records',
      'expense_reimbursements',
      'expense_reimbursement_lines',
      'payment_applications',
      'payment_application_settlement_allocations',
      'payment_application_invoice_allocations',
      'payment_record_application_allocations',
    ]) {
      expect(tables).toContain(table)
    }
    expect(tables).not.toContain('current_receipts')
    expect(tables).not.toContain('current_payments')

    expect(await columnNames(db, 'receipt_registrations')).toEqual(expect.arrayContaining([
      'no',
      'contract_id',
      'customer_id',
      'bank_serial_no',
      'deleted_at',
    ]))
    expect(await columnNames(db, 'invoice_applications')).toEqual(expect.arrayContaining([
      'no',
      'contract_id',
      'customer_id',
      'buyer_tax_no_snapshot',
      'application_date',
      'deleted_at',
    ]))
    expect(await columnNames(db, 'payment_records')).toEqual(expect.arrayContaining([
      'payee_name',
      'bank_serial_no',
      'source',
      'recognition_status',
      'field_confidence',
      'confirmation_status',
      'confirmed_at',
    ]))
    expect(await columnNames(db, 'payment_applications')).toEqual(expect.arrayContaining([
      'no',
      'biz_type',
      'apply_amount',
      'invoice_state',
      'prepay_deduct',
    ]))

    const settlementForeignKeys = await db.select<{ table: string, from: string }>(
      `PRAGMA foreign_key_list('payment_application_settlement_allocations')`,
    )
    expect(settlementForeignKeys).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: 'payment_applications',
        from: 'payment_application_id',
      }),
      expect.objectContaining({
        table: 'expenditure_settlements',
        from: 'settlement_id',
      }),
    ]))
    const invoiceForeignKeys = await db.select<{ table: string, from: string }>(
      `PRAGMA foreign_key_list('payment_application_invoice_allocations')`,
    )
    expect(invoiceForeignKeys).toContainEqual(expect.objectContaining({
      table: 'invoices',
      from: 'invoice_id',
    }))
    const paymentForeignKeys = await db.select<{ table: string, from: string }>(
      `PRAGMA foreign_key_list('payment_record_application_allocations')`,
    )
    expect(paymentForeignKeys).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: 'payment_records',
        from: 'payment_record_id',
      }),
      expect.objectContaining({
        table: 'payment_applications',
        from: 'payment_application_id',
      }),
    ]))
    expect(await db.select('PRAGMA foreign_key_check')).toEqual([])
    db.close()
  })

  it('合并拆分往来、迁移旧付款引用与报销头金额，并留下核对证据', async () => {
    const db = await createPreF3Db()
    await seedReferences(db)
    await db.execute(`
      INSERT INTO current_receipts (
        id, project_id, receipt_no, receipt_date, amount, payer
      )
      VALUES (
        'legacy-current-in', 'project-f3', 'WL-SK-001', '2026-07-01', 88, '往来客户'
      )
    `)
    await db.execute(`
      INSERT INTO current_payments (
        id, project_id, payment_no, approval_status, payment_date,
        payee, amount, payment_method
      )
      VALUES (
        'legacy-current-out', 'project-f3', 'WL-FK-001', '已付款',
        '2026-07-02', '公司总部', 66, '银行转账'
      )
    `)
    await db.execute(`
      INSERT INTO payment_applications (
        id, project_id, supplier_id, application_no, name, amount,
        paid_amount, approval_status
      )
      VALUES (
        'legacy-application', 'project-f3', 'supplier-f3', 'FK-001',
        '旧付款申请', 100, 40, '已通过'
      )
    `)
    await db.execute(`
      INSERT INTO payment_records (
        id, project_id, payment_application_id, payment_no, payment_date,
        amount, payment_method, voucher_no
      )
      VALUES (
        'legacy-payment', 'project-f3', 'legacy-application', 'ZF-001',
        '2026-07-03', 40, '银行转账', 'V-001'
      )
    `)
    await db.execute(`
      CREATE TABLE expense_reimbursements (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        no TEXT,
        applicant TEXT,
        amount REAL,
        reimbursement_date TEXT,
        created_at TEXT
      )
    `)
    await db.execute(`
      INSERT INTO expense_reimbursements (
        id, project_id, no, applicant, amount, reimbursement_date, created_at
      )
      VALUES (
        'legacy-reimbursement', NULL, 'BX-001', '李工', 123.45,
        '2026-07-04', '2026-07-04T09:00:00.000Z'
      )
    `)

    const result = await runMigrations(db)
    expect(result.applied).toEqual(['v22 f3-finance-forms-reconciliation'])

    expect(await db.select(`
      SELECT id, direction, project_id, no, counterparty, amount
      FROM current_transactions
      ORDER BY id
    `)).toEqual([
      {
        id: 'legacy-current-in',
        direction: 'receipt',
        project_id: 'project-f3',
        no: 'WL-SK-001',
        counterparty: '往来客户',
        amount: 88,
      },
      {
        id: 'legacy-current-out',
        direction: 'payment',
        project_id: 'project-f3',
        no: 'WL-FK-001',
        counterparty: '公司总部',
        amount: 66,
      },
    ])
    expect(await db.select(`
      SELECT payment_record_id, payment_application_id, allocated_amount
      FROM payment_record_application_allocations
    `)).toEqual([{
      payment_record_id: 'legacy-payment',
      payment_application_id: 'legacy-application',
      allocated_amount: 40,
    }])
    expect(await db.select(`
      SELECT reimbursement_id, expense_item, amount
      FROM expense_reimbursement_lines
    `)).toEqual([{
      reimbursement_id: 'legacy-reimbursement',
      expense_item: '迁移汇总',
      amount: 123.45,
    }])
    expect(await db.select<{ cnt: number }>(`
      SELECT COUNT(*) AS cnt
      FROM reconciliation_issues
      WHERE import_batch_id = 'migration_f3_v22'
        AND entity_id IN ('legacy-application', 'legacy-reimbursement')
    `)).toEqual([{ cnt: 2 }])
    expect(await db.select(`
      SELECT status FROM import_batches WHERE id = 'migration_f3_v22'
    `)).toEqual([{ status: 'completed' }])
    expect(await db.select('PRAGMA foreign_key_check')).toEqual([])

    expect((await runMigrations(db)).applied).toEqual([])
    db.close()
  })

  it('数据库拒绝负分摊、重复银行流水和跨申请超票额', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    await seedReferences(db)
    await db.execute(`
      INSERT INTO payment_applications (
        id, no, name, biz_type, project_id, supplier_id, apply_amount,
        apply_date, applicant, invoice_state, status
      )
      VALUES
        ('application-a', 'FK-A', '申请 A', '项目费用', 'project-f3',
         'supplier-f3', 80, '2026-07-05', '张工', '先票后款', 'draft'),
        ('application-b', 'FK-B', '申请 B', '项目费用', 'project-f3',
         'supplier-f3', 80, '2026-07-05', '张工', '先票后款', 'draft')
    `)
    await db.execute(`
      INSERT INTO invoices (
        id, invoice_number, total_amount, project_id, supplier_id
      )
      VALUES ('invoice-f3', 'INV-F3', 100, 'project-f3', 'supplier-f3')
    `)

    await expect(db.execute(`
      INSERT INTO payment_application_invoice_allocations (
        id, payment_application_id, invoice_id, allocated_amount
      )
      VALUES ('bad-negative', 'application-a', 'invoice-f3', -1)
    `)).rejects.toThrow()
    await db.execute(`
      INSERT INTO payment_application_invoice_allocations (
        id, payment_application_id, invoice_id, allocated_amount
      )
      VALUES ('invoice-allocation-a', 'application-a', 'invoice-f3', 70)
    `)
    await expect(db.execute(`
      INSERT INTO payment_application_invoice_allocations (
        id, payment_application_id, invoice_id, allocated_amount
      )
      VALUES ('invoice-allocation-b', 'application-b', 'invoice-f3', 40)
    `)).rejects.toThrow(/发票可关联额度不足/)

    await db.execute(`
      INSERT INTO payment_records (
        id, no, payment_date, amount, payee_name, voucher_no,
        bank_serial_no, confirmation_status
      )
      VALUES (
        'payment-a', 'ZF-A', '2026-07-06', 10, '收款方', 'V-A',
        'BANK-F3', 'needs_review'
      )
    `)
    await expect(db.execute(`
      INSERT INTO payment_records (
        id, no, payment_date, amount, payee_name, voucher_no,
        bank_serial_no, confirmation_status
      )
      VALUES (
        'payment-b', 'ZF-B', '2026-07-06', 10, '收款方', 'V-B',
        'BANK-F3', 'needs_review'
      )
    `)).rejects.toThrow()
    db.close()
  })
})
