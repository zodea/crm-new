import { isTauri } from '@tauri-apps/api/core'

import { runMigrations } from './migrations'
import { seedIfEmpty } from './seed'

interface DbDriver {
  execute: (sql: string, params?: unknown[]) => Promise<void>
  select: <T>(sql: string, params?: unknown[]) => Promise<T[]>
  close: () => Promise<void>
}

let db: DbDriver | null = null

async function createTauriDriver(): Promise<DbDriver> {
  const { default: Database } = await import('@tauri-apps/plugin-sql')
  const conn = await Database.load('sqlite:crm.db')
  return {
    async execute(sql, params = []) {
      await conn.execute(sql, params as any[])
    },
    async select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return conn.select(sql, params as any[])
    },
    async close() {
      await conn.close()
    },
  }
}

async function createSqlJsDriver(): Promise<DbDriver> {
  const initSqlJs = (await import('sql.js')).default
  const wasmResp = await fetch('/sql-wasm.wasm')
  const wasmBinary = await wasmResp.arrayBuffer()
  const SQL = await initSqlJs({ wasmBinary })
  const conn = new SQL.Database()
  return {
    async execute(sql, params = []) {
      conn.run(sql, params as any[])
    },
    async select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const stmt = conn.prepare(sql)
      if (params.length)
        stmt.bind(params as any[])

      const rows: T[] = []
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T)
      }
      stmt.free()
      return rows
    },
    async close() {
      conn.close()
    },
  }
}

export async function getDb(): Promise<DbDriver> {
  if (db)
    return db

  // 桌面端必须使用持久化 SQLite；原生驱动失败时显式报错，不能静默退回内存库。
  db = isTauri()
    ? await createTauriDriver()
    : await createSqlJsDriver()

  await runMigrations(db)

  await seedIfEmpty()

  return db
}

export async function execute(sql: string, params?: unknown[]): Promise<void> {
  const conn = await getDb()
  return conn.execute(sql, params)
}

export async function select<T>(sql: string, params?: unknown[]): Promise<T[]> {
  const conn = await getDb()
  return conn.select<T>(sql, params)
}
