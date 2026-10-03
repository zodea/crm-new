import type { Database } from 'sql.js'
import type { MigrationDb } from '~/lib/db/migrations'
import initSqlJs from 'sql.js'

export interface TestDb extends MigrationDb {
  raw: Database
  close: () => void
}

let sqlJsPromise: ReturnType<typeof initSqlJs> | null = null

/** node 环境的 sql.js 内存库，形状与 connection.ts 的 DbDriver 对齐 */
export async function createMemoryDb(): Promise<TestDb> {
  sqlJsPromise ??= initSqlJs()
  const SQL = await sqlJsPromise
  const conn = new SQL.Database()
  return {
    async execute(sql, params = []) {
      conn.run(sql, params as never[])
    },
    async select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const stmt = conn.prepare(sql)
      if (params.length)
        stmt.bind(params as never[])
      const rows: T[] = []
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T)
      }
      stmt.free()
      return rows
    },
    raw: conn,
    close() {
      conn.close()
    },
  }
}

/** 列出库内全部业务表名（排除 sqlite 内部表） */
export async function listTables(db: MigrationDb): Promise<string[]> {
  const rows = await db.select<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  )
  return rows.map(r => r.name)
}

/** 某表的全部列名（pragma_table_info） */
export async function columnNames(db: MigrationDb, table: string): Promise<string[]> {
  const cols = await db.select<{ name: string }>('SELECT name FROM pragma_table_info(?)', [table])
  return cols.map(c => c.name)
}
