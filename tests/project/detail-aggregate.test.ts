import type { TestDb } from '../helpers/memory-db'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import {
  loadArchivedInvoiceAggregates,
  loadProjectDetailAggregates,
} from '~/lib/project/detail-aggregate'
import { createMemoryDb } from '../helpers/memory-db'

type SeedRow = Record<string, unknown>

const TABLES = [
  'projects',
  'suppliers',
  'invoices',
  'construction_contracts',
  'supplement_agreements',
  'owner_change_orders',
  'invoice_applications',
  'receipt_registrations',
  'payment_applications',
  'current_receipts',
  'current_payments',
] as const

async function insertSeed(db: TestDb, table: string) {
  const url = new URL(`../../app/lib/db/seed/${table}.json`, import.meta.url)
  const rows = JSON.parse(readFileSync(url, 'utf-8')) as SeedRow[]
  for (const row of rows) {
    const columns = Object.keys(row)
    await db.execute(
      `INSERT INTO "${table}" (${columns.map(column => `"${column}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      columns.map(column => row[column]),
    )
  }
}

describe('project detail SQL aggregates', () => {
  it('aggregates operation and output invoice values in SQLite', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    for (const table of TABLES)
      await insertSeed(db, table)

    const rows = await loadProjectDetailAggregates(db)
    const p1 = rows.find(row => row.projectId === 'proj_demo_001')!
    expect(p1).toMatchObject({
      mainContractAmount: 32388422,
      supplementAmount: 320000,
      ownerChangeAmount: 120520,
      projectReceipt: 25367027,
      paymentAmount: 4200000,
      currentReceipt: 6100000,
      currentPayment: 5950000,
      outputAmount: 25663629,
      outputTax: 2119015,
    })

    const archived = await loadArchivedInvoiceAggregates(db)
    expect(archived).toEqual([
      { projectId: 'proj_demo_002', inputAmount: 10956.11, inputTax: 1423.89, archivedCount: 1 },
    ])
  })
})
