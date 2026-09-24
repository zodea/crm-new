import type { SQLOutputValue } from 'node:sqlite'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { ProductionStorageProblem } from './production-storage'
import { productionStorageManifest } from './production-storage-schema'

export interface ProductionBackupInventory {
  schemaVersion: number
  workspaceId: string
  ownerId: string
  purpose: 'verification' | 'production'
  participants: Record<string, { schemaVersion: number, tables: readonly string[] }>
  tables: Record<string, { rows: number, sha256: string }>
  originals: { files: number, bytes: number }
  databaseSha256: string
  databaseBytes: number
}
export function backupInvalid(message: string): never {
  throw new ProductionStorageProblem(message)
}
export const backupDigest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`

export async function backupFileDigest(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function canonicalRow(row: Record<string, SQLOutputValue>): string {
  return JSON.stringify(Object.keys(row).sort().map((key) => {
    const value = row[key]
    if (typeof value === 'bigint')
      return [key, 'integer', value.toString()]
    if (value instanceof Uint8Array)
      return [key, 'blob', value.length, backupDigest(value)]
    if (typeof value === 'number' && !Number.isFinite(value))
      backupInvalid('备份含不可表示的数字，无法核对清单。')
    return [key, value]
  }))
}

function verifyOriginalOwner(db: DatabaseSync, row: Record<string, SQLOutputValue>) {
  if (row.owner_type === 'customer') {
    if (!db.prepare('SELECT id FROM customers WHERE id=?').get(row.owner_id!))
      backupInvalid('客户原件归属不完整。')
    return
  }
  if (row.owner_type === 'project') {
    if (!db.prepare('SELECT id FROM projects WHERE id=?').get(row.owner_id!))
      backupInvalid('项目原件归属不完整。')
    return
  }
  if (row.owner_type === 'supplier_credential') {
    const owner = db.prepare(`SELECT c.id FROM supplier_credentials c
      JOIN suppliers s ON s.id=c.supplier_id
      JOIN supplier_credential_files f ON f.file_ref_id=c.file_ref_id AND f.credential_id=c.id AND f.supplier_id=s.id
      WHERE c.id=? AND c.file_ref_id=?`).get(row.owner_id!, row.id!)
    if (!owner)
      backupInvalid('证照原件与分供方双层归属不完整。')
    return
  }
  backupInvalid('备份出现未登记的原件归属；不能忽略该领域。')
}

/** Read a completed isolated snapshot, never an activity-time mixture from the live connection. */
export async function inspectProductionBackup(path: string): Promise<ProductionBackupInventory> {
  const before = await lstat(path)
  if (!before.isFile() || before.isSymbolicLink())
    backupInvalid('备份必须为普通文件。')
  const db = new DatabaseSync(path, { readOnly: true, enableForeignKeyConstraints: true, defensive: true, readBigInts: true })
  let inventory: Omit<ProductionBackupInventory, 'databaseSha256' | 'databaseBytes'>
  try {
    if (db.prepare('PRAGMA integrity_check').all().some(row => row.integrity_check !== 'ok') || db.prepare('PRAGMA foreign_key_check').all().length)
      backupInvalid('备份数据库完整性或关系校验失败。')
    const meta = db.prepare('SELECT * FROM production_metadata WHERE singleton=1').get()
    const schemaVersion = Number(meta?.schema_version)
    const manifest = productionStorageManifest(schemaVersion)
    if (!meta || typeof meta.workspace_id !== 'string' || typeof meta.owner_id !== 'string' || !['verification', 'production'].includes(String(meta.purpose)))
      backupInvalid('备份身份与用途元数据无效。')
    const participants = db.prepare('SELECT domain,schema_version FROM production_participants ORDER BY domain').all()
    if (participants.length !== Object.keys(manifest.participants).length || participants.some(row => typeof row.domain !== 'string' || Number(row.schema_version) !== manifest.participants[row.domain]?.schemaVersion))
      backupInvalid('备份参与者清单不完整或包含未知领域。')
    const expected = new Set([...manifest.coreTables, ...Object.values(manifest.participants).flatMap(item => item.tables)])
    const actual = db.prepare('SELECT name FROM sqlite_schema WHERE type=\'table\' AND name NOT LIKE \'sqlite_%\'').all().map(row => String(row.name))
    if (actual.length !== expected.size || actual.some(table => !expected.has(table)))
      backupInvalid('备份实表与完整清单不一致。')
    const tables: ProductionBackupInventory['tables'] = {}
    for (const table of [...expected].sort()) {
      const keys = db.prepare(`PRAGMA table_info(${identifier(table)})`).all().filter(row => Number(row.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).map(row => identifier(String(row.name)))
      if (!keys.length)
        backupInvalid('备份表缺少稳定主键，无法核对清单。')
      const hash = createHash('sha256')
      let rows = 0
      for (const row of db.prepare(`SELECT * FROM ${identifier(table)} ORDER BY ${keys.join(',')}`).iterate()) {
        hash.update(`${canonicalRow(row)}\n`)
        rows++
      }
      tables[table] = { rows, sha256: hash.digest('hex') }
    }
    let files = 0
    let bytes = 0
    for (const row of db.prepare('SELECT f.*,p.content,p.sha256 FROM file_refs f LEFT JOIN file_payloads p ON p.file_ref_id=f.id ORDER BY f.id').iterate()) {
      verifyOriginalOwner(db, row)
      // Legacy identity alone cannot prove that bytes were already missing at migration time.
      if (row.content === null && row.sha256 === null)
        backupInvalid('备份原件缺少正文；不能把丢失的文件当成历史缺口或空原件。')
      if (!(row.content instanceof Uint8Array) || BigInt(row.content.length) !== row.file_size || backupDigest(Buffer.from(row.content)) !== row.sha256)
        backupInvalid('备份原件字节、大小或摘要不一致。')
      files++
      bytes += row.content.length
      if (!Number.isSafeInteger(bytes))
        backupInvalid('备份原件总量超出可校验范围。')
    }
    inventory = { schemaVersion, workspaceId: meta.workspace_id, ownerId: meta.owner_id, purpose: meta.purpose as ProductionBackupInventory['purpose'], participants: manifest.participants, tables, originals: { files, bytes } }
  }
  finally { db.close() }
  const databaseSha256 = await backupFileDigest(path)
  const after = await lstat(path)
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
    backupInvalid('备份文件在校验期间发生变化，不能发布。')
  return { ...inventory, databaseSha256, databaseBytes: after.size }
}
