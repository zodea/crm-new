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
  'customers',
  'projects',
  'suppliers',
  'contracts',
  'contract_supplements',
  'invoices',
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

  it('uses canonical contracts and supplements after F2 stops legacy writes', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    await db.execute(`INSERT INTO customers (id, name) VALUES ('customer-canonical', 'canonical 客户')`)
    await db.execute(`
      INSERT INTO projects (id, name, customer_id)
      VALUES ('project-canonical', 'canonical 项目', 'customer-canonical')
    `)
    await db.execute(`
      INSERT INTO contracts (
        id, no, name, kind, project_id, customer_id, amount, status
      )
      VALUES (
        'contract-canonical', 'SG-CANONICAL', 'canonical 施工合同', '施工',
        'project-canonical', 'customer-canonical', 100, '履约中'
      )
    `)
    await db.execute(`
      INSERT INTO contract_supplements (
        id, contract_id, name, amount, status
      )
      VALUES (
        'supplement-canonical', 'contract-canonical', 'canonical 补充协议', 25, '有效'
      )
    `)
    await db.execute(`
      INSERT INTO construction_contracts (
        id, project_id, name, amount
      )
      VALUES (
        'contract-legacy-after-stop', 'project-canonical', '停写后的旧合同', 900
      )
    `)
    await db.execute(`
      INSERT INTO supplement_agreements (
        id, contract_id, name, amount
      )
      VALUES (
        'supplement-legacy-after-stop', 'contract-legacy-after-stop', '停写后的旧补充协议', 75
      )
    `)

    const [aggregate] = await loadProjectDetailAggregates(db)
    expect(aggregate).toMatchObject({
      projectId: 'project-canonical',
      mainContractAmount: 100,
      supplementAmount: 25,
      changedContractAmount: 125,
    })
  })
})
