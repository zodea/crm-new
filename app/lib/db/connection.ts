import type { DbDriver, TransactionDb } from './coordinator'

import { invoke, isTauri } from '@tauri-apps/api/core'
import { useDataVisibilityStore } from '~/stores/data-visibility'
import {
  loadBrowserDatabase,
  loadLegacyProductionReadOnly,
  saveBrowserDatabase,
} from './browser-storage'
import { createDbCoordinator } from './coordinator'
import {
  demoReadOnlyDriver,
  legacyProductionReadOnlyDriver,
  localDataWorkspace,
} from './data-workspace'
import { runMigrations } from './migrations'
import { seedIfEmpty } from './seed'
import { openBrowserSqlite } from './sqljs'

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

async function createSqlJsDriver(snapshotKey: 'production' | 'demo'): Promise<DbDriver> {
  const snapshot = await loadBrowserDatabase(snapshotKey)
  const conn = await openBrowserSqlite(snapshot)
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
      await saveBrowserDatabase(snapshotKey, conn.export())
    },
    async close() {
      conn.close()
    },
  }
}

async function initializeDb(): Promise<DbDriver> {
  const native = isTauri()
  // 启动插件已完成唯一一次服务端授权；DB 只消费 Pinia 的已决策结果。
  const includeDemo = !native && useDataVisibilityStore().includeDemo
  const legacyProductionReadOnly = !native && !includeDemo
    ? await loadLegacyProductionReadOnly()
    : false
  const workspace = localDataWorkspace(includeDemo, legacyProductionReadOnly)
  // 桌面端必须使用持久化 SQLite；原生驱动失败时显式报错，不能静默退回内存库。
  const db = native
    ? await createTauriDriver()
    : await createSqlJsDriver(workspace.snapshotKey)

  try {
    await runMigrations(db)
    if (workspace.seedDemo)
      await seedIfEmpty(db)
    await db.persist?.()
    if (workspace.readOnly)
      await db.execute('PRAGMA query_only = ON')
    if (!workspace.readOnly)
      return db
    return workspace.snapshotKey === 'demo'
      ? demoReadOnlyDriver(db)
      : legacyProductionReadOnlyDriver(db)
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

/**
 * 迁移备份/切换前先关闭唯一活动连接，让 sql.js 把 production 快照完整落到 IndexedDB。
 * 下一次 getDb/select/execute 会按最新只读切换状态重新初始化。
 */
export async function closeDb(): Promise<void> {
  return coordinator.close()
}
