import type { TransactionDb } from '../db/coordinator'
import { normalizeSqlDefinition } from '../db/schema-evidence'
import { OTHER_SETTLEMENT_RELATED_SCHEMA } from './schema'
import { validateOtherSettlementJournal } from './storage'

const additions = { payee_supplier_id: 'TEXT', payee_worker_id: 'TEXT', payee_name_snapshot: 'TEXT', version: 'INTEGER NOT NULL DEFAULT 0 CHECK(version>=0)', record_json: 'TEXT' } as const
const statements = () => OTHER_SETTLEMENT_RELATED_SCHEMA.trim().split(/;\r?\n/).map(sql => sql.replace(/;$/, '').trim()).filter(Boolean)
const normalized = normalizeSqlDefinition
export async function validateExpenditureSettlementSchema(tx: Pick<TransactionDb, 'select'>) {
  const cols = await tx.select<{
    name: string
    type: string
    notnull: number
    dflt_value: string | null
    pk: number
  }>('PRAGMA table_info(expenditure_settlements)')
  const definition = (await tx.select<{ sql: string }>('SELECT sql FROM sqlite_schema WHERE type=\'table\' AND name=\'expenditure_settlements\''))[0]?.sql
  const headSql = definition ? normalized(definition) : ''
  if (Object.keys(additions).some(name => !cols.some(column => column.name === name && column.type.toUpperCase() === (name === 'version' ? 'INTEGER' : 'TEXT'))) || cols.find(column => column.name === 'total_amount')?.notnull !== 0
    || cols.find(column => column.name === 'version')?.notnull !== 1 || cols.find(column => column.name === 'version')?.dflt_value !== '0' || cols.find(column => column.name === 'id')?.pk !== 1
    || !/check\s*\(\s*version\s*>=\s*0\s*\)/.test(headSql) || !/check\s*\(\s*payee_supplier_id\s+is\s+null\s+or\s+payee_worker_id\s+is\s+null\s*\)/.test(headSql)) {
    throw new Error('支出结算身份、版本或未知金额结构缺失；保留原库')
  }
  for (const sql of statements().filter(sql => sql.startsWith('CREATE'))) {
    const match = /^CREATE (TABLE|(?:UNIQUE )?INDEX|TRIGGER) (\w+)/.exec(sql)!
    const row = (await tx.select<{
      type: string
      sql: string
    }>('SELECT type,sql FROM sqlite_schema WHERE name=?', [match[2]]))[0]
    if (!row || row.type !== match[1]!.replace('UNIQUE ', '').toLowerCase() || normalized(row.sql) !== normalized(sql))
      throw new Error(`支出结算结构或历史保护不完整（${match[2]}）；保留原库`)
  }
  const revision = await tx.select<{
    revision: number
  }>('SELECT revision FROM other_settlement_revision WHERE singleton=1')
  if (revision.length !== 1 || !Number.isSafeInteger(revision[0]!.revision) || revision[0]!.revision < 0)
    throw new Error('支出结算读取版本损坏，不能重新初始化为空')
}
/**
 * Owns the migration transaction because SQLite foreign-key mode can only change outside it.
 * Copies every old column and recreates its actual indexes/triggers; old zero/audit/IDs are never inferred.
 */
export async function migrateExpenditureSettlementOwner(db: TransactionDb) {
  const cols = await db.select<{
    name: string
    notnull: number
  }>('PRAGMA table_info(expenditure_settlements)')
  if (!cols.length)
    throw new Error('既有支出结算源表缺失，不能创建空主表替代历史')
  const added = Object.keys(additions).filter(name => cols.some(column => column.name === name))
  const related = await db.select<{
    name: string
  }>('SELECT name FROM sqlite_schema WHERE name=\'other_settlement_revision\'')
  if (added.length || related.length) {
    if (added.length !== Object.keys(additions).length || !related.length)
      throw new Error('支出结算迁移图部分缺失，不能覆盖或补空')
    await validateExpenditureSettlementSchema(db)
    await validateOtherSettlementJournal(db)
    if ((await db.select('PRAGMA foreign_key_check')).length)
      throw new Error('结算迁移现有原关系核验失败；保留原图，不能补空')
    return
  }
  const original = (await db.select<{
    sql: string
  }>('SELECT sql FROM sqlite_schema WHERE type=\'table\' AND name=\'expenditure_settlements\''))[0]?.sql
  if (!original || !/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`[]?expenditure_settlements["`\]]?\s*\(/i.test(original))
    throw new Error('支出结算旧结构无法核验，保留原库')
  const retained = await db.select<{
    sql: string
  }>('SELECT sql FROM sqlite_schema WHERE tbl_name=\'expenditure_settlements\' AND type IN (\'index\',\'trigger\') AND sql IS NOT NULL')
  const newDDL = original.replace(/^(CREATE TABLE\s+(?:IF NOT EXISTS\s+)?)["`[]?expenditure_settlements["`\]]?/i, '$1expenditure_settlements_owner_new')
    .replace(/\btotal_amount(\s+REAL)\s+NOT\s+NULL(?:\s+DEFAULT\s+0)?/i, 'total_amount$1')
    .replace(/\)\s*$/, `,${Object.entries(additions).map(([name, type]) => `${name} ${type}`).join(',')},CHECK(payee_supplier_id IS NULL OR payee_worker_id IS NULL))`)
  await db.execute('PRAGMA foreign_keys=OFF')
  try {
    await db.execute('BEGIN IMMEDIATE')
    try {
      if ((await db.select('SELECT name FROM sqlite_schema WHERE name=\'expenditure_settlements_owner_new\'')).length)
        throw new Error('结算迁移临时图已存在；停止以保护未核实内容')
      await db.execute(newDDL)
      const names = cols.map(column => `"${column.name.replaceAll('"', '""')}"`).join(',')
      await db.execute(`INSERT INTO expenditure_settlements_owner_new(${names}) SELECT ${names} FROM expenditure_settlements`)
      const before = (await db.select<{
        n: number
      }>('SELECT COUNT(*) AS n FROM expenditure_settlements'))[0]!.n
      if ((await db.select<{
        n: number
      }>('SELECT COUNT(*) AS n FROM expenditure_settlements_owner_new'))[0]?.n !== before) {
        throw new Error('结算旧图逐行迁移数量不符')
      }
      await db.execute('DROP TABLE expenditure_settlements')
      await db.execute('ALTER TABLE expenditure_settlements_owner_new RENAME TO expenditure_settlements')
      for (const row of retained)
        await db.execute(row.sql)
      for (const sql of statements())
        await db.execute(sql)
      await validateExpenditureSettlementSchema(db)
      await validateOtherSettlementJournal(db)
      if ((await db.select('PRAGMA foreign_key_check')).length)
        throw new Error('结算迁移后原关系核验失败，已撤回')
      await db.execute('COMMIT')
    }
    catch (cause) {
      await db.execute('ROLLBACK')
      throw cause
    }
  }
  finally {
    await db.execute('PRAGMA foreign_keys=ON')
  }
}
