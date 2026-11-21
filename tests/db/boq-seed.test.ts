import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { seedBoqDemo, seedIfEmpty } from '~/lib/db/seed'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let db: TestDb

beforeEach(async () => {
  db = await createMigratedMemoryDb()
})

afterEach(() => db.close())

describe('boq 演示 seed', () => {
  it('把清单、工程量与排程接到同一施工合同和 boq_line_id', async () => {
    await seedIfEmpty(db)

    const [file] = await db.select<{
      contract_id: string
      parse_status: string
      line_count: number
    }>(`
      SELECT contract_id, parse_status, line_count
      FROM boq_files
      WHERE id = 'boq_file_demo_001'
    `)
    expect(file).toEqual({
      contract_id: 'con_demo_sg01',
      parse_status: 'parsed',
      line_count: 10,
    })

    const [catalog] = await db.select<{
      section_count: number
      trade_count: number
      item_count: number
      traced_count: number
    }>(`
      SELECT
        COUNT(DISTINCT section) AS section_count,
        COUNT(DISTINCT trade) AS trade_count,
        COUNT(DISTINCT item_name) AS item_count,
        SUM(CASE WHEN trace_key <> '' THEN 1 ELSE 0 END) AS traced_count
      FROM boq_lines
      WHERE contract_id = 'con_demo_sg01'
        AND deleted_at IS NULL
    `)
    expect(catalog.section_count).toBeGreaterThan(1)
    expect(catalog.trade_count).toBeGreaterThan(1)
    expect(catalog.item_count).toBeGreaterThan(2)
    expect(catalog.traced_count).toBe(10)

    const linkedTemplateRows = await db.select<{
      template_item_id: string
      boq_line_id: string
      recognized_contract_qty: number
      boq_qty: number
    }>(`
      SELECT
        template_item.id AS template_item_id,
        template_item.boq_line_id,
        template_item.recognized_contract_qty,
        boq.qty AS boq_qty
      FROM house_type_template_items AS template_item
      JOIN boq_lines AS boq ON boq.id = template_item.boq_line_id
      WHERE template_item.boq_line_id IS NOT NULL
        AND template_item.deleted_at IS NULL
      ORDER BY template_item.id
    `)
    expect(linkedTemplateRows).toHaveLength(10)
    expect(linkedTemplateRows.every(row => row.recognized_contract_qty === row.boq_qty)).toBe(true)

    const [scheduleGroup] = await db.select<{ contract_id: string }>(`
      SELECT contract_id
      FROM schedule_groups
      WHERE id = 'schedule_group_demo_001'
    `)
    expect(scheduleGroup.contract_id).toBe('con_demo_sg01')

    const mappedTasks = await db.select<{ boq_line_id: string | null }>(`
      SELECT boq_line_id
      FROM task_item_map
      WHERE deleted_at IS NULL
    `)
    expect(mappedTasks.some(row => row.boq_line_id != null)).toBe(true)
    expect(await db.select<Record<string, unknown>>('PRAGMA foreign_key_check')).toEqual([])
  })

  it('带一份已签证变更、锁定台账和可手调月报量草稿', async () => {
    await seedIfEmpty(db)

    expect(await db.select(`
      SELECT status, total_amount, ledger_id
      FROM boq_change_orders
      WHERE id = 'boq_change_demo_001'
    `)).toEqual([{
      status: 'approved',
      total_amount: 520,
      ledger_id: 'boq_ledger_demo_001',
    }])
    expect(await db.select(`
      SELECT source_type, source_id, source_locked, tax_inc_amount
      FROM owner_change_orders
      WHERE id = 'boq_ledger_demo_001'
    `)).toEqual([{
      source_type: 'boq_change_order',
      source_id: 'boq_change_demo_001',
      source_locked: 1,
      tax_inc_amount: 520,
    }])
    expect(await db.select(`
      SELECT status, total_amount
      FROM monthly_statements
      WHERE id = 'monthly_statement_demo_001'
    `)).toEqual([{
      status: 'draft',
      total_amount: 4960,
    }])
    expect(await db.select(`
      SELECT auto_qty, adjusted_qty, unit_price, amount
      FROM monthly_statement_lines
      WHERE id = 'monthly_statement_line_demo_001'
    `)).toEqual([{
      auto_qty: 60,
      adjusted_qty: 62,
      unit_price: 80,
      amount: 4960,
    }])
  })

  it('重复 seed 不复制清单、自动台账或月报量', async () => {
    await seedIfEmpty(db)
    const before = await db.select<{ table_name: string, total: number }>(`
      SELECT 'boq_lines' AS table_name, COUNT(*) AS total FROM boq_lines
      UNION ALL
      SELECT 'owner_change_orders', COUNT(*) FROM owner_change_orders
      UNION ALL
      SELECT 'monthly_statements', COUNT(*) FROM monthly_statements
      ORDER BY table_name
    `)

    await seedBoqDemo(db)

    expect(await db.select<{ table_name: string, total: number }>(`
      SELECT 'boq_lines' AS table_name, COUNT(*) AS total FROM boq_lines
      UNION ALL
      SELECT 'owner_change_orders', COUNT(*) FROM owner_change_orders
      UNION ALL
      SELECT 'monthly_statements', COUNT(*) FROM monthly_statements
      ORDER BY table_name
    `)).toEqual(before)
  })
})
