import type { SQLInputValue } from 'node:sqlite'
import type { TestDb } from '../helpers/memory-db'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrations, runMigrations } from '~/lib/db/migrations'
import { migrateExpenseReferences, originalExpenseReference } from '~/lib/finance/expense-references'
import { createMemoryDb } from '../helpers/memory-db'

let db: TestDb
beforeEach(async () => {
  db = await createMemoryDb()
  await runMigrations(db, migrations.filter(migration => migration.version <= 53))
  await db.execute(`INSERT INTO projects(id,name) VALUES('project-a','项目A'),('project-b','项目B')`)
  await db.execute(`INSERT INTO expense_reimbursements(id,project_id,applicant,status,created_at)
    VALUES('expense-owner','project-a','保全历史申请人','confirmed','2026-01-02T03:04:05Z'),
      ('clearance-owner','project-a','另一次申请人','draft','2026-09-02T03:04:05Z'),
      ('other-project-owner','project-b','其他项目','draft','2026-09-02T03:04:05Z'),
      ('company-owner',NULL,'公司原姓名','confirmed','2026-01-02T03:04:05Z'),
      ('company-clearance',NULL,'公司申请人','draft','2026-09-02T03:04:05Z')`)
  await db.execute(`INSERT INTO expense_reimbursement_lines(id,reimbursement_id,expense_item,expense_date,amount,note,created_at)
    VALUES('expense-original','expense-owner','原运费','2026-01-01',100,'原依据','2026-01-02T03:04:05Z'),
      ('company-original','company-owner','原公司费用','2026-01-01',20,'原依据','2026-01-02T03:04:05Z')`)
})
afterEach(() => db.close())

describe('既有费用原身份引用及迁移保全', () => {
  it('真实53磁盘在54结构提交而版本未记账时冷断，重开核原费用/凭证/合同身份并幂等升级', async () => {
    await db.execute(`INSERT INTO suppliers(id,name,credential_status,credential_reviewed_at,credential_review_note) VALUES('supplier-proof','旧供应商','qualified','2026-09-01','真实人工原文')`)
    await db.execute(`INSERT INTO contracts(id,no,name,kind,amount,status) VALUES('contract-proof','OLD-54','原合同','材采',NULL,'履约中')`)
    await db.execute(`INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size) VALUES('expense-file','expense_reimbursement','expense-owner','旧运费票据.txt',6)`)
    await db.execute(`INSERT INTO file_payloads(file_ref_id,encoding,content) VALUES('expense-file','base64','5Y6f5Lu2')`)
    const untouchedSchema = await db.select(`SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name<>'expense_reimbursement_lines' AND name<>'schema_migrations' AND name NOT LIKE 'expense_ref%' ORDER BY type,name`)
    const original = await db.select('SELECT * FROM expense_reimbursement_lines ORDER BY id')
    const evidenceTables = ['expense_reimbursements', 'file_refs', 'file_payloads', 'suppliers', 'supplier_credential_review_history', 'contracts', 'our_signatories', 'contract_number_claims', 'contract_number_history']
    const originalEvidence = new Map(await Promise.all(evidenceTables.map(async table => [table, await db.select(`SELECT * FROM ${table} ORDER BY 1`)] as const)))
    const root = resolve('.tmp/a01-supplier-tests')
    await mkdir(root, { recursive: true })
    const directory = await mkdtemp(join(root, 'native54-expense-cold-'))
    const path = join(directory, 'synthetic.sqlite')
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
        if (sql.includes('INSERT INTO schema_migrations') && params[0] === 54)
          throw new Error('54版本记账前冷断')
        await adapter.execute(sql, params)
      } }, migrations.filter(migration => migration.version <= 54))).rejects.toThrow('54版本记账前冷断')
      expect(disk.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version).toBe(53)
      expect(disk.prepare('SELECT name FROM pragma_table_info(\'expense_reimbursement_lines\') WHERE name=\'original_expense_line_id\'').all()).toEqual([{ name: 'original_expense_line_id' }])
      disk.close()
      disk = new DatabaseSync(path)
      await runMigrations(adapter, migrations.filter(migration => migration.version <= 54))
      await runMigrations(adapter, migrations.filter(migration => migration.version <= 54))
      expect(disk.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version).toBe(54)
      expect(await adapter.select(`SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name<>'expense_reimbursement_lines' AND name<>'schema_migrations' AND name NOT LIKE 'expense_ref%' ORDER BY type,name`)).toEqual(untouchedSchema)
      expect((await adapter.select<Record<string, unknown>>('SELECT * FROM expense_reimbursement_lines ORDER BY id')).map(({ original_expense_line_id, ...old }) => ({ old, source: original_expense_line_id }))).toEqual(original.map(old => ({ old, source: null })))
      for (const table of evidenceTables)
        expect(await adapter.select(`SELECT * FROM ${table} ORDER BY 1`), table).toEqual(originalEvidence.get(table))
      expect(await adapter.select('PRAGMA foreign_key_check')).toEqual([])
    }
    finally { disk.close() }
  })
  it('升级保全旧行、申请人、证据与索引，中断回滚后重跑不猜原费用映射', async () => {
    const originalRows = await db.select('SELECT * FROM expense_reimbursement_lines ORDER BY id')
    const originalOwners = await db.select('SELECT * FROM expense_reimbursements ORDER BY id')
    const originalIndexes = await db.select('SELECT name,sql FROM sqlite_master WHERE type=\'index\' AND tbl_name=\'expense_reimbursement_lines\' ORDER BY name')
    await db.execute('BEGIN')
    await expect(migrateExpenseReferences({ select: db.select, execute: async (sql, params) => {
      if (sql.includes('CREATE TRIGGER'))
        throw new Error('升级中断')
      await db.execute(sql, params)
    } })).rejects.toThrow('升级中断')
    await db.execute('ROLLBACK')
    expect(await db.select('SELECT * FROM expense_reimbursement_lines ORDER BY id')).toEqual(originalRows)
    await migrateExpenseReferences(db)
    await migrateExpenseReferences(db)
    const rows = await db.select<Record<string, unknown>>('SELECT * FROM expense_reimbursement_lines ORDER BY id')
    expect(rows.map(({ original_expense_line_id, ...old }) => ({ old, reference: original_expense_line_id })))
      .toEqual(originalRows.map(old => ({ old, reference: null })))
    expect(await db.select('SELECT * FROM expense_reimbursements ORDER BY id')).toEqual(originalOwners)
    expect(await db.select('SELECT name,sql FROM sqlite_master WHERE type=\'index\' AND tbl_name=\'expense_reimbursement_lines\' AND name<>\'idx_expense_original_reference\' ORDER BY name')).toEqual(originalIndexes)
    const bytes = db.raw.export()
    const reopened = await createMemoryDb(bytes)
    try {
      expect(await originalExpenseReference(reopened, 'expense-original')).toEqual({
        id: 'expense-original',
        reimbursementId: 'expense-owner',
        projectId: 'project-a',
        item: '原运费',
        amount: 100,
        applicant: '保全历史申请人',
      })
      expect(await reopened.select('PRAGMA foreign_key_check')).toEqual([])
    }
    finally { reopened.close() }
  })

  it('只采用同归属已确认原费用，拒绝他项目、自引用、链式引用与未知身份', async () => {
    await migrateExpenseReferences(db)
    const insert = (id: string, owner: string, source: string) => db.execute(`INSERT INTO expense_reimbursement_lines
      (id,reimbursement_id,expense_item,amount,original_expense_line_id) VALUES(?,?,'明示原费用引用',40,?)`, [id, owner, source])
    await insert('clearance-line', 'clearance-owner', 'expense-original')
    expect(await originalExpenseReference(db, 'clearance-line')).toBeNull()
    await expect(insert('cross-project', 'other-project-owner', 'expense-original')).rejects.toThrow('同归属')
    await expect(insert('missing-source', 'clearance-owner', 'missing')).rejects.toThrow('原费用引用')
    await expect(insert('self-reference', 'clearance-owner', 'self-reference')).rejects.toThrow()
    await expect(insert('chain-reference', 'clearance-owner', 'clearance-line')).rejects.toThrow('原费用引用')
    await expect(insert('same-owner', 'expense-owner', 'expense-original')).rejects.toThrow('独立费用')
    await db.execute(`INSERT INTO expense_reimbursement_lines(id,reimbursement_id,expense_item,amount,original_expense_line_id)
      VALUES('company-reference','company-clearance','公司费用引用',20,'company-original')`)
    expect(await db.select('SELECT original_expense_line_id FROM expense_reimbursement_lines WHERE id=?', ['company-reference']))
      .toEqual([{ original_expense_line_id: 'company-original' }])
  })

  it('原引用及软删历史继续保护源行、日期金额与确认归属，不删除原事实', async () => {
    await migrateExpenseReferences(db)
    await db.execute(`INSERT INTO expense_reimbursement_lines(id,reimbursement_id,expense_item,amount,original_expense_line_id)
      VALUES('clearance-line','clearance-owner','引用原运费',40,'expense-original')`)
    await db.execute('UPDATE expense_reimbursement_lines SET deleted_at=\'2026-10-04\' WHERE id=\'clearance-line\'')
    for (const mutation of [
      'UPDATE expense_reimbursement_lines SET amount=101 WHERE id=\'expense-original\'',
      'UPDATE expense_reimbursement_lines SET expense_date=\'2026-02-01\' WHERE id=\'expense-original\'',
      'UPDATE expense_reimbursement_lines SET deleted_at=\'2026-10-04\' WHERE id=\'expense-original\'',
      'DELETE FROM expense_reimbursement_lines WHERE id=\'expense-original\'',
      'UPDATE expense_reimbursements SET project_id=\'project-b\' WHERE id=\'expense-owner\'',
      'UPDATE expense_reimbursements SET status=\'draft\' WHERE id=\'expense-owner\'',
      'UPDATE expense_reimbursements SET deleted_at=\'2026-10-04\' WHERE id=\'expense-owner\'',
      'DELETE FROM expense_reimbursements WHERE id=\'expense-owner\'',
    ])
      await expect(db.execute(mutation)).rejects.toThrow('原费用引用')
    expect(await originalExpenseReference(db, 'expense-original')).toMatchObject({ amount: 100, projectId: 'project-a', applicant: '保全历史申请人' })
  })
})
