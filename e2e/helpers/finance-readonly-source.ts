import type { Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { migrations, runMigrations } from '../../app/lib/db/migrations'
import { createMemoryDb } from '../../tests/helpers/memory-db'

type SnapshotKey = 'production' | 'demo'
let prepared: Promise<Uint8Array> | null = null

/** Real incremental Native migrations, independent of page initialization and central finance. */
async function prepareNativeBytes(): Promise<Uint8Array> {
  const db = await createMemoryDb()
  try {
    await runMigrations(db, migrations.filter(migration => migration.version <= 55))
    await db.execute(`INSERT INTO current_transactions(id,direction,counterparty,amount,status,created_at,updated_at)
      VALUES(?,? ,?,0,'draft',?,?)`, ['legacy-finance-readonly', 'receipt', '历史姓名原文', '2026-09-10T04:00:00.000Z', '2026-09-10T04:00:00.000Z'])
    await db.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size,mime_type,uploader,uploaded_at) VALUES(?,?,?,?,?,?,?,?)', ['legacy-finance-original', 'current_transaction', 'legacy-finance-readonly', '历史财务原件.bin', 4, 'application/octet-stream', '历史上传人', '2026-09-10T04:00:00.000Z'])
    await db.execute('INSERT INTO file_payloads(file_ref_id,encoding,content) VALUES(?,?,?)', ['legacy-finance-original', 'base64', Buffer.from([0, 10, 128, 255]).toString('base64')])
    await db.execute('INSERT INTO operation_logs(id,table_name,record_id,action,after_data,operator,created_at) VALUES(?,?,?,?,?,?,?)', ['legacy-finance-audit', 'current_transactions', 'legacy-finance-readonly', 'create', '{"counterparty":"历史姓名原文","amount":0,"source":"Native旧来源，尚未迁入中央"}', '历史经办人', '2026-09-10T04:00:00.000Z'])
    await runMigrations(db)
    return new Uint8Array(db.raw.export())
  }
  finally {
    db.close()
  }
}

/** Only immutable bytes are shared; each browser context receives its own independent copy. */
export async function financeReadonlySourceBytes(): Promise<Uint8Array> {
  prepared ??= prepareNativeBytes()
  return new Uint8Array(await prepared)
}

export async function installFinanceReadonlySource(page: Page, key: SnapshotKey, bytes: Uint8Array): Promise<void> {
  await page.evaluate(async ({ key, payloadBase64 }) => {
    const data = Uint8Array.from(atob(payloadBase64), character => character.charCodeAt(0))
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('crm-new-browser', 2)
      request.onupgradeneeded = () => {
        for (const store of ['database_snapshots', 'database_backups', 'database_settings']) {
          if (!request.result.objectStoreNames.contains(store))
            request.result.createObjectStore(store)
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(['database_snapshots', 'database_settings'], 'readwrite')
        transaction.objectStore('database_snapshots').put(data.buffer, key)
        if (key === 'production')
          transaction.objectStore('database_settings').put(true, 'legacy-production-read-only')
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
    }
    finally {
      database.close()
    }
  }, { key, payloadBase64: Buffer.from(bytes).toString('base64') })
}

export async function readFinanceReadonlySource(page: Page, key: SnapshotKey) {
  const payloadBase64 = await page.evaluate(async (key) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('crm-new-browser', 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const stored = await new Promise<ArrayBuffer | Uint8Array>((resolve, reject) => {
        const request = database.transaction('database_snapshots', 'readonly').objectStore('database_snapshots').get(key)
        request.onsuccess = () => request.result ? resolve(request.result) : reject(new Error('专用合成 Native 来源不存在，不能视为空库'))
        request.onerror = () => reject(request.error)
      })
      const bytes = new Uint8Array(stored)
      const chunks: string[] = []
      for (let offset = 0; offset < bytes.length; offset += 0x8000)
        chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)))
      return btoa(chunks.join(''))
    }
    finally {
      database.close()
    }
  }, key)
  const bytes = Buffer.from(payloadBase64, 'base64')
  const db = await createMemoryDb(bytes)
  try {
    const tables = ['current_transactions', 'invoices', 'payment_applications', 'payment_records', 'payment_record_application_allocations', 'payment_application_invoice_allocations', 'payment_application_settlement_allocations', 'expense_reimbursements', 'expense_reimbursement_lines', 'file_refs', 'file_payloads', 'operation_logs']
    const records = Object.fromEntries(await Promise.all(tables.map(async table => [table, await db.select<Record<string, unknown>>(`SELECT * FROM ${table} ORDER BY 1`)])))
    const schema = await db.select('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name')
    const version = await db.select<{ version: number }>('SELECT MAX(version) AS version FROM schema_migrations')
    return { sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length, schemaVersion: version[0]?.version, schema, records }
  }
  finally {
    db.close()
  }
}
