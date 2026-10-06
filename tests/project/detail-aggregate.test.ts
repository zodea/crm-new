import type { TestDb } from '../helpers/memory-db'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { loadArchivedInvoiceAggregates } from '~/lib/project/detail-aggregate'
import { createMemoryDb } from '../helpers/memory-db'

async function insertSeed(db: TestDb, table: string) {
  const rows = JSON.parse(readFileSync(new URL(`../../app/lib/db/seed/${table}.json`, import.meta.url), 'utf-8')) as Record<string, unknown>[]
  for (const row of rows) {
    const columns = Object.keys(row)
    await db.execute(
      `INSERT INTO "${table}" (${columns.map(column => `"${column}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      columns.map(column => row[column]),
    )
  }
}

describe('archived invoice project aggregates', () => {
  it('preserves the archived invoice source and project range from the existing fixture', async () => {
    const db = await createMemoryDb()
    try {
      await runMigrations(db)
      for (const table of ['customers', 'projects', 'suppliers', 'invoices'])
        await insertSeed(db, table)
      expect(await loadArchivedInvoiceAggregates(db)).toEqual([
        { projectId: 'proj_demo_002', inputAmount: 10956.11, inputTax: 1423.89, archivedCount: 1 },
      ])
    }
    finally { db.close() }
  })

  it('reads real SQLite null, corrupt text, zero and red-letter values independently by project and column', async () => {
    const db = await createMemoryDb()
    try {
      await runMigrations(db)
      await db.execute(`INSERT INTO projects (id, name) VALUES ('known', '已知'), ('unknown', '未知'), ('text', '坏金额'), ('tax', '未知税额'), ('zero', '真实零')`)
      await db.execute(`
        INSERT INTO invoices (id, project_id, amount, tax_amount, account_status)
        VALUES
          ('positive', 'known', 17.500001, 1, 'archived'),
          ('red-letter', 'known', -2.5, -0.5, 'archived'),
          ('unknown-known-row', 'unknown', 10, 2, 'archived'),
          ('unknown-row', 'unknown', NULL, 1, 'archived'),
          ('text-row', 'text', 'unknown-amount', 3, 'archived'),
          ('tax-row', 'tax', 5, NULL, 'archived'),
          ('zero-row', 'zero', 0, 0, 'archived')
      `)
      const rows = await loadArchivedInvoiceAggregates(db)
      expect(rows.find(row => row.projectId === 'known')).toMatchObject({ projectId: 'known', inputTax: 0.5, archivedCount: 2 })
      expect(rows.find(row => row.projectId === 'known')!.inputAmount).toBeCloseTo(15.000001, 12)
      expect(rows.find(row => row.projectId === 'unknown')).toEqual({ projectId: 'unknown', inputAmount: null, inputTax: 3, archivedCount: 2 })
      expect(rows.find(row => row.projectId === 'text')).toEqual({ projectId: 'text', inputAmount: null, inputTax: 3, archivedCount: 1 })
      expect(rows.find(row => row.projectId === 'tax')).toEqual({ projectId: 'tax', inputAmount: 5, inputTax: null, archivedCount: 1 })
      expect(rows.find(row => row.projectId === 'zero')).toEqual({ projectId: 'zero', inputAmount: 0, inputTax: 0, archivedCount: 1 })
      expect(await db.select('SELECT amount, tax_amount FROM invoices WHERE id = ?', ['unknown-row'])).toEqual([{ amount: null, tax_amount: 1 }])
      expect(await db.select('SELECT amount FROM invoices WHERE id = ?', ['text-row'])).toEqual([{ amount: 'unknown-amount' }])
      expect(await db.select('SELECT amount FROM invoices WHERE id = ?', ['positive'])).toEqual([{ amount: 17.500001 }])
    }
    finally { db.close() }
  })

  it('excludes unarchived and soft-deleted facts and ancestors, restores original values, and keeps overflow unknown', async () => {
    const db = await createMemoryDb()
    try {
      await runMigrations(db)
      await db.execute(`INSERT INTO customers (id, name) VALUES ('customer', '客户')`)
      await db.execute(`INSERT INTO projects (id, name, customer_id) VALUES ('project', '项目', 'customer'), ('overflow', '超范围', NULL)`)
      await db.execute(`INSERT INTO suppliers (id, name) VALUES ('supplier', '分供方')`)
      await db.execute(`
        INSERT INTO invoices (id, project_id, supplier_id, amount, tax_amount, account_status, deleted_at)
        VALUES
          ('active', 'project', 'supplier', 100, 10, 'archived', NULL),
          ('pending', 'project', NULL, NULL, NULL, 'none', NULL),
          ('deleted', 'project', NULL, 900, 90, 'archived', '2026-10-05'),
          ('overflow-one', 'overflow', NULL, 1e308, 0, 'archived', NULL),
          ('overflow-two', 'overflow', NULL, 1e308, 0, 'archived', NULL)
      `)
      expect((await loadArchivedInvoiceAggregates(db)).find(row => row.projectId === 'project')).toEqual({ projectId: 'project', inputAmount: 100, inputTax: 10, archivedCount: 1 })
      expect((await loadArchivedInvoiceAggregates(db)).find(row => row.projectId === 'overflow')).toEqual({ projectId: 'overflow', inputAmount: null, inputTax: 0, archivedCount: 2 })
      for (const [table, id] of [['suppliers', 'supplier'], ['projects', 'project'], ['customers', 'customer']]) {
        await db.execute(`UPDATE ${table} SET deleted_at = '2026-10-05' WHERE id = ?`, [id])
        expect((await loadArchivedInvoiceAggregates(db)).some(row => row.projectId === 'project')).toBe(false)
        await db.execute(`UPDATE ${table} SET deleted_at = NULL WHERE id = ?`, [id])
        expect((await loadArchivedInvoiceAggregates(db)).find(row => row.projectId === 'project')).toMatchObject({ inputAmount: 100, inputTax: 10, archivedCount: 1 })
      }
    }
    finally { db.close() }
  })
})
