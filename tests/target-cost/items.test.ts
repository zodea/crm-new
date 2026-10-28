import { describe, expect, it } from 'vitest'
import { persistTargetCostItems } from '~/lib/target-cost/items'
import { createMigratedMemoryDb } from '../helpers/memory-db'

describe('target cost item persistence', () => {
  it('updates, inserts, soft-deletes and reorders one version in one write unit', async () => {
    const db = await createMigratedMemoryDb()
    await db.execute(`
      INSERT INTO target_costs (id, name, status)
      VALUES ('target-items', '目标成本科目测试', 'draft')
    `)
    await db.execute(`
      INSERT INTO target_cost_items (
        id, target_cost_id, cost_category, item_name, unit, qty, unit_price,
        amount, note, sort_order
      )
      VALUES
        ('item-keep', 'target-items', '材料', '旧材料', '项', 1, 100, 100, '', 10),
        ('item-remove', 'target-items', '机械', '待删除机械', '台', 1, 50, 50, '', 20)
    `)

    await persistTargetCostItems(db, 'target-items', [
      {
        category: '专业分包',
        itemName: '新增分包',
        unit: '项',
        qty: 1,
        unitPrice: 300,
        amount: 300,
        note: '首行',
      },
      {
        id: 'item-keep',
        category: '材料',
        itemName: '更新材料',
        unit: '项',
        qty: 2,
        unitPrice: 60,
        amount: 120,
        note: '次行',
      },
    ])

    const rows = await db.select<Record<string, unknown>>(`
      SELECT id, cost_category, item_name, amount, sort_order, deleted_at
      FROM target_cost_items
      WHERE target_cost_id = 'target-items'
      ORDER BY sort_order, id
    `)
    const active = rows.filter(row => row.deleted_at == null)
    expect(active).toHaveLength(2)
    expect(active.map(row => ({
      category: row.cost_category,
      name: row.item_name,
      amount: row.amount,
      sortOrder: row.sort_order,
    }))).toEqual([
      { category: '专业分包', name: '新增分包', amount: 300, sortOrder: 0 },
      { category: '材料', name: '更新材料', amount: 120, sortOrder: 1 },
    ])
    expect(rows.find(row => row.id === 'item-remove')?.deleted_at).toBeTruthy()

    const logs = await db.select<{ action: string }>(`
      SELECT action
      FROM operation_logs
      WHERE table_name = 'target_cost_items'
      ORDER BY created_at, id
    `)
    expect(logs.map(row => row.action).sort()).toEqual(['create', 'delete', 'update'])
  })

  it('rejects invalid values and ids owned by another target before changing rows', async () => {
    const db = await createMigratedMemoryDb()
    await db.execute(`
      INSERT INTO target_costs (id, name, status)
      VALUES ('target-a', 'A', 'draft'), ('target-b', 'B', 'draft')
    `)
    await db.execute(`
      INSERT INTO target_cost_items (
        id, target_cost_id, cost_category, item_name, amount, sort_order
      )
      VALUES
        ('item-a', 'target-a', '材料', 'A材料', 10, 0),
        ('item-b', 'target-b', '材料', 'B材料', 20, 0)
    `)

    await expect(persistTargetCostItems(db, 'target-a', [{
      id: 'item-b',
      category: '材料',
      itemName: '越权修改',
      amount: 99,
    }])).rejects.toThrow('不属于当前版本')
    await expect(persistTargetCostItems(db, 'target-a', [{
      id: 'item-a',
      category: '材料',
      itemName: '金额非法',
      amount: -1,
    }])).rejects.toThrow('必须是非负数')

    const rows = await db.select<{ id: string, item_name: string, amount: number, deleted_at: string | null }>(`
      SELECT id, item_name, amount, deleted_at
      FROM target_cost_items
      ORDER BY id
    `)
    expect(rows).toEqual([
      { id: 'item-a', item_name: 'A材料', amount: 10, deleted_at: null },
      { id: 'item-b', item_name: 'B材料', amount: 20, deleted_at: null },
    ])
  })
})
