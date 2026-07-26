import type { DbDriver, TransactionDb } from './coordinator'

import { invoke, isTauri } from '@tauri-apps/api/core'
import { loadBrowserDatabase, saveBrowserDatabase } from './browser-storage'
import { createDbCoordinator } from './coordinator'
import { runMigrations } from './migrations'
import { seedIfEmpty } from './seed'

async function createTauriDriver(): Promise<DbDriver> {
  const { default: Database } = await import('@tauri-apps/plugin-sql')
  const databaseUrl = 'sqlite:crm.db'
  await invoke('prepare_app_database')
  const conn = Database.get(databaseUrl)
  return {
    async execute(sql, params = []) {
      await conn.execute(sql, params as any[])
    },
    async select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return conn.select(sql, params as any[])
    },
    async close() {
      await conn.close(databaseUrl)
    },
  }
}

async function createSqlJsDriver(): Promise<DbDriver> {
  const initSqlJs = (await import('sql.js')).default
  const wasmResp = await fetch('/sql-wasm.wasm')
  const wasmBinary = await wasmResp.arrayBuffer()
  const SQL = await initSqlJs({ wasmBinary })
  const snapshot = await loadBrowserDatabase()
  const conn = snapshot ? new SQL.Database(snapshot) : new SQL.Database()
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
    async persist() {
      await saveBrowserDatabase(conn.export())
    },
    async close() {
      conn.close()
    },
  }
}

async function initializeDb(): Promise<DbDriver> {
  // 桌面端必须使用持久化 SQLite；原生驱动失败时显式报错，不能静默退回内存库。
  const db = isTauri()
    ? await createTauriDriver()
    : await createSqlJsDriver()

  try {
    await runMigrations(db)
    await seedIfEmpty(db)
    await db.persist?.()
    return db
  }
  catch (error) {
    try {
      await db.close()
    }
    catch {
      // 初始化错误才是主因，关闭失败不覆盖它。
    }
    throw error
  }
}

const coordinator = createDbCoordinator(initializeDb)

export async function getDb(): Promise<DbDriver> {
  return coordinator.getDb()
}

export async function execute(sql: string, params?: unknown[]): Promise<void> {
  return coordinator.execute(sql, params)
}

export async function select<T>(sql: string, params?: unknown[]): Promise<T[]> {
  return coordinator.select<T>(sql, params)
}

export async function withTransaction<T>(work: (tx: TransactionDb) => Promise<T>): Promise<T> {
  return coordinator.withTransaction(work)
}
