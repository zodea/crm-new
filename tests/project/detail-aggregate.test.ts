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
  'current_transactions',
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
    await db.execute(`
      INSERT INTO payment_records (
        id, no, project_id, payee_name, payment_date, amount,
        voucher_no, bank_serial_no, confirmation_status
      )
      VALUES (
        'payment-project-aggregate', 'ZF-AGG', 'proj_demo_001', '项目收款方',
        '2026-06-20', 4200000, 'V-AGG', 'BANK-AGG', 'needs_review'
      )
    `)
    await db.execute(`
      INSERT INTO payment_record_application_allocations (
        id, payment_record_id, payment_application_id, allocated_amount
      )
      VALUES (
        'payment-project-aggregate-allocation',
        'payment-project-aggregate',
        'pa_mz0x1_0',
        4200000
      )
    `)
    await db.execute(`
      UPDATE payment_records
      SET confirmation_status = 'confirmed',
          confirmed_by = '测试财务',
          confirmed_at = '2026-06-20T09:00:00.000Z'
      WHERE id = 'payment-project-aggregate'
    `)

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
      INSERT INTO contracts (
        id, no, name, kind, project_id, customer_id, amount, status
      )
      VALUES (
        'contract-draft', 'SG-DRAFT', '草稿施工合同', '施工',
        'project-canonical', 'customer-canonical', 900, 'draft'
      )
    `)
    await db.execute(`
      INSERT INTO contract_supplements (
        id, contract_id, name, amount, status
      )
      VALUES (
        'supplement-on-draft-contract', 'contract-draft', '草稿合同下的有效协议', 125, '有效'
      )
    `)
    await db.execute(`
      INSERT INTO contract_supplements (
        id, contract_id, name, amount, status
      )
      VALUES (
        'supplement-draft', 'contract-canonical', '草稿补充协议', 75, 'draft'
      )
    `)
    await db.execute(`
      INSERT INTO receipt_registrations (
        id, project_id, no, amount, status
      )
      VALUES (
        'receipt-draft', 'project-canonical', 'SK-DRAFT', 800, 'draft'
      )
    `)
    await db.execute(`
      INSERT INTO invoice_applications (
        id, project_id, no, name, amount, tax_amount, status
      )
      VALUES (
        'invoice-draft', 'project-canonical', 'KP-DRAFT', '草稿开票', 700, 63, 'draft'
      )
    `)
    await db.execute(`
      INSERT INTO owner_change_orders (
        id, project_id, change_no, tax_inc_amount, status
      )
      VALUES (
        'change-submitted', 'project-canonical', 'BG-SUBMITTED', 600, 'submitted'
      )
    `)
    await db.execute(`
      INSERT INTO owner_change_orders (
        id, project_id, change_no, tax_inc_amount, approval_date, status
      )
      VALUES (
        'change-approved', 'project-canonical', 'BG-APPROVED', 50, '2026-07-27', 'approved'
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
      ownerChangeAmount: 50,
      changedContractAmount: 175,
      projectReceipt: 0,
      outputAmount: 0,
      outputTax: 0,
    })

    await db.execute(`UPDATE contracts SET status = '履约中' WHERE id = 'contract-draft'`)
    await db.execute(`UPDATE contract_supplements SET status = '有效' WHERE id = 'supplement-draft'`)
    await db.execute(`UPDATE receipt_registrations SET status = 'submitted' WHERE id = 'receipt-draft'`)
    await db.execute(`UPDATE invoice_applications SET status = '已审核' WHERE id = 'invoice-draft'`)
    await db.execute(`UPDATE owner_change_orders SET status = 'approved' WHERE id = 'change-submitted'`)

    const [afterConfirmation] = await loadProjectDetailAggregates(db)
    expect(afterConfirmation).toMatchObject({
      projectId: 'project-canonical',
      mainContractAmount: 1000,
      supplementAmount: 225,
      ownerChangeAmount: 650,
      changedContractAmount: 1875,
      projectReceipt: 800,
      outputAmount: 700,
      outputTax: 63,
    })

    const deletedAt = '2026-07-27T00:00:00.000Z'
    await db.execute(`UPDATE contracts SET deleted_at = ? WHERE id = 'contract-draft'`, [deletedAt])
    await db.execute(`UPDATE contract_supplements SET deleted_at = ? WHERE id = 'supplement-on-draft-contract'`, [deletedAt])
    await db.execute(`UPDATE contract_supplements SET deleted_at = ? WHERE id = 'supplement-draft'`, [deletedAt])
    await db.execute(`UPDATE receipt_registrations SET deleted_at = ? WHERE id = 'receipt-draft'`, [deletedAt])
    await db.execute(`UPDATE invoice_applications SET deleted_at = ? WHERE id = 'invoice-draft'`, [deletedAt])
    await db.execute(`UPDATE owner_change_orders SET deleted_at = ? WHERE id = 'change-submitted'`, [deletedAt])

    const [afterSoftDelete] = await loadProjectDetailAggregates(db)
    expect(afterSoftDelete).toMatchObject({
      projectId: 'project-canonical',
      mainContractAmount: 100,
      supplementAmount: 25,
      ownerChangeAmount: 50,
      changedContractAmount: 175,
      projectReceipt: 0,
      outputAmount: 0,
      outputTax: 0,
    })
  })
})
