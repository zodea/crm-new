import type { SQLInputValue } from 'node:sqlite'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, expect, it } from 'vitest'
import { migrations, runMigrations } from '~/lib/db/migrations'
import { createMemoryDb } from '../helpers/memory-db'
import { cleanupTestTempRoot, testTempRoot } from '../helpers/test-temp-root'

afterAll(cleanupTestTempRoot)

it('真实 v55 磁盘升级 v56 冷断重开核图，不按历史同名猜接；升级中断可回滚', async () => {
  const db = await createMemoryDb()
  const root = testTempRoot('a01-finance-tests')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'native56-identity-cold-'))
  const path = join(directory, 'synthetic.sqlite')
  const identityMigrations = migrations.filter(migration => migration.version <= 56)
  try {
    await runMigrations(db, migrations.filter(migration => migration.version <= 55))
    await db.execute(`INSERT INTO workers(id,name) VALUES('worker-1','同名'),('worker-2','同名')`)
    await db.execute(`INSERT INTO suppliers(id,name) VALUES('supplier-1','同名')`)
    await db.execute(`INSERT INTO current_transactions(id,direction,counterparty,amount) VALUES('old-current','receipt','同名',0)`)
    await db.execute(`INSERT INTO expense_reimbursements(id,applicant,status) VALUES('old-expense','同名','confirmed')`)
    await db.execute(`INSERT INTO expense_reimbursement_lines(id,reimbursement_id,expense_item,amount) VALUES('old-line','old-expense','原费用',40)`)
    await db.execute(`INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size) VALUES('original','expense_reimbursement','old-expense','原文.txt',3)`)
    await db.execute(`INSERT INTO file_payloads(file_ref_id,encoding,content) VALUES('original','base64','YWJj')`)
    const tables = ['workers', 'suppliers', 'current_transactions', 'expense_reimbursements', 'expense_reimbursement_lines', 'operation_logs', 'file_refs', 'file_payloads', 'contracts', 'contract_number_history']
    const before = new Map(await Promise.all(tables.map(async table => [table, await db.select<Record<string, unknown>>(`SELECT * FROM ${table} ORDER BY 1`)] as const)))
    await writeFile(path, db.raw.export())
    let disk = new DatabaseSync(path)
    const adapter = {
      async select<T>(sql: string, params: unknown[] = []) { return disk.prepare(sql).all(...params as SQLInputValue[]) as T[] },
      async execute(sql: string, params: unknown[] = []) {
        if (params.length)
          disk.prepare(sql).run(...params as SQLInputValue[])
        else disk.exec(sql)
      },
    }
    try {
      await expect(runMigrations({ ...adapter, async execute(sql, params = []) {
        if (sql.includes('CREATE TRIGGER IF NOT EXISTS expense_referenced_party'))
          throw new Error('v56事务中断')
        await adapter.execute(sql, params)
      } }, identityMigrations)).rejects.toThrow('v56事务中断')
      expect(disk.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version).toBe(55)
      for (const table of tables) expect(await adapter.select(`SELECT * FROM ${table} ORDER BY 1`)).toEqual(before.get(table))
      await expect(runMigrations({ ...adapter, async execute(sql, params = []) {
        if (sql.includes('INSERT INTO schema_migrations') && params[0] === 56)
          throw new Error('v56版本记账前冷断')
        await adapter.execute(sql, params)
      } }, identityMigrations)).rejects.toThrow('v56版本记账前冷断')
      disk.close()
      disk = new DatabaseSync(path)
      await runMigrations(adapter, identityMigrations)
      await runMigrations(adapter, identityMigrations)
      expect(disk.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version).toBe(56)
      for (const table of tables) {
        const added = table === 'current_transactions'
          ? ['supplier_id', 'counterparty_name_snapshot']
          : table === 'expense_reimbursements'
            ? ['applicant_worker_id', 'applicant_supplier_id', 'applicant_name_snapshot']
            : table === 'expense_reimbursement_lines' ? ['counterparty_supplier_id', 'counterparty_name_snapshot'] : []
        const rows = await adapter.select<Record<string, unknown>>(`SELECT * FROM ${table} ORDER BY 1`)
        expect(rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !added.includes(key))))).toEqual(before.get(table))
        for (const row of rows) {
          for (const key of added) expect(row[key]).toBeNull()
        }
      }
      expect(await adapter.select('PRAGMA foreign_key_check')).toEqual([])
      expect(disk.prepare('SELECT amount FROM current_transactions WHERE id=\'old-current\'').get()?.amount).toBe(0)
      expect(disk.prepare('SELECT content FROM file_payloads WHERE file_ref_id=\'original\'').get()?.content).toBe('YWJj')
    }
    finally { disk.close() }
  }
  finally { db.close() }
})
