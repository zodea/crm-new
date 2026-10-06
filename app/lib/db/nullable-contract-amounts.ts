import type { MigrationDb } from './migrations'

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`
/** Rebuild the actual schema verbatim except the amount's nullability/default. */
export async function migrateNullableContractAmounts(db: MigrationDb, append: () => Promise<void>): Promise<void> {
  await db.execute('PRAGMA foreign_keys = OFF')
  let started = false
  try {
    await db.execute('BEGIN IMMEDIATE')
    started = true
    for (const table of ['contracts', 'contract_supplements', 'company_expense_contracts']) {
      const definitions = await db.select<{ sql: string }>('SELECT sql FROM sqlite_master WHERE type=? AND name=?', ['table', table])
      if (definitions.length !== 1 || typeof definitions[0]!.sql !== 'string')
        throw new Error(`[db] v53 缺少真实合同表 ${table}`)
      const columns = await db.select<{ name: string, notnull: number }>(`PRAGMA table_info(${quote(table)})`)
      const amount = columns.find(column => column.name === 'amount')
      if (!amount)
        throw new Error(`[db] v53 合同表 ${table} 缺少金额原列`)
      if (!amount.notnull)
        continue
      const before = await db.select(`SELECT * FROM ${quote(table)} ORDER BY id`)
      const foreignKeys = await db.select(`PRAGMA foreign_key_list(${quote(table)})`)
      const structures = await db.select<{ type: string, name: string, sql: string | null }>('SELECT type,name,sql FROM sqlite_master WHERE tbl_name=? AND type IN (?,?) ORDER BY type,name', [table, 'index', 'trigger'])
      const temporary = `${table}_v53_amount_nullable`
      let changed = false
      const create = definitions[0]!.sql
        .replace(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"[^"]+"|\[[^\]]+\]|\w+)/i, `CREATE TABLE ${quote(temporary)}`)
        .replace(/([,(]\s*"?amount"?\s+(?:REAL|NUMERIC|INTEGER|FLOAT|DOUBLE)\b)([^,]*)/i, (_match, field: string, constraints: string) => {
          if (!/\bNOT\s+NULL\b/i.test(constraints))
            return `${field}${constraints}`
          changed = true
          return `${field}${constraints.replace(/\bNOT\s+NULL\b/i, '').replace(/\bDEFAULT\s+0\b/i, 'DEFAULT NULL')}`
        })
      if (!changed || create === definitions[0]!.sql)
        throw new Error(`[db] v53 无法精确识别 ${table} 金额约束，停止迁移`)
      await db.execute(create)
      const names = columns.map(column => quote(column.name)).join(',')
      await db.execute(`INSERT INTO ${quote(temporary)}(${names}) SELECT ${names} FROM ${quote(table)}`)
      await db.execute(`DROP TABLE ${quote(table)}`)
      await db.execute(`ALTER TABLE ${quote(temporary)} RENAME TO ${quote(table)}`)
      for (const structure of structures) {
        if (structure.sql !== null)
          await db.execute(structure.sql)
      }
      if (JSON.stringify(await db.select(`SELECT * FROM ${quote(table)} ORDER BY id`)) !== JSON.stringify(before)
        || JSON.stringify(await db.select(`PRAGMA foreign_key_list(${quote(table)})`)) !== JSON.stringify(foreignKeys)
        || JSON.stringify(await db.select('SELECT type,name,sql FROM sqlite_master WHERE tbl_name=? AND type IN (?,?) ORDER BY type,name', [table, 'index', 'trigger'])) !== JSON.stringify(structures)) {
        throw new Error(`[db] v53 ${table} 原数据、外键、索引或触发器核验失败`)
      }
    }
    await append()
    const violations = await db.select('PRAGMA foreign_key_check')
    if (violations.length)
      throw new Error(`[db] v53 迁移后存在 ${violations.length} 条外键异常`)
    await db.execute('COMMIT')
    started = false
  }
  catch (cause) {
    if (started)
      await db.execute('ROLLBACK')
    throw cause
  }
  finally { await db.execute('PRAGMA foreign_keys = ON') }
}
