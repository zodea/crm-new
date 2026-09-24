import { describe, expect, it } from 'vitest'
import { migrations, runMigrations } from '~/lib/db/migrations'
import { migratePaymentApprovalAmounts } from '~/lib/db/payment-approval-migration'
import { createMemoryDb } from '../helpers/memory-db'

describe('付款批复金额来源迁移', () => {
  it('重建中断可回滚原表与来源，重试后不改金额、关系和自定义索引', async () => {
    const db = await createMemoryDb()
    try {
      await runMigrations(db, migrations.filter(item => item.version <= 48))
      await db.execute('INSERT INTO payment_applications (id, apply_amount, approved_amount) VALUES (\'old\', 100, 0)')
      await db.execute('CREATE INDEX payment_approval_test_index ON payment_applications(approved_amount)')
      await db.execute('PRAGMA foreign_keys = ON')
      await expect(migratePaymentApprovalAmounts({
        select: (sql, params) => db.select(sql, params),
        execute: async (sql, params) => {
          if (sql.startsWith('ALTER TABLE'))
            throw new Error('模拟重建中断')
          await db.execute(sql, params)
        },
      })).rejects.toThrow('模拟重建中断')
      expect(await db.select('SELECT approved_amount FROM payment_applications')).toEqual([{ approved_amount: 0 }])
      expect(await db.select('PRAGMA foreign_keys')).toEqual([{ foreign_keys: 1 }])
      expect(await db.select('SELECT name FROM sqlite_master WHERE name = \'payment_applications_approval_new\'')).toEqual([])
      await runMigrations(db)
      await migratePaymentApprovalAmounts(db)
      expect(await db.select('SELECT approved_amount, approved_amount_origin FROM payment_applications')).toEqual([{ approved_amount: 0, approved_amount_origin: 'legacy' }])
      expect(await db.select('SELECT name FROM sqlite_master WHERE name = \'payment_approval_test_index\'')).toHaveLength(1)
      expect(await db.select('PRAGMA foreign_key_check')).toEqual([])
      await expect(db.execute('UPDATE payment_applications SET approved_amount = -1 WHERE id = \'old\'')).rejects.toThrow()
      await expect(db.execute('UPDATE payment_applications SET approved_amount_origin = \'guessed\' WHERE id = \'old\'')).rejects.toThrow()
    }
    finally {
      db.close()
    }
  })
  it('保留存量零值并允许新批复为空，不猜历史零的含义', async () => {
    const db = await createMemoryDb()
    try {
      await runMigrations(db, migrations.filter(item => item.version <= 48))
      await db.execute(`INSERT INTO payment_applications (id, name, apply_amount, approved_amount, note)
        VALUES ('legacy-zero', '旧批复含义不明', 100, 0, '保留原备注')`)
      await runMigrations(db)
      await db.execute(`INSERT INTO payment_applications (id, name, apply_amount, approved_amount)
        VALUES ('new-empty', '新空值', 100, NULL)`)
      expect(await db.select('SELECT id, approved_amount, approved_amount_origin FROM payment_applications ORDER BY id')).toEqual([
        { id: 'legacy-zero', approved_amount: 0, approved_amount_origin: 'legacy' },
        { id: 'new-empty', approved_amount: null, approved_amount_origin: 'legacy' },
      ])
      expect(await db.select('SELECT note FROM payment_applications WHERE id = ?', ['legacy-zero'])).toEqual([{ note: '保留原备注' }])
    }
    finally {
      db.close()
    }
  })

  it('保留三类分摊、真实支付金额及公司合同防混链约束', async () => {
    const db = await createMemoryDb()
    try {
      await runMigrations(db, migrations.filter(item => item.version <= 48))
      await db.execute('INSERT INTO payment_applications (id, apply_amount, approved_amount) VALUES (\'linked\', 100, 0)')
      await db.execute('INSERT INTO expenditure_settlements (id) VALUES (\'settlement\')')
      await db.execute('INSERT INTO invoices (id, total_amount) VALUES (\'invoice\', 100)')
      await db.execute('INSERT INTO payment_records (id, amount) VALUES (\'payment\', 30)')
      await db.execute('INSERT INTO payment_application_settlement_allocations (id, payment_application_id, settlement_id, allocated_amount) VALUES (\'settlement-link\', \'linked\', \'settlement\', 100)')
      await db.execute('INSERT INTO payment_application_invoice_allocations (id, payment_application_id, invoice_id, allocated_amount) VALUES (\'invoice-link\', \'linked\', \'invoice\', 100)')
      await db.execute('INSERT INTO payment_record_application_allocations (id, payment_application_id, payment_record_id, allocated_amount) VALUES (\'payment-link\', \'linked\', \'payment\', 30)')
      const relations = ['payment_application_settlement_allocations', 'payment_application_invoice_allocations', 'payment_record_application_allocations', 'payment_records']
      const before = await Promise.all(relations.map(table => db.select(`SELECT * FROM ${table}`)))
      await runMigrations(db)
      expect(await Promise.all(relations.map(table => db.select(`SELECT * FROM ${table}`)))).toEqual(before)
      expect(await db.select('PRAGMA foreign_key_check')).toEqual([])
      expect(await db.select('SELECT name FROM sqlite_master WHERE type = \'trigger\' AND name LIKE \'payment_applications_company_contract_%\'')).toHaveLength(2)
      await expect(db.execute('UPDATE payment_applications SET project_id = \'project\', company_expense_contract_id = \'company\' WHERE id = \'linked\'')).rejects.toThrow('company contract must not reference a project contract or project')
    }
    finally {
      db.close()
    }
  })
})
