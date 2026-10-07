import type { Database } from 'sql.js'
import type { MigrationDb } from '~/lib/db/migrations'
import initSqlJs from 'sql.js'
import { runMigrations } from '~/lib/db/migrations'

export interface TestDb extends MigrationDb {
  raw: Database
  close: () => void
}

let sqlJsPromise: ReturnType<typeof initSqlJs> | null = null
let migrated: Promise<{ bytes: Uint8Array, foreignKeys: number }> | null = null

/**
 * 已跑完默认全量迁移的内存库：每个 worker 只迁移一次，之后克隆字节。
 * 与 createMemoryDb + runMigrations 等价（含种子与外键开关）；需要空库或旧版本迁移的用例仍用 createMemoryDb。
 */
export async function createMigratedMemoryDb(): Promise<TestDb> {
  migrated ??= (async () => {
    const db = await createMemoryDb()
    try {
      await runMigrations(db)
      // 外键开关是连接状态，export 会重开连接而丢失，须在导出前记录。
      const [{ foreign_keys: foreignKeys }] = await db.select<{ foreign_keys: number }>('PRAGMA foreign_keys') as [{ foreign_keys: number }]
      return { bytes: db.raw.export(), foreignKeys }
    }
    finally { db.close() }
  })()
  const { bytes, foreignKeys } = await migrated
  const db = await createMemoryDb(bytes)
  await db.execute(`PRAGMA foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`)
  return db
}

/** node 环境的 sql.js 内存库，形状与 connection.ts 的 DbDriver 对齐 */
export async function createMemoryDb(bytes?: Uint8Array): Promise<TestDb> {
  sqlJsPromise ??= initSqlJs()
  const SQL = await sqlJsPromise
  const conn = new SQL.Database(bytes)
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
