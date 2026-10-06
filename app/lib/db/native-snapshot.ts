import type { BrowserSqliteDatabase } from './sqljs'
import { isTauri } from '@tauri-apps/api/core'
import { backupNativeDatabase } from './connection'
import { openBrowserSqlite } from './sqljs'

export interface NativeMigrationSnapshot {
  path: string
  bytes: Uint8Array
  sha256: string
  createdAt: string
  schemaVersion: number
}

/** A snapshot is inspected without migrating, seeding or changing the source. */
export async function inspectNativeMigrationSnapshot(
  bytes: Uint8Array,
  open: (bytes: Uint8Array) => Promise<BrowserSqliteDatabase> = openBrowserSqlite,
): Promise<{ sha256: string, schemaVersion: number }> {
  if (bytes.length < 100 || new TextDecoder().decode(bytes.slice(0, 16)) !== 'SQLite format 3\0')
    throw new Error('来源不是完整 SQLite 快照。')
  const db = await open(bytes)
  try {
    db.run('PRAGMA query_only = ON')
    function rows(sql: string) {
      const statement = db.prepare(sql)
      try {
        const result: Record<string, unknown>[] = []
        while (statement.step())
          result.push(statement.getAsObject())
        return result
      }
      finally { statement.free() }
    }
    const integrity = rows('PRAGMA integrity_check')
    if (integrity.length !== 1 || Object.values(integrity[0]!)[0] !== 'ok')
      throw new Error('来源未通过 SQLite 完整性核验。')
    if (rows('PRAGMA foreign_key_check').length)
      throw new Error('来源存在失效外键，不能用于迁入。')
    const schemaVersion = rows('SELECT MAX(version) AS version FROM schema_migrations')[0]?.version
    if (typeof schemaVersion !== 'number' || !Number.isSafeInteger(schemaVersion) || schemaVersion < 1)
      throw new Error('来源缺少有效版本。')
    const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)
    return { schemaVersion, sha256: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('') }
  }
  finally { db.close() }
}

export async function createNativeMigrationSnapshot(): Promise<NativeMigrationSnapshot | null> {
  if (!isTauri())
    throw new Error('请在桌面端导出当前 SQLite 的一致快照。')
  const [{ open }, { join }, { stat, readFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/api/path'),
    import('@tauri-apps/plugin-fs'),
  ])
  const selected = await open({ directory: true, multiple: false, recursive: false, title: '选择迁移快照保存目录' })
  if (typeof selected !== 'string')
    return null
  const createdAt = new Date().toISOString()
  const path = await join(selected, `crm-migration-${createdAt.replace(/[:.]/g, '-')}-${crypto.randomUUID()}.sqlite`)
  await backupNativeDatabase(path)
  const before = await stat(path)
  if (!before.isFile || !Number.isSafeInteger(before.size) || before.size < 100)
    throw new Error(`快照文件不可核验，请保留原数据库和 ${path}。`)
  const bytes = await readFile(path)
  const after = await stat(path)
  if (!after.isFile || bytes.length !== before.size || after.size !== before.size
    || after.mtime?.getTime() !== before.mtime?.getTime()) {
    throw new Error(`快照在读取期间发生变化，请保留原数据库和 ${path}。`)
  }
  const inspected = await inspectNativeMigrationSnapshot(bytes)
  return { path, bytes, createdAt, ...inspected }
}
