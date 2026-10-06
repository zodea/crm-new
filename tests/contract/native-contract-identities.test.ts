import type { SQLInputValue } from 'node:sqlite'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { migrations, runMigrations } from '~/lib/db/migrations'
import { migrateNullableContractAmounts } from '~/lib/db/nullable-contract-amounts'
import { createMemoryDb } from '../helpers/memory-db'

async function native52() {
  const db = await createMemoryDb()
  await runMigrations(db, migrations.filter(migration => migration.version <= 52))
  await db.execute('INSERT INTO contracts(id,no,name,kind,amount,party_a,status) VALUES(\'main-zero\',\'OLD-001\',\'历史真零\',\'材采\',0,\'原文甲方未映射\',\'已签订\')')
  await db.execute('INSERT INTO contract_supplements(id,contract_id,name,amount) VALUES(\'protocol-old\',\'main-zero\',\'历史协议\',0)')
  await db.execute('INSERT INTO company_expense_contracts(id,no,name,amount,party_a,status) VALUES(\'company-old\',\'OLD-001\',\'历史另一重号\',1,\'另一原文主体\',\'履约中\')')
  await db.execute('INSERT INTO contract_supplement_line_items(id,supplement_id,material_name,original_line_snapshot,original_source_updated_at) VALUES(\'frozen-line\',\'protocol-old\',\'原材料\',\'{"materialName":"冻结原文","qty":1}\',\'2026-08-01T00:00:00.000Z\')')
  await db.execute('CREATE TABLE a02_amount_audit(owner_id TEXT,old_amount REAL,new_amount REAL)')
  await db.execute('CREATE TRIGGER a02_contract_amount_update AFTER UPDATE OF amount ON contracts BEGIN INSERT INTO a02_amount_audit VALUES(OLD.id,OLD.amount,NEW.amount); END')
  await db.execute('CREATE INDEX a02_contract_party ON contracts(party_a) WHERE deleted_at IS NULL')
  await db.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size) VALUES(\'historic-original\',\'contract\',\'main-zero\',\'历史空原件.txt\',0)')
  await db.execute('INSERT INTO file_payloads(file_ref_id,encoding,content) VALUES(\'historic-original\',\'base64\',\'\')')
  return db
}
it('实际v52磁盘在schema53已提交而版本记账前冷断，重开重试不丢证据也不重复占号', async () => {
  const old = await native52()
  const base = resolve('.tmp/a02-material-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(join(base, 'native53-cold-'))
  const path = join(directory, 'native.sqlite')
  await writeFile(path, old.raw.export())
  old.close()
  let disk = new DatabaseSync(path)
  const adapter = {
    async execute(sql: string, params: unknown[] = []) {
      if (/INSERT INTO schema_migrations/.test(sql) && params[0] === 53)
        throw new Error('模拟53结构提交后版本记账前冷断')
      if (params.length)
        disk.prepare(sql).run(...params as SQLInputValue[])
      else
        disk.exec(sql)
    },
    async select<T>(sql: string, params: unknown[] = []) { return disk.prepare(sql).all(...params as SQLInputValue[]) as T[] },
  }
  try {
    await expect(runMigrations(adapter, migrations.filter(row => row.version <= 53))).rejects.toThrow('记账前冷断')
    expect(disk.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version).toBe(52)
    expect(disk.prepare('SELECT "notnull" AS required FROM pragma_table_info(\'contracts\') WHERE name=\'amount\'').get()?.required).toBe(0)
    const facts = disk.prepare('SELECT * FROM contracts').all()
    const numbers = disk.prepare('SELECT * FROM contract_number_claims ORDER BY owner_domain').all()
    const history = disk.prepare('SELECT * FROM contract_number_history ORDER BY id').all()
    const snapshot = disk.prepare('SELECT * FROM contract_supplement_line_items').all()
    const bytes = disk.prepare('SELECT * FROM file_payloads').all()
    disk.close()
    disk = new DatabaseSync(path)
    await runMigrations({ ...adapter, async execute(sql, params = []) {
      if (params.length)
        disk.prepare(sql).run(...params as SQLInputValue[])
      else
        disk.exec(sql)
    } }, migrations.filter(row => row.version <= 53))
    expect(disk.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version).toBe(53)
    expect(disk.prepare('SELECT * FROM contracts').all()).toEqual(facts)
    expect(disk.prepare('SELECT * FROM contract_number_claims ORDER BY owner_domain').all()).toEqual(numbers)
    expect(disk.prepare('SELECT * FROM contract_number_history ORDER BY id').all()).toEqual(history)
    expect(disk.prepare('SELECT * FROM contract_supplement_line_items').all()).toEqual(snapshot)
    expect(disk.prepare('SELECT * FROM file_payloads').all()).toEqual(bytes)
    expect(disk.prepare('SELECT * FROM a02_amount_audit').all()).toEqual([])
    expect(disk.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    disk.prepare('UPDATE contracts SET amount=NULL WHERE id=\'main-zero\'').run()
    expect(disk.prepare('SELECT amount,party_a FROM contracts WHERE id=\'main-zero\'').get()).toEqual({ amount: null, party_a: '原文甲方未映射' })
  }
  finally {
    disk.close()
  }
})
it('v53保全部旧列、索引、触发器、外键、真零、主体原文、冻结及原件；冷开可保存null', async () => {
  const db = await native52()
  try {
    const schemas = await db.select<{
      type: string
      name: string
      sql: string
    }>('SELECT type,name,sql FROM sqlite_master WHERE tbl_name IN (\'contracts\',\'contract_supplements\',\'company_expense_contracts\') AND type IN (\'index\',\'trigger\') ORDER BY name')
    const fields = await db.select<{
      name: string
    }>('SELECT name FROM pragma_table_info(\'contracts\')')
    const fk = await db.select('PRAGMA foreign_key_list(contracts)')
    const frozen = await db.select('SELECT * FROM contract_supplement_line_items')
    const payload = await db.select('SELECT * FROM file_payloads')
    await runMigrations(db, migrations.filter(row => row.version <= 53))
    expect((await db.select<{
      name: string
    }>('SELECT name FROM pragma_table_info(\'contracts\')')).map(row => row.name)).toEqual([...fields.map(row => row.name), 'our_signatory_id', 'our_signatory_snapshot'])
    expect(await db.select('SELECT type,name,sql FROM sqlite_master WHERE tbl_name IN (\'contracts\',\'contract_supplements\',\'company_expense_contracts\') AND type IN (\'index\',\'trigger\') ORDER BY name')).toEqual(schemas)
    expect(await db.select('PRAGMA foreign_key_list(contracts)')).toEqual([{ id: 0, seq: 0, table: 'our_signatories', from: 'our_signatory_id', to: 'id', on_update: 'NO ACTION', on_delete: 'NO ACTION', match: 'NONE' }, ...fk.map((row: any) => ({ ...row, id: row.id + 1 }))])
    expect(await db.select('SELECT * FROM contract_supplement_line_items')).toEqual(frozen)
    expect(await db.select('SELECT * FROM file_payloads')).toEqual(payload)
    expect(await db.select('SELECT amount,party_a,our_signatory_id,our_signatory_snapshot FROM contracts WHERE id=?', ['main-zero'])).toEqual([{ amount: 0, party_a: '原文甲方未映射', our_signatory_id: null, our_signatory_snapshot: null }])
    expect(await db.select('SELECT * FROM a02_amount_audit')).toEqual([])
    expect(await db.select('SELECT number FROM contract_number_claims ORDER BY owner_domain')).toEqual([{ number: 'OLD-001' }, { number: 'OLD-001' }])
    for (const [table, id] of [['contracts', 'main-zero'], ['contract_supplements', 'protocol-old'], ['company_expense_contracts', 'company-old']])
      await db.execute(`UPDATE ${table} SET amount=NULL WHERE id=?`, [id])
    expect(await db.select('PRAGMA foreign_key_check')).toEqual([])
    const cold = await createMemoryDb(db.raw.export())
    try {
      await runMigrations(cold, migrations.filter(row => row.version <= 53))
      expect(await cold.select('SELECT amount FROM contracts WHERE id=?', ['main-zero'])).toEqual([{ amount: null }])
      expect(await cold.select('SELECT * FROM file_payloads')).toEqual(payload)
      expect(await cold.select('SELECT * FROM contract_supplement_line_items')).toEqual(frozen)
      expect(await cold.select('SELECT * FROM a02_amount_audit')).toEqual([{ owner_id: 'main-zero', old_amount: 0, new_amount: null }])
    }
    finally {
      cold.close()
    }
  }
  finally {
    db.close()
  }
})
it('v53追加中断完整撤回schema和数据；重试用同一图成功，不放宽缺真实表', async () => {
  const db = await native52()
  try {
    const before = await db.select('SELECT type,name,sql FROM sqlite_master ORDER BY type,name')
    const data = await db.select('SELECT * FROM contracts')
    await expect(migrateNullableContractAmounts(db, async () => {
      throw new Error('模拟后续主体DDL中断')
    })).rejects.toThrow('模拟')
    expect(await db.select('SELECT type,name,sql FROM sqlite_master ORDER BY type,name')).toEqual(before)
    expect(await db.select('SELECT * FROM contracts')).toEqual(data)
    await runMigrations(db)
    const same = await db.select('SELECT * FROM contracts')
    await migrations.find(migration => migration.version === 53)!.up(db)
    expect(await db.select('SELECT * FROM contracts')).toEqual(same)
    expect(await db.select('PRAGMA foreign_key_check')).toEqual([])
  }
  finally {
    db.close()
  }
})
