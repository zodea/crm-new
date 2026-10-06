import type { TransactionDb } from '../db/coordinator'
import { normalizeSqlDefinition } from '../db/schema-evidence'

export const FINANCE_PAYMENT_PARTY_GUARDS = [
  ...(['payment_applications', 'payment_records'] as const).flatMap(table => (['INSERT', 'UPDATE'] as const).map(action => ({
    name: `${table}_exclusive_payee_${action.toLowerCase()}`,
    sql: `CREATE TRIGGER IF NOT EXISTS ${table}_exclusive_payee_${action.toLowerCase()} BEFORE ${action} ON ${table}
      WHEN NEW.worker_id IS NOT NULL AND NEW.supplier_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'付款对象只能选择工人或分供方之一'); END`,
  }))),
  { name: 'payment_application_adopted_payee', sql: `CREATE TRIGGER IF NOT EXISTS payment_application_adopted_payee BEFORE UPDATE OF worker_id,supplier_id,payee_name_snapshot,project_id ON payment_applications
    WHEN (NEW.worker_id IS NOT OLD.worker_id OR NEW.supplier_id IS NOT OLD.supplier_id OR NEW.payee_name_snapshot IS NOT OLD.payee_name_snapshot OR NEW.project_id IS NOT OLD.project_id)
      AND EXISTS(SELECT 1 FROM payment_record_application_allocations WHERE payment_application_id=OLD.id)
    BEGIN SELECT RAISE(ABORT,'已被支付采用的付款对象与归属不可改写'); END` },
] as const
export async function validateFinancePaymentPartyGuards(db: Pick<TransactionDb, 'select'>): Promise<void> {
  for (const guard of FINANCE_PAYMENT_PARTY_GUARDS) {
    const actual = (await db.select<{ type: string, sql: string }>('SELECT type,sql FROM sqlite_master WHERE name=?', [guard.name]))[0]
    if (!actual || actual.type !== 'trigger' || typeof actual.sql !== 'string' || normalizeSqlDefinition(actual.sql) !== normalizeSqlDefinition(guard.sql))
      throw new Error('付款身份与冻结保护结构不完整，请保留原库并核对迁移')
  }
}

/** Version 59: explicit optional identities only. Historical text never guesses a worker. */
export async function migrateFinancePaymentParties(db: TransactionDb): Promise<void> {
  for (const table of ['payment_applications', 'payment_records'] as const) {
    const columns = await db.select<{ name: string }>('SELECT name FROM pragma_table_info(?)', [table])
    if (!columns.some(row => row.name === 'worker_id'))
      await db.execute(`ALTER TABLE ${table} ADD COLUMN worker_id TEXT REFERENCES workers(id)`)
    if (!columns.some(row => row.name === 'payee_name_snapshot'))
      await db.execute(`ALTER TABLE ${table} ADD COLUMN payee_name_snapshot TEXT`)
    const actual = await db.select<{ name: string, type: string, notnull: number, dflt_value: string | null }>('SELECT * FROM pragma_table_info(?)', [table])
    for (const field of ['worker_id', 'payee_name_snapshot']) {
      const column = actual.find(row => row.name === field)
      if (!column || column.type.toUpperCase() !== 'TEXT' || column.notnull !== 0 || column.dflt_value !== null)
        throw new Error('付款身份字段已有不兼容结构，请保留原库并核对迁移')
    }
    const foreign = await db.select<{ table: string, from: string, to: string }>('SELECT * FROM pragma_foreign_key_list(?)', [table])
    if (!foreign.some(row => row.from === 'worker_id' && row.table === 'workers' && row.to === 'id'))
      throw new Error('付款工人身份外键不完整，请保留原库并核对迁移')
  }
  for (const guard of FINANCE_PAYMENT_PARTY_GUARDS)
    await db.execute(guard.sql)
  await validateFinancePaymentPartyGuards(db)
}
