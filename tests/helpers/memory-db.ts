import type { Database } from 'sql.js'
import type { MigratedMemorySnapshot } from '../global-setup'
import type { MigrationDb } from '~/lib/db/migrations'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import initSqlJs from 'sql.js'
import { runMigrations } from '~/lib/db/migrations'

export interface TestDb extends MigrationDb {
  raw: Database
  close: () => void
}

let sqlJsPromise: ReturnType<typeof initSqlJs> | null = null
let migrated: Promise<{ bytes: Uint8Array, foreignKeys: number }> | null = null

/** 从空库跑默认全量迁移并导出字节；全局准备与无全局快照时的回退共用此流程。 */
export async function migrateMemorySnapshot(): Promise<{ bytes: Uint8Array, foreignKeys: number }> {
  const db = await createMemoryDb()
  try {
    await runMigrations(db)
    // 外键开关是连接状态，export 会重开连接而丢失，须在导出前记录。
    const [{ foreign_keys: foreignKeys }] = await db.select<{ foreign_keys: number }>('PRAGMA foreign_keys') as [{ foreign_keys: number }]
    return { bytes: db.raw.export(), foreignKeys }
  }
  finally { db.close() }
}

async function sharedMigratedSnapshot(): Promise<MigratedMemorySnapshot | undefined> {
  // 只在 Vitest 内动态引入，避免与 Playwright 的 expect 冲突；冷进程会继承 VITEST 环境变量但不在 Vitest 运行时内，inject 失败即回退。
  if (!process.env.VITEST)
    return undefined
  try {
    return (await import('vitest')).inject('migratedMemorySnapshot')
  }
  catch { return undefined }
}

async function loadMigratedSnapshot() {
  // 全局准备（tests/global-setup.ts）已按迁移源码内容键写好快照时，各 worker 只读文件；
  // E2E/vite-node/冷进程与未注册全局准备的配置回退为本进程迁移一次。
  const shared = await sharedMigratedSnapshot()
  if (!shared)
    return migrateMemorySnapshot()
  return { bytes: new Uint8Array(await readFile(shared.path)), foreignKeys: shared.foreignKeys }
}

/**
 * 已跑完默认全量迁移的内存库：整次运行只迁移一次（全局准备按迁移源码哈希缓存快照），之后各用例克隆字节。
 * 与 createMemoryDb + runMigrations 等价（含种子与外键开关）；需要空库或旧版本迁移的用例仍用 createMemoryDb。
 */
export async function createMigratedMemoryDb(): Promise<TestDb> {
  migrated ??= loadMigratedSnapshot()
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
