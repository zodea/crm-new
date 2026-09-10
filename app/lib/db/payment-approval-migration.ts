import type { MigrationDb } from './migrations'

const PAYMENT_APPLICATIONS_TABLE = `CREATE TABLE payment_applications_approval_new (
  id TEXT PRIMARY KEY,
  no TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  biz_type TEXT NOT NULL DEFAULT '',
  project_id TEXT REFERENCES projects(id),
  supplier_id TEXT REFERENCES suppliers(id),
  contract_id TEXT REFERENCES contracts(id),
  cost_name TEXT NOT NULL DEFAULT '',
  apply_amount REAL NOT NULL DEFAULT 0 CHECK (apply_amount >= 0),
  apply_date TEXT NOT NULL DEFAULT '',
  applicant TEXT NOT NULL DEFAULT '',
  invoice_state TEXT NOT NULL DEFAULT '先款后票' CHECK (invoice_state IN ('先票后款', '先款后票', '无需发票')),
  pay_content TEXT NOT NULL DEFAULT '',
  prepay_deduct REAL NOT NULL DEFAULT 0 CHECK (prepay_deduct >= 0),
  prepay_note TEXT NOT NULL DEFAULT '',
  approved_amount REAL DEFAULT NULL CHECK (approved_amount IS NULL OR approved_amount >= 0),
  approved_amount_origin TEXT NOT NULL DEFAULT 'legacy' CHECK (approved_amount_origin IN ('legacy', 'user-entry')),
  approval_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  note TEXT NOT NULL DEFAULT '',
  external_ref TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT DEFAULT NULL,
  company_expense_contract_id TEXT DEFAULT NULL REFERENCES company_expense_contracts(id)
)`

/** v49：只保留旧值并标记来源，不还原 v21/v22 已丢失的批复含义。 */
export async function migratePaymentApprovalAmounts(db: MigrationDb): Promise<void> {
  const columns = await db.select<{ name: string }>('PRAGMA table_info(payment_applications)')
  if (!columns.length || columns.some(column => column.name === 'approved_amount_origin'))
    return
  const [foreignKeys] = await db.select<{ foreign_keys: number }>('PRAGMA foreign_keys')
  await db.execute('PRAGMA foreign_keys = OFF')
  let started = false
  try {
    await db.execute('BEGIN IMMEDIATE')
    started = true
    const schema = await db.select<{ sql: string }>(`SELECT sql FROM sqlite_master
      WHERE tbl_name = 'payment_applications' AND type IN ('index', 'trigger') AND sql IS NOT NULL
      ORDER BY type, name`)
    await db.execute(PAYMENT_APPLICATIONS_TABLE)
    const names = columns.map(column => `"${column.name.replaceAll('"', '""')}"`).join(', ')
    await db.execute(`INSERT INTO payment_applications_approval_new (${names}) SELECT ${names} FROM payment_applications`)
    await db.execute('DROP TABLE payment_applications')
    await db.execute('ALTER TABLE payment_applications_approval_new RENAME TO payment_applications')
    for (const item of schema)
      await db.execute(item.sql)
    const issues = await db.select('PRAGMA foreign_key_check')
    if (issues.length)
      throw new Error('[db] 批复金额来源迁移后存在无效外键')
    await db.execute('COMMIT')
    started = false
  }
  catch (cause) {
    if (started)
      await db.execute('ROLLBACK')
    throw cause
  }
  finally {
    await db.execute(`PRAGMA foreign_keys = ${foreignKeys?.foreign_keys ? 'ON' : 'OFF'}`)
  }
}
