import type { MigrationDb } from '~/lib/db/migrations'
import { describe, expect, it } from 'vitest'
import {
  migrations,
  runMigrations,
} from '~/lib/db/migrations'
import { columnNames, createMemoryDb, listTables } from '../helpers/memory-db'

const F2_MIGRATION_VERSION = 21

async function createPreF2Db() {
  const db = await createMemoryDb()
  await runMigrations(
    db,
    migrations.filter(migration => migration.version < F2_MIGRATION_VERSION),
  )
  return db
}

async function seedF2References(db: MigrationDb) {
  await db.execute(`
    INSERT INTO customers (id, name)
    VALUES ('customer-f2', '甲方客户')
  `)
  await db.execute(`
    INSERT INTO projects (id, name, customer_id)
    VALUES ('project-f2', 'F2 项目', 'customer-f2')
  `)
  await db.execute(`
    INSERT INTO suppliers (id, name)
    VALUES ('supplier-f2', 'F2 分供方')
  `)
}

describe('v21 F2 canonical 合同与支出结算迁移', () => {
  it('冷启动建立 F2 目标表、列、外键和索引', async () => {
    const db = await createMemoryDb()
    await runMigrations(
      db,
      migrations.filter(migration => migration.version <= F2_MIGRATION_VERSION),
    )

    expect(Math.max(...migrations
      .filter(migration => migration.version <= F2_MIGRATION_VERSION)
      .map(migration => migration.version))).toBe(F2_MIGRATION_VERSION)
    const tables = await listTables(db)
    for (const table of [
      'contract_legacy_mappings',
      'contract_supplements',
      'contract_line_items',
      'company_expense_contracts',
      'expenditure_settlements',
    ]) {
      expect(tables).toContain(table)
    }

    for (const column of [
      'customer_id',
      'content',
      'invoice_type',
      'contact_name',
      'main_terms',
      'payment_terms',
      'retention_ratio',
      'invoice_tax_no',
      'other_expense_kind',
      'service_period',
      'payment_cycle',
    ]) {
      expect(await columnNames(db, 'contracts')).toContain(column)
    }
    expect(await columnNames(db, 'contract_line_items')).toEqual(expect.arrayContaining([
      'material_name',
      'qty',
      'tax_inclusive_unit_price',
      'planned_arrival_date',
      'updated_at',
      'deleted_at',
    ]))
    expect(await columnNames(db, 'expenditure_settlements')).toEqual(expect.arrayContaining([
      'project_id',
      'supplier_id',
      'contract_id',
      'settlement_period',
      'deduction_note',
      'deleted_at',
    ]))

    const indexes = (await db.select<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'index'`,
    )).map(row => row.name)
    for (const index of [
      'uq_contract_legacy_source',
      'idx_contract_supplements_contract',
      'idx_contract_line_items_contract',
      'idx_company_expense_contracts_deleted',
      'idx_expenditure_settlements_contract',
    ]) {
      expect(indexes).toContain(index)
    }

    const contractLineForeignKeys = await db.select<{ table: string, from: string }>(
      `PRAGMA foreign_key_list('contract_line_items')`,
    )
    expect(contractLineForeignKeys).toContainEqual(expect.objectContaining({
      table: 'contracts',
      from: 'contract_id',
    }))
    db.close()
  })

  it('把旧施工/支出合同映射到 canonical ID，并迁移补充协议、材采行和付款引用', async () => {
    const db = await createPreF2Db()
    await seedF2References(db)
    await db.execute(`
      INSERT INTO contracts (
        id, no, name, kind, project_id, amount, changed, sign_date
      )
      VALUES (
        'contract-canonical-con', 'CON-001', '既有施工合同', '施工',
        'project-f2', 1000, 1000, '2026-01-01'
      )
    `)
    await db.execute(`
      INSERT INTO contracts (
        id, no, name, kind, project_id, supplier_id, amount, changed, sign_date
      )
      VALUES (
        'contract-canonical-material', 'MAT-001', '瓷砖采购合同', '材采',
        'project-f2', 'supplier-f2', 238, 238, '2026-03-01'
      )
    `)
    await db.execute(`
      INSERT INTO construction_contracts (
        id, project_id, name, contract_no, amount, status, sign_date, tax_rate
      )
      VALUES (
        'legacy-con', 'project-f2', '既有施工合同', 'CON-001',
        1000, '履约中', '2026-01-01', 9
      )
    `)
    await db.execute(`
      INSERT INTO supplement_agreements (
        id, contract_id, name, amount, sign_date
      )
      VALUES (
        'legacy-supplement', 'legacy-con', '施工补充协议', 88, '2026-02-01'
      )
    `)
    await db.execute(`
      INSERT INTO expenditure_contracts (
        id, project_id, supplier_id, name, contract_no, approval_status,
        tax_inc_total, effective_date, contract_type, tax_rate, payment_method
      )
      VALUES (
        'legacy-material', 'project-f2', 'supplier-f2', '瓷砖采购合同', 'MAT-001',
        '已签订', 238, '2026-03-01', '材料采购', 13, '月结'
      )
    `)
    await db.execute(`
      INSERT INTO contract_line_items (
        id, contract_id, item_name, spec, brand, unit, unit_price,
        quantity, tax_amount, sort_order
      )
      VALUES (
        'legacy-line', 'legacy-material', '瓷砖', '600×600', '示例品牌',
        '㎡', 23.8, 10, 27.38, 1
      )
    `)
    await db.execute(`
      INSERT INTO payment_applications (
        id, project_id, supplier_id, contract_id, application_no, name, amount
      )
      VALUES (
        'legacy-payment-application', 'project-f2', 'supplier-f2',
        'legacy-material', 'PAY-001', '材料付款申请', 100
      )
    `)
    await db.execute(`
      INSERT INTO invoices (id, invoice_number, contract_id)
      VALUES ('legacy-invoice', 'INV-001', 'legacy-material')
    `)

    const result = await runMigrations(
      db,
      migrations.filter(migration => migration.version <= F2_MIGRATION_VERSION),
    )
    expect(result.applied).toEqual(['v21 f2-canonical-contracts-settlements'])

    const mappings = await db.select<{
      source_table: string
      legacy_id: string
      contract_id: string
    }>(`
      SELECT source_table, legacy_id, contract_id
      FROM contract_legacy_mappings
      ORDER BY source_table, legacy_id
    `)
    expect(mappings).toEqual([
      {
        source_table: 'construction_contracts',
        legacy_id: 'legacy-con',
        contract_id: 'contract-canonical-con',
      },
      {
        source_table: 'expenditure_contracts',
        legacy_id: 'legacy-material',
        contract_id: 'contract-canonical-material',
      },
    ])

    expect(await db.select(`
      SELECT id, customer_id, tax_rate
      FROM contracts
      WHERE id = 'contract-canonical-con'
    `)).toEqual([{
      id: 'contract-canonical-con',
      customer_id: 'customer-f2',
      tax_rate: 9,
    }])
    expect(await db.select(`
      SELECT id, kind, cost_category, project_id, supplier_id, payment_cycle
      FROM contracts
      WHERE id = 'contract-canonical-material'
    `)).toEqual([{
      id: 'contract-canonical-material',
      kind: '材采',
      cost_category: '材料',
      project_id: 'project-f2',
      supplier_id: 'supplier-f2',
      payment_cycle: '月结',
    }])
    expect(await db.select(`
      SELECT id, contract_id, name, amount
      FROM contract_supplements
    `)).toEqual([{
      id: 'legacy-supplement',
      contract_id: 'contract-canonical-con',
      name: '施工补充协议',
      amount: 88,
    }])
    expect(await db.select(`
      SELECT id, contract_id, material_name, qty, tax_inclusive_unit_price
      FROM contract_line_items
    `)).toEqual([{
      id: 'legacy-line',
      contract_id: 'contract-canonical-material',
      material_name: '瓷砖',
      qty: 10,
      tax_inclusive_unit_price: 23.8,
    }])
    expect(await db.select(`
      SELECT contract_id
      FROM payment_applications
      WHERE id = 'legacy-payment-application'
    `)).toEqual([{ contract_id: 'contract-canonical-material' }])
    expect(await db.select(`
      SELECT contract_id
      FROM invoices
      WHERE id = 'legacy-invoice'
    `)).toEqual([{ contract_id: 'contract-canonical-material' }])
    expect(await db.select('PRAGMA foreign_key_check')).toEqual([])
    db.close()
  })

  it('补充协议只生成 canonical 子记录，公司支出不需要项目占位', async () => {
    const db = await createPreF2Db()
    await seedF2References(db)
    await db.execute(`
      INSERT INTO construction_contracts (
        id, project_id, name, contract_no, amount
      )
      VALUES ('legacy-only-con', 'project-f2', '旧施工合同', 'CON-ONLY', 500)
    `)
    await db.execute(`
      INSERT INTO supplement_agreements (
        id, contract_id, name, amount
      )
      VALUES ('legacy-only-supplement', 'legacy-only-con', '唯一补充协议', 50)
    `)

    await runMigrations(db)

    const [contractCount] = await db.select<{ total: number }>(`
      SELECT COUNT(*) AS total
      FROM contracts
      WHERE no = 'CON-ONLY'
    `)
    expect(contractCount.total).toBe(1)
    expect(await db.select(`
      SELECT supplement.name, contract.no
      FROM contract_supplements AS supplement
      JOIN contracts AS contract ON contract.id = supplement.contract_id
      WHERE supplement.id = 'legacy-only-supplement'
    `)).toEqual([{
      name: '唯一补充协议',
      no: 'CON-ONLY',
    }])

    await db.execute(`
      INSERT INTO company_expense_contracts (
        id, no, name, category, counterparty, amount
      )
      VALUES ('company-expense', 'COMP-001', '办公软件合同', '软件', '软件服务商', 99)
    `)
    expect(await columnNames(db, 'company_expense_contracts')).not.toContain('project_id')
    expect(await db.select(`
      SELECT id, name FROM company_expense_contracts WHERE id = 'company-expense'
    `)).toEqual([{ id: 'company-expense', name: '办公软件合同' }])
    db.close()
  })

  it('同 ID 或同名但事实不一致时不静默错配，并重写 BOQ 与进度引用', async () => {
    const db = await createPreF2Db()
    await seedF2References(db)
    await db.execute(`
      INSERT INTO contracts (
        id, no, name, kind, project_id, amount, changed, sign_date
      )
      VALUES (
        'legacy-conflict', 'CON-CONFLICT', '无关既有合同', '施工',
        'project-f2', 999, 999, '2025-01-01'
      )
    `)
    await db.execute(`
      INSERT INTO construction_contracts (
        id, project_id, name, contract_no, amount, sign_date
      )
      VALUES (
        'legacy-conflict', 'project-f2', '待迁移施工合同',
        'CON-CONFLICT', 100, '2026-01-01'
      )
    `)
    await db.execute(`
      INSERT INTO boq_files (id, contract_id, file_name)
      VALUES ('boq-conflict', 'legacy-conflict', '清单.xlsx')
    `)
    await db.execute(`
      INSERT INTO schedule_groups (id, project_id, contract_id, name)
      VALUES ('schedule-conflict', 'project-f2', 'legacy-conflict', '进度组')
    `)

    await runMigrations(db)

    const [mapping] = await db.select<{ contract_id: string }>(`
      SELECT contract_id
      FROM contract_legacy_mappings
      WHERE source_table = 'construction_contracts'
        AND legacy_id = 'legacy-conflict'
    `)
    expect(mapping.contract_id).not.toBe('legacy-conflict')
    expect(await db.select(`
      SELECT name, amount, sign_date
      FROM contracts
      WHERE id = ?
    `, [mapping.contract_id])).toEqual([{
      name: '待迁移施工合同',
      amount: 100,
      sign_date: '2026-01-01',
    }])
    expect(await db.select(`
      SELECT entity_id, attribution
      FROM reconciliation_issues
      WHERE import_batch_id = 'migration_f2_v21'
        AND entity_id = 'legacy-conflict'
    `)).toEqual([{
      entity_id: 'legacy-conflict',
      attribution: 'mapping',
    }])
    expect(await db.select(`
      SELECT contract_id FROM boq_files WHERE id = 'boq-conflict'
    `)).toEqual([{ contract_id: mapping.contract_id }])
    expect(await db.select(`
      SELECT contract_id FROM schedule_groups WHERE id = 'schedule-conflict'
    `)).toEqual([{ contract_id: mapping.contract_id }])
    expect(await db.select('PRAGMA foreign_key_check')).toEqual([])
    db.close()
  })

  it('迁移直接重跑保持 canonical 映射、补充协议和明细幂等', async () => {
    const db = await createPreF2Db()
    await seedF2References(db)
    await db.execute(`
      INSERT INTO expenditure_contracts (
        id, project_id, supplier_id, name, contract_no, tax_inc_total, contract_type
      )
      VALUES (
        'legacy-retry', 'project-f2', 'supplier-f2',
        '重跑材料合同', 'MAT-RETRY', 100, '材料采购'
      )
    `)
    await db.execute(`
      INSERT INTO contract_line_items (
        id, contract_id, item_name, quantity, unit_price
      )
      VALUES ('legacy-retry-line', 'legacy-retry', '重跑材料', 2, 50)
    `)
    const migration = migrations.find(item => item.version === F2_MIGRATION_VERSION)
    expect(migration).toBeDefined()

    await migration!.up(db)
    await migration!.up(db)

    expect(await db.select(`
      SELECT COUNT(*) AS total
      FROM contract_legacy_mappings
      WHERE source_table = 'expenditure_contracts' AND legacy_id = 'legacy-retry'
    `)).toEqual([{ total: 1 }])
    expect(await db.select(`
      SELECT COUNT(*) AS total
      FROM contracts
      WHERE no = 'MAT-RETRY'
    `)).toEqual([{ total: 1 }])
    expect(await db.select(`
      SELECT COUNT(*) AS total
      FROM contract_line_items
      WHERE id = 'legacy-retry-line'
    `)).toEqual([{ total: 1 }])
    db.close()
  })
})
