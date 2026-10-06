import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { withVerifiedMigrationSnapshot } from '../../server/utils/migration-snapshot'
import { createMemoryDb } from '../helpers/memory-db'

async function fixture(orphan = false) {
  const db = await createMemoryDb()
  db.raw.exec('CREATE TABLE schema_migrations(version INTEGER); INSERT INTO schema_migrations VALUES(58); CREATE TABLE workers(id TEXT PRIMARY KEY,name TEXT NOT NULL); CREATE TABLE frozen(id TEXT PRIMARY KEY, worker_id TEXT REFERENCES workers(id),body TEXT,original BLOB); INSERT INTO workers VALUES(\'same-stable-worker\',\'  原姓名  \'); INSERT INTO frozen VALUES(\'frozen-1\',\'same-stable-worker\',\'{"amount":0,"unknown":null}\',X\'000A80FF\');')
  if (orphan)
    db.raw.exec('PRAGMA foreign_keys=OFF; INSERT INTO frozen VALUES(\'orphan\',\'unknown-worker\',\'{}\',X\'00\');')
  const bytes = db.raw.export()
  db.close()
  return { bytes, proof: { sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: Buffer.from(bytes).toString('base64') } }
}

describe('中央实际 SQLite 来源核验', () => {
  it('实际来源读取原ID、原文、零/未知与BLOB；拒绝写入且完整关闭', async () => {
    const f = await fixture()
    const result = await withVerifiedMigrationSnapshot(f.proof, async (tx, evidence) => {
      expect(evidence).toEqual({ sha256: f.proof.sha256, schemaVersion: 58 })
      expect(await tx.select('SELECT id,name FROM workers')).toEqual([{ id: 'same-stable-worker', name: '  原姓名  ' }])
      await expect(tx.execute('DELETE FROM frozen')).rejects.toThrow('只允许核验')
      await expect(tx.select('DELETE FROM workers RETURNING id')).rejects.toThrow()
      return tx.select('SELECT id,body,hex(original) AS original FROM frozen')
    })
    expect(result).toEqual([{ id: 'frozen-1', body: '{"amount":0,"unknown":null}', original: '000A80FF' }])
    const reopened = await createMemoryDb(f.bytes)
    try {
      expect(await reopened.select('SELECT COUNT(*) AS n FROM frozen')).toEqual([{ n: 1 }])
    }
    finally { reopened.close() }
  })

  it('不能仅声称旧摘要、提交图或伪造版本证明；失效外键保留源字节', async () => {
    const f = await fixture()
    await expect(withVerifiedMigrationSnapshot({ ...f.proof, sha256: '0'.repeat(64) }, async () => null)).rejects.toThrow('实际摘要不一致')
    await expect(withVerifiedMigrationSnapshot({ ...f.proof, payloadBase64: `${f.proof.payloadBase64}\n` }, async () => null)).rejects.toThrow('完整 SQLite 字节')
    await expect(withVerifiedMigrationSnapshot({ ...f.proof, graph: {} } as typeof f.proof, async () => null)).rejects.toThrow('完整 SQLite 字节')
    const bad = await fixture(true)
    const before = Uint8Array.from(bad.bytes)
    await expect(withVerifiedMigrationSnapshot(bad.proof, async () => null)).rejects.toThrow('失效外键')
    expect(bad.bytes).toEqual(before)
    await expect(withVerifiedMigrationSnapshot(f.proof, async () => {
      throw new Error('领域独立核验未通过')
    })).rejects.toThrow('领域独立核验未通过')
    expect(await withVerifiedMigrationSnapshot(f.proof, async tx => tx.select('SELECT id FROM workers'))).toEqual([{ id: 'same-stable-worker' }])
  })
})
