import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { inspectNativeMigrationSnapshot } from '~/lib/db/native-snapshot'
import { createMemoryDb } from '../helpers/memory-db'

vi.mock('~/lib/db/connection', () => ({ backupNativeDatabase: vi.fn() }))

async function open(bytes: Uint8Array) {
  return (await createMemoryDb(bytes)).raw
}

describe('桌面完整 SQLite 迁移快照', () => {
  it('只读核验实际字节与版本，不补 schema、不改历史或原件', async () => {
    const db = await createMemoryDb()
    db.raw.exec('CREATE TABLE schema_migrations(version INTEGER); INSERT INTO schema_migrations VALUES(58); CREATE TABLE frozen(id TEXT PRIMARY KEY, body TEXT NOT NULL, original BLOB NOT NULL); INSERT INTO frozen VALUES(\'old-stable-id\', \'{"amount":0,"unknown":null}\', X\'000A80FF\');')
    const bytes = db.raw.export()
    db.close()
    const before = Uint8Array.from(bytes)
    expect(await inspectNativeMigrationSnapshot(bytes, open)).toEqual({ schemaVersion: 58, sha256: createHash('sha256').update(bytes).digest('hex') })
    expect(bytes).toEqual(before)
    const reopened = await createMemoryDb(bytes)
    try {
      expect(await reopened.select('SELECT id,body,hex(original) AS original FROM frozen')).toEqual([{ id: 'old-stable-id', body: '{"amount":0,"unknown":null}', original: '000A80FF' }])
    }
    finally { reopened.close() }
  })

  it('损坏正文、未知版本或失效外键均拒绝，浏览器不能冒用桌面来源', async () => {
    await expect(inspectNativeMigrationSnapshot(new Uint8Array([0, 1, 2]), open)).rejects.toThrow('完整 SQLite')
    const noVersion = await createMemoryDb()
    await noVersion.execute('CREATE TABLE schema_migrations(version INTEGER)')
    const emptyVersion = noVersion.raw.export()
    noVersion.close()
    await expect(inspectNativeMigrationSnapshot(emptyVersion, open)).rejects.toThrow('有效版本')
    const orphan = await createMemoryDb()
    orphan.raw.exec('PRAGMA foreign_keys=OFF; CREATE TABLE schema_migrations(version INTEGER); INSERT INTO schema_migrations VALUES(58); CREATE TABLE parent(id TEXT PRIMARY KEY); CREATE TABLE child(parent_id TEXT REFERENCES parent(id)); INSERT INTO child VALUES(\'missing\');')
    const orphanBytes = orphan.raw.export()
    orphan.close()
    await expect(inspectNativeMigrationSnapshot(orphanBytes, open)).rejects.toThrow('失效外键')
  })
})
