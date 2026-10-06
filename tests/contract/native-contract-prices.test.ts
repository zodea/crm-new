import type { SQLInputValue } from 'node:sqlite'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { migrations, runMigrations } from '~/lib/db/migrations'
import { readNativeContractPrices } from '~/lib/material-contract/native-prices'
import { columnNames, createMemoryDb } from '../helpers/memory-db'

async function native54() {
  const db = await createMemoryDb()
  await runMigrations(db, migrations.filter(row => row.version <= 54))
  await db.execute('INSERT INTO contracts(id,no,name,kind,amount,tax_rate,status) VALUES(\'price-main\',\'P55\',\'原始材采\',\'材采\',0,13,\'履约中\')')
  await db.execute('INSERT INTO contract_line_items(id,contract_id,material_name,unit,qty,tax_inclusive_unit_price) VALUES(\'price-original\',\'price-main\',\'方管\',\'吨\',1,18000)')
  await db.execute('INSERT INTO contract_supplements(id,contract_id,name,amount,status) VALUES(\'price-supplement\',\'price-main\',\'原协议\',0,\'已签订\')')
  await db.execute('INSERT INTO contract_supplement_line_items(id,supplement_id,material_name,unit,qty,tax_inclusive_unit_price,original_line_snapshot) VALUES(\'price-child\',\'price-supplement\',\'方管\',\'千克\',1000,0,\'{"unit":"冻结吨","qty":1}\')')
  return db
}

it('v55中途失败回滚两张表，冷重试保全部原行/冻结正文；旧税点NULL不套头13%', async () => {
  const db = await native54()
  const before = await db.select('SELECT * FROM contract_supplement_line_items')
  let interrupted = false
  const failing = { select: db.select, execute: async (sql: string, params?: unknown[]) => {
    if (!interrupted && sql.includes('ALTER TABLE \"contract_supplement_line_items\"') && sql.includes('applicable_tax_rate')) {
      interrupted = true
      throw new Error('第二张表实际中断')
    }
    return db.execute(sql, params)
  } }
  await expect(runMigrations(failing, migrations.filter(row => row.version <= 55))).rejects.toThrow('实际中断')
  expect(await columnNames(db, 'contract_line_items')).not.toContain('applicable_tax_rate')
  expect(await db.select('SELECT * FROM contract_supplement_line_items')).toEqual(before)
  const cold = await createMemoryDb(db.raw.export())
  db.close()
  try {
    expect((await runMigrations(cold, migrations.filter(row => row.version <= 55))).to).toBe(55)
    const rows = await readNativeContractPrices(cold)
    expect(rows.map(row => row.applicableTaxRate)).toEqual([null, null])
    expect(rows.map(row => row.taxInclusiveUnitPrice)).toEqual([18000, 0])
    expect(await cold.select('SELECT original_line_snapshot FROM contract_supplement_line_items')).toEqual([{ original_line_snapshot: '{"unit":"冻结吨","qty":1}' }])
    await cold.execute('UPDATE contract_line_items SET applicable_tax_rate=0 WHERE id=\'price-original\'')
    expect((await readNativeContractPrices(cold))[0]?.applicableTaxRate).toBe(0)
    await expect(cold.execute('UPDATE contract_line_items SET applicable_tax_rate=-1 WHERE id=\'price-original\'')).rejects.toThrow()
  }
  finally { cold.close() }
})

it('v55结构已提交但版本记账中断可冷重跑，不复制列/价格或把空税点补零', async () => {
  const db = await native54()
  await expect(runMigrations({ select: db.select, execute: async (sql, params) => {
    if (/INSERT INTO schema_migrations/.test(sql) && params?.[0] === 55)
      throw new Error('版本记账前中断')
    return db.execute(sql, params)
  } }, migrations.filter(row => row.version <= 55))).rejects.toThrow('版本记账')
  const cold = await createMemoryDb(db.raw.export())
  db.close()
  try {
    expect((await runMigrations(cold, migrations.filter(row => row.version <= 55))).to).toBe(55)
    expect((await columnNames(cold, 'contract_line_items')).filter(name => name === 'applicable_tax_rate')).toHaveLength(1)
    expect(await cold.select('SELECT version FROM schema_migrations WHERE version=55')).toEqual([{ version: 55 }])
    expect((await readNativeContractPrices(cold)).map(row => [row.contractId, row.lineId, row.taxInclusiveUnitPrice, row.applicableTaxRate])).toEqual([
      ['price-main', 'price-original', 18000, null],
      ['price-supplement', 'price-child', 0, null],
    ])
    expect((await runMigrations(cold, migrations.filter(row => row.version <= 55))).applied).toEqual([])
  }
  finally { cold.close() }
})

it('实际Native查询保留主协议原行，但作废协议及作废主合同不进入有效价格', async () => {
  const db = await native54()
  try {
    await runMigrations(db, migrations.filter(row => row.version <= 55))
    await db.execute('UPDATE contract_supplements SET status=? WHERE id=?', ['已作废', 'price-supplement'])
    expect((await readNativeContractPrices(db)).map(row => row.lineId)).toEqual(['price-original'])
    expect(await db.select('SELECT id,original_line_snapshot FROM contract_supplement_line_items')).toEqual([{ id: 'price-child', original_line_snapshot: '{"unit":"冻结吨","qty":1}' }])
    await db.execute('UPDATE contracts SET status=? WHERE id=?', ['已作废', 'price-main'])
    expect(await readNativeContractPrices(db)).toEqual([])
    expect(await db.select('SELECT id,tax_inclusive_unit_price FROM contract_line_items')).toEqual([{ id: 'price-original', tax_inclusive_unit_price: 18000 }])
  }
  finally { db.close() }
})

it('实际v54磁盘在55结构提交后版本记账前冷断，原价原冻结正文冷开重试保全', async () => {
  const old = await native54()
  const base = resolve('.tmp/a02-material-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(join(base, 'native55-cold-'))
  const path = join(directory, 'native.sqlite')
  await writeFile(path, old.raw.export())
  old.close()
  let disk = new DatabaseSync(path)
  let failVersion = true
  const adapter = {
    async execute(sql: string, params: unknown[] = []) {
      if (failVersion && /INSERT INTO schema_migrations/.test(sql) && params[0] === 55)
        throw new Error('磁盘55版本记账前冷断')
      if (params.length)
        disk.prepare(sql).run(...params as SQLInputValue[])
      else
        disk.exec(sql)
    },
    async select<T>(sql: string, params: unknown[] = []) {
      return disk.prepare(sql).all(...params as SQLInputValue[]) as T[]
    },
  }
  await expect(runMigrations(adapter, migrations.filter(row => row.version <= 55))).rejects.toThrow('冷断')
  disk.close()
  disk = new DatabaseSync(path)
  try {
    expect(disk.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version).toBe(54)
    expect(disk.prepare('SELECT applicable_tax_rate FROM contract_line_items').get()?.applicable_tax_rate).toBeNull()
    const evidence = disk.prepare('SELECT original_line_snapshot FROM contract_supplement_line_items').all()
    failVersion = false
    expect((await runMigrations(adapter, migrations.filter(row => row.version <= 55))).to).toBe(55)
    expect((await readNativeContractPrices(adapter)).map(row => [row.contractId, row.lineId, row.taxInclusiveUnitPrice, row.applicableTaxRate])).toEqual([
      ['price-main', 'price-original', 18000, null],
      ['price-supplement', 'price-child', 0, null],
    ])
    expect(disk.prepare('SELECT original_line_snapshot FROM contract_supplement_line_items').all()).toEqual(evidence)
    expect(disk.prepare('SELECT version FROM schema_migrations WHERE version=55').all()).toEqual([{ version: 55 }])
    expect(disk.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  }
  finally { disk.close() }
})
