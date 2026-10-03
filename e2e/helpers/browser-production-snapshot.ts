import type { Page } from '@playwright/test'
import type { Database } from 'sql.js'
import { Buffer } from 'node:buffer'
import path from 'node:path'
import initSqlJs from 'sql.js'

const DATABASE_NAME = 'crm-new-browser'
const DATABASE_VERSION = 2
const SNAPSHOT_STORE = 'database_snapshots'
const BROWSER_STORES = [SNAPSHOT_STORE, 'database_backups', 'database_settings'] as const
const SQL_JS = initSqlJs({
  locateFile: file => path.resolve('node_modules/sql.js/dist', file),
})

async function openBrowserDatabase(page: Page): Promise<void> {
  await page.evaluate(async ({ databaseName, databaseVersion, stores }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion)
      request.addEventListener('upgradeneeded', () => {
        for (const store of stores) {
          if (!request.result.objectStoreNames.contains(store))
            request.result.createObjectStore(store)
        }
      })
      request.addEventListener('success', () => resolve(request.result), { once: true })
      request.addEventListener('error', () => reject(request.error), { once: true })
    })
    database.close()
  }, {
    databaseName: DATABASE_NAME,
    databaseVersion: DATABASE_VERSION,
    stores: BROWSER_STORES,
  })
}

/** Waits for the application to persist its initialized production SQLite snapshot. */
export async function readProductionSnapshot(page: Page, timeoutMs = 60_000): Promise<number[]> {
  await openBrowserDatabase(page)
  const snapshot = await page.evaluate(async ({ databaseName, databaseVersion, snapshotStore, timeout }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion)
      request.addEventListener('success', () => resolve(request.result), { once: true })
      request.addEventListener('error', () => reject(request.error), { once: true })
    })
    try {
      const deadline = performance.now() + timeout
      while (performance.now() < deadline) {
        const value = await new Promise<ArrayBuffer | Uint8Array | undefined>((resolve, reject) => {
          const transaction = database.transaction(snapshotStore, 'readonly')
          const request = transaction.objectStore(snapshotStore).get('production')
          request.addEventListener('success', () => resolve(request.result), { once: true })
          request.addEventListener('error', () => reject(request.error), { once: true })
        })
        const bytes = value instanceof Uint8Array
          ? value
          : value
            ? new Uint8Array(value)
            : null
        if (bytes?.byteLength) {
          // 数百万个数字的协议序列化会超过字段持久化断言的等待时间。
          // 分块编码完整字节，调用方仍收到同一份 SQLite 快照。
          const chunks: string[] = []
          for (let offset = 0; offset < bytes.length; offset += 0x8000)
            chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)))
          return btoa(chunks.join(''))
        }
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      throw new Error(`production 快照未在 ${timeout}ms 内完成初始化`)
    }
    finally {
      database.close()
    }
  }, {
    databaseName: DATABASE_NAME,
    databaseVersion: DATABASE_VERSION,
    snapshotStore: SNAPSHOT_STORE,
    timeout: timeoutMs,
  })
  return Array.from(Buffer.from(snapshot, 'base64'))
}

/** Replaces only the isolated browser test's production SQLite snapshot. */
export async function writeProductionSnapshot(page: Page, bytes: number[]): Promise<void> {
  await openBrowserDatabase(page)
  await page.evaluate(async ({ databaseName, databaseVersion, snapshotStore, snapshot }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion)
      request.addEventListener('success', () => resolve(request.result), { once: true })
      request.addEventListener('error', () => reject(request.error), { once: true })
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(snapshotStore, 'readwrite')
        transaction.objectStore(snapshotStore).put(
          new Uint8Array(snapshot).buffer,
          'production',
        )
        transaction.addEventListener('complete', () => resolve(), { once: true })
        transaction.addEventListener('abort', () => reject(transaction.error), { once: true })
        transaction.addEventListener('error', () => reject(transaction.error), { once: true })
      })
    }
    finally {
      database.close()
    }
  }, {
    databaseName: DATABASE_NAME,
    databaseVersion: DATABASE_VERSION,
    snapshotStore: SNAPSHOT_STORE,
    snapshot: bytes,
  })
}

/** Opens, mutates and atomically replaces an isolated browser test's production snapshot. */
export async function updateProductionSnapshot(
  page: Page,
  mutate: (database: Database) => void,
): Promise<void> {
  const SQL = await SQL_JS
  const database = new SQL.Database(new Uint8Array(await readProductionSnapshot(page)))
  try {
    mutate(database)
    await writeProductionSnapshot(page, Array.from(database.export()))
  }
  finally {
    database.close()
  }
}
