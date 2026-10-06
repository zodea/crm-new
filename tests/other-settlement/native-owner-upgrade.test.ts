import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { migrations, runMigrations } from '../../app/lib/db/migrations'
import { migrateExpenditureSettlementOwner } from '../../app/lib/other-settlement/schema-upgrade'
import { createMemoryDb } from '../../tests/helpers/memory-db'

async function diskSource(unknown = false) {
  const db = await createMemoryDb()
  try {
    await runMigrations(db, migrations.filter(row => row.version <= 59))
    if (unknown) {
      const source = (await db.select<{ sql: string }>('SELECT sql FROM sqlite_schema WHERE name=?', ['expenditure_settlements']))[0]!.sql
      await db.execute('DROP TABLE expenditure_settlements')
      await db.execute(source.replace(/total_amount\s+REAL\s+NOT NULL(?:\s+DEFAULT 0)?/i, 'total_amount REAL'))
    }
    await db.execute('ALTER TABLE expenditure_settlements ADD COLUMN legacy_extra TEXT')
    await db.execute('CREATE UNIQUE INDEX historical_settlement_no ON expenditure_settlements(no)')
    await db.execute('CREATE TABLE historical_settlement_reference(id TEXT PRIMARY KEY,settlement_id TEXT NOT NULL REFERENCES expenditure_settlements(id))')
    await db.execute('CREATE TRIGGER historical_settlement_note BEFORE UPDATE OF legacy_extra ON expenditure_settlements WHEN NEW.legacy_extra=\'forbidden\' BEGIN SELECT RAISE(ABORT,\'old evidence guard\'); END')
    await db.execute('INSERT INTO expenditure_settlements(id,no,name,total_amount,created_by,status,legacy_extra) VALUES(?,?,?,?,?,?,?)', ['old-zero', 'JS-OLD', '原结算', unknown ? null : 0, 'historical-actor', 'confirmed', '原独有证据'])
    await db.execute('INSERT INTO historical_settlement_reference VALUES(?,?)', ['old-link', 'old-zero'])
    const base = resolve('.tmp/a03-other-migration-review')
    await mkdir(base, { recursive: true })
    const dir = await mkdtemp(`${base}/synthetic-`)
    const path = resolve(dir, 'native.sqlite')
    await writeFile(path, db.raw.export())
    return path
  }
  finally { db.close() }
}
function driver(path: string) {
  const raw = new DatabaseSync(path)
  return { raw, async execute(sql: string, params: unknown[] = []) {
    if (params.length)
      raw.prepare(sql).run(...params as never[])
    else raw.exec(sql)
  }, async select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return raw.prepare(sql).all(...params as never[]).map(row => ({ ...row })) as T[]
  } }
}
it.each([false, true])('native60实际磁盘保旧0/NULL、独有columns/actor、关系和自有guard，冷重跑不补历史 %s', async (unknown) => {
  const path = await diskSource(unknown)
  let d = driver(path)
  try {
    const old = (await d.select('SELECT * FROM expenditure_settlements'))[0]
    await runMigrations(d)
    const after = (await d.select<Record<string, unknown>>('SELECT * FROM expenditure_settlements'))[0]!
    for (const [key, value] of Object.entries(old as object))
      expect(after[key]).toEqual(value)
    expect(after.version).toBe(0)
    expect(after.record_json).toBeNull()
    expect(after.payee_supplier_id).toBeNull()
    expect(after.payee_worker_id).toBeNull()
    expect(await d.select('SELECT * FROM historical_settlement_reference')).toEqual([{ id: 'old-link', settlement_id: 'old-zero' }])
    expect(await d.select('PRAGMA foreign_key_check')).toEqual([])
    expect(await d.select('SELECT name FROM sqlite_schema WHERE type=\'trigger\' AND name=\'historical_settlement_note\'')).toEqual([{ name: 'historical_settlement_note' }])
    await d.execute('INSERT INTO expenditure_settlements(id,no,status) VALUES(\'old-draft-probe\',\'JS-DRAFT\',\'draft\')')
    await expect(d.execute('UPDATE expenditure_settlements SET legacy_extra=\'forbidden\' WHERE id=\'old-draft-probe\'')).rejects.toThrow('old evidence guard')
    await expect(d.execute('UPDATE expenditure_settlements SET legacy_extra=\'new value\' WHERE id=\'old-zero\'')).rejects.toThrow('confirmed expenditure settlement is immutable')
    await expect(d.execute('INSERT INTO expenditure_settlements(id,no) VALUES(\'duplicate\',\'JS-OLD\')')).rejects.toThrow('UNIQUE')
    const source = d.raw.prepare('SELECT * FROM expenditure_settlements').get()
    d.raw.close()
    d = driver(path)
    await migrateExpenditureSettlementOwner(d)
    expect(d.raw.prepare('SELECT * FROM expenditure_settlements').get()).toEqual(source)
  }
  finally { d.raw.close() }
})
it('native60 COMMIT成功后schema_migrations记账中断，冷重开完整旧图幂等核验后补记账', async () => {
  const path = await diskSource()
  let d = driver(path)
  try {
    const interrupted = { ...d, execute: async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith('INSERT INTO schema_migrations') && params[0] === 60)
        throw new Error('synthetic-ledger-interruption')
      return d.execute(sql, params)
    } }
    await expect(runMigrations(interrupted)).rejects.toThrow('synthetic-ledger-interruption')
    expect(await d.select('SELECT MAX(version) v FROM schema_migrations')).toEqual([{ v: 59 }])
    const frozen = await d.select('SELECT * FROM expenditure_settlements')
    d.raw.close()
    d = driver(path)
    expect(await runMigrations(d)).toMatchObject({ from: 59, to: 60 })
    expect(await d.select('SELECT * FROM expenditure_settlements')).toEqual(frozen)
  }
  finally { d.raw.close() }
})
it.each(['partial', 'guard', 'foreign-key', 'committed-foreign-key'])('坏图 %s 不会被补空，失败保留原图/版本', async (fault) => {
  const path = await diskSource()
  const d = driver(path)
  try {
    if (fault === 'partial')
      await d.execute('ALTER TABLE expenditure_settlements ADD COLUMN payee_supplier_id TEXT')
    if (fault === 'guard') {
      await runMigrations(d)
      await d.execute('DROP TRIGGER other_settlement_history_update')
    }
    if (fault === 'committed-foreign-key')
      await runMigrations(d)
    if (fault === 'foreign-key' || fault === 'committed-foreign-key') {
      await d.execute('PRAGMA foreign_keys=OFF')
      await d.execute('INSERT INTO historical_settlement_reference VALUES(\'broken\',\'missing-head\')')
      await d.execute('PRAGMA foreign_keys=ON')
    }
    const before = await d.select('SELECT * FROM expenditure_settlements')
    const version = await d.select('SELECT MAX(version) v FROM schema_migrations')
    await expect(migrateExpenditureSettlementOwner(d)).rejects.toThrow()
    expect(await d.select('SELECT * FROM expenditure_settlements')).toEqual(before)
    expect(await d.select('SELECT MAX(version) v FROM schema_migrations')).toEqual(version)
  }
  finally { d.raw.close() }
})
