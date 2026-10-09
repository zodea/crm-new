import { expect, it } from 'vitest'
import { captureMigrationDomainRows } from '../../server/utils/migration-domain-evidence'
import { createMemoryDb } from '../helpers/memory-db'

it('本域精确采集整数键、复合actor键、未知整数与BLOB，缺行不可伪装空集合', async () => {
  const db = await createMemoryDb()
  try {
    await db.execute('CREATE TABLE source_revision(singleton INTEGER PRIMARY KEY,value INTEGER,extension BLOB)')
    await db.execute('INSERT INTO source_revision VALUES (1,9223372036854775807,X\'00FF01\')')
    await db.execute('CREATE TABLE source_receipts(workspace_id TEXT,actor_id TEXT,command_id TEXT,json TEXT,PRIMARY KEY(workspace_id,actor_id,command_id))')
    await db.execute('INSERT INTO source_receipts VALUES (\'ws\',\'actor-a\',\'same-cmd\',\'{"future":"first"}\'),(\'ws\',\'actor-b\',\'same-cmd\',\'{"future":"second"}\')')
    const before = db.raw.export()
    const captured = await captureMigrationDomainRows(db, [
      { table: 'source_revision', key: 'singleton', ids: ['1'] },
      { table: 'source_receipts', keys: ['workspace_id', 'actor_id', 'command_id'], ids: [JSON.stringify(['ws', 'actor-a', 'same-cmd']), JSON.stringify(['ws', 'actor-b', 'same-cmd'])] },
    ])
    expect(captured.rows.source_revision).toEqual([{ legacyId: '1', columns: { singleton: { sqliteType: 'integer', exactValue: '1', rawHex: null }, value: { sqliteType: 'integer', exactValue: '9223372036854775807', rawHex: null }, extension: { sqliteType: 'blob', exactValue: '00FF01', rawHex: '00FF01' } } }])
    expect(captured.rows.source_receipts?.map(row => row.legacyId)).toEqual([JSON.stringify(['ws', 'actor-a', 'same-cmd']), JSON.stringify(['ws', 'actor-b', 'same-cmd'])])
    expect(captured.schemas.source_revision?.sql).toContain('extension BLOB')
    expect(db.raw.export()).toEqual(before)
    await expect(captureMigrationDomainRows(db, [{ table: 'source_revision', key: 'singleton', ids: ['2'] }])).rejects.toThrow('不完整')
    await expect(captureMigrationDomainRows(db, [{ table: 'missing', key: 'id', ids: [] }])).rejects.toThrow('不能以空集合')
  }
  finally { db.close() }
})
