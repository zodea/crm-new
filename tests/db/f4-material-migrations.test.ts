import type { MigrationDb } from '~/lib/db/migrations'
import { describe, expect, it } from 'vitest'
import {
  LATEST_VERSION,
  migrations,
  runMigrations,
} from '~/lib/db/migrations'
import { columnNames, createMemoryDb, listTables } from '../helpers/memory-db'

const F4_MIGRATION_VERSION = 23

async function createPreF4Db() {
  const db = await createMemoryDb()
  await runMigrations(
    db,
    migrations.filter(migration => migration.version < F4_MIGRATION_VERSION),
  )
  return db
}

async function seedReferences(db: MigrationDb) {
  await db.execute(`
    INSERT INTO customers (id, name)
    VALUES ('customer-f4', '甲供单位')
  `)
  await db.execute(`
    INSERT INTO projects (id, name, customer_id)
    VALUES ('project-f4', 'F4 项目', 'customer-f4')
  `)
  await db.execute(`
    INSERT INTO suppliers (id, name)
    VALUES ('supplier-f4', '材料分供方')
  `)
  await db.execute(`
    INSERT INTO crews (id, name)
    VALUES ('crew-f4', '领料班组')
  `)
  await db.execute(`
    INSERT INTO contracts (
      id, no, name, kind, project_id, supplier_id, status
    )
    VALUES (
      'contract-f4', 'CG-F4', 'F4 材料采购合同', '材采',
      'project-f4', 'supplier-f4', '生效中'
    )
  `)
}

describe('v23 F4 物资表单与库存事实迁移', () => {
  it('冷启动建立物资头表、子表、真实外键和索引', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)

    expect(LATEST_VERSION).toBe(F4_MIGRATION_VERSION)
    const tables = await listTables(db)
    for (const table of [
      'material_requisitions',
      'material_arrivals',
      'material_arrival_lines',
      'material_uses',
      'stock_checks',
      'stock_check_lines',
      'owner_material_controls',
      'owner_material_requisitions',
      'owner_material_arrivals',
      'owner_material_uses',
      'owner_material_directs',
    ]) {
      expect(tables).toContain(table)
    }

    expect(await columnNames(db, 'material_requisitions')).toEqual(expect.arrayContaining([
      'project_id',
      'contract_id',
      'planned_qty',
      'status',
      'deleted_at',
    ]))
    expect(await columnNames(db, 'material_arrival_lines')).toEqual(expect.arrayContaining([
      'arrival_id',
      'material_name',
      'qty',
      'unit_price',
      'deleted_at',
    ]))
    expect(await columnNames(db, 'stock_check_lines')).toEqual(expect.arrayContaining([
      'stock_check_id',
      'book_qty',
      'actual_qty',
      'variance_amount',
    ]))

    const arrivalForeignKeys = await db.select<{ table: string, from: string }>(
      `PRAGMA foreign_key_list('material_arrivals')`,
    )
    expect(arrivalForeignKeys).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'projects', from: 'project_id' }),
      expect.objectContaining({ table: 'suppliers', from: 'supplier_id' }),
      expect.objectContaining({ table: 'contracts', from: 'contract_id' }),
      expect.objectContaining({
        table: 'material_requisitions',
        from: 'requisition_id',
      }),
    ]))
    const ownerControlForeignKeys = await db.select<{ table: string, from: string }>(
      `PRAGMA foreign_key_list('owner_material_controls')`,
    )
    expect(ownerControlForeignKeys).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'projects', from: 'project_id' }),
      expect.objectContaining({ table: 'customers', from: 'customer_id' }),
    ]))

    const indexes = await db.select<{ name: string }>(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND name LIKE 'idx_%material%'
      ORDER BY name
    `)
    expect(indexes.map(index => index.name)).toEqual(expect.arrayContaining([
      'idx_material_arrival_lines_head',
      'idx_material_arrivals_requisition',
      'idx_material_requisitions_project',
      'idx_owner_material_controls_project',
      'idx_owner_material_directs_project',
    ]))
    expect(await db.select('PRAGMA foreign_key_check')).toEqual([])
    db.close()
  })

  it('从 v22 升级只新增 F4 事实表且可幂等重跑', async () => {
    const db = await createPreF4Db()
    await seedReferences(db)
    await db.execute(`
      INSERT INTO delivery_records (
        id, project_id, supplier_id, order_no, archived
      )
      VALUES (
        'delivery-before-f4', 'project-f4', 'supplier-f4', 'SH-F4', 1
      )
    `)
    await db.execute(`
      INSERT INTO expenditure_settlements (
        id, no, name, biz_type, project_id, supplier_id, contract_id,
        total_amount, status
      )
      VALUES (
        'settlement-before-f4', 'JS-F4', '迁移前材料结算', '材料',
        'project-f4', 'supplier-f4', 'contract-f4', 100, 'draft'
      )
    `)

    const result = await runMigrations(db)
    expect(result.applied).toEqual(['v23 f4-material-forms-inventory-facts'])
    expect(await db.select(`
      SELECT id, order_no FROM delivery_records WHERE id = 'delivery-before-f4'
    `)).toEqual([{ id: 'delivery-before-f4', order_no: 'SH-F4' }])
    expect(await db.select(`
      SELECT id, contract_id FROM expenditure_settlements
      WHERE id = 'settlement-before-f4'
    `)).toEqual([{
      id: 'settlement-before-f4',
      contract_id: 'contract-f4',
    }])
    expect((await runMigrations(db)).applied).toEqual([])
    expect(await db.select('PRAGMA foreign_key_check')).toEqual([])
    db.close()
  })

  it('数据库拒绝负计划量、非正到货行和负盘点数量', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    await seedReferences(db)

    await expect(db.execute(`
      INSERT INTO material_requisitions (
        id, project_id, contract_id, material_name, planned_qty
      )
      VALUES (
        'bad-requisition', 'project-f4', 'contract-f4', '瓷砖', -1
      )
    `)).rejects.toThrow()

    await db.execute(`
      INSERT INTO material_arrivals (
        id, project_id, supplier_id, contract_id, status
      )
      VALUES (
        'arrival-f4', 'project-f4', 'supplier-f4', 'contract-f4', 'draft'
      )
    `)
    await expect(db.execute(`
      INSERT INTO material_arrival_lines (
        id, arrival_id, material_name, qty
      )
      VALUES ('bad-arrival-line', 'arrival-f4', '瓷砖', 0)
    `)).rejects.toThrow()

    await db.execute(`
      INSERT INTO stock_checks (id, warehouse, checker)
      VALUES ('stock-check-f4', '项目仓', '仓管')
    `)
    await expect(db.execute(`
      INSERT INTO stock_check_lines (
        id, stock_check_id, material_name, actual_qty
      )
      VALUES ('bad-stock-line', 'stock-check-f4', '瓷砖', -1)
    `)).rejects.toThrow()

    await expect(db.execute(`
      INSERT INTO owner_material_directs (
        id, project_id, customer_id, material_name, qty
      )
      VALUES (
        'bad-owner-direct', 'project-f4', 'customer-f4', '电梯', -1
      )
    `)).rejects.toThrow()
    db.close()
  })
})
