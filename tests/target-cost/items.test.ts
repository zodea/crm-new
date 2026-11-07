import type { TargetCostItemDraft } from '~/lib/target-cost/items'
import { describe, expect, it, onTestFinished } from 'vitest'
import { persistTargetCostItems } from '~/lib/target-cost/items'
import { createMigratedMemoryDb } from '../helpers/memory-db'

describe('target cost item persistence', () => {
  it('updates, inserts, soft-deletes and reorders one version in one write unit', async () => {
    const db = await createMigratedMemoryDb()
    onTestFinished(() => db.close())
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
    onTestFinished(() => db.close())
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

  const invalidLaterRows = [
    { label: '目标金额缺失', item: { category: '材料', itemName: '第二行', amount: null }, field: 'items.1.amount', message: '第 2 行目标金额为必填项' },
    { label: '目标金额为负', item: { category: '材料', itemName: '第二行', amount: -1 }, field: 'items.1.amount', message: '第 2 行目标金额必须是非负数' },
    { label: '数量为负', item: { category: '材料', itemName: '第二行', qty: -1, amount: 0 }, field: 'items.1.qty', message: '第 2 行数量必须是非负数' },
    { label: '单价为负', item: { category: '材料', itemName: '第二行', unitPrice: -1, amount: 0 }, field: 'items.1.unitPrice', message: '第 2 行单价必须是非负数' },
    { label: '重复明细', item: { id: 'item-a', category: '材料', itemName: '第二行', amount: 0 }, field: 'items.1.id', message: '第 2 行明细重复' },
    { label: '其他版本明细', item: { id: 'item-b', category: '材料', itemName: '第二行', amount: 0 }, field: 'items', message: '科目明细不存在、已删除或不属于当前版本' },
  ] satisfies Array<{ label: string, item: TargetCostItemDraft, field: string, message: string }>

  it.each(invalidLaterRows)('后续行$label时整批明细和审计不变', async ({ item, field, message }) => {
    const db = await createMigratedMemoryDb()
    onTestFinished(() => db.close())
    await db.execute(`INSERT INTO target_costs (id, name, status) VALUES ('batch-a', 'A', 'draft'), ('batch-b', 'B', 'draft')`)
    await db.execute(`
      INSERT INTO target_cost_items (id, target_cost_id, cost_category, item_name, amount, sort_order)
      VALUES ('item-a', 'batch-a', '材料', '原明细', 10, 0),
             ('item-omitted', 'batch-a', '机械', '不得删除', 20, 1),
             ('item-b', 'batch-b', '材料', '另一版本', 30, 0)
    `)
    const snapshot = async () => ({
      versions: await db.select('SELECT * FROM target_costs ORDER BY id'),
      items: await db.select('SELECT * FROM target_cost_items ORDER BY id'),
      logs: await db.select('SELECT * FROM operation_logs ORDER BY id'),
    })
    const before = await snapshot()
    const first: TargetCostItemDraft = { id: 'item-a', category: '材料', itemName: '有效更新', amount: 99 }

    await expect(persistTargetCostItems(db, 'batch-a', [first, item], 'synthetic-operator')).rejects.toMatchObject({ field, message })
    expect(await snapshot()).toEqual(before)
  })

  it('接受真实零和空数量、单价，目标金额保留人工确认值', async () => {
    const db = await createMigratedMemoryDb()
    onTestFinished(() => db.close())
    await db.execute(`INSERT INTO target_costs (id, name, status) VALUES ('batch-zero', '零与未知', 'draft')`)

    await persistTargetCostItems(db, 'batch-zero', [
      { category: '材料', itemName: '明确零', qty: 0, unitPrice: 0, amount: 0 },
      { category: '机械', itemName: '人工金额', qty: null, unitPrice: null, amount: 7 },
    ], 'synthetic-operator')

    expect(await db.select(`
      SELECT item_name, qty, unit_price, amount, sort_order
      FROM target_cost_items WHERE target_cost_id = 'batch-zero' AND deleted_at IS NULL
      ORDER BY sort_order
    `)).toEqual([
      { item_name: '明确零', qty: 0, unit_price: 0, amount: 0, sort_order: 0 },
      { item_name: '人工金额', qty: null, unit_price: null, amount: 7, sort_order: 1 },
    ])
    expect(await db.select('SELECT action FROM operation_logs WHERE table_name = ? ORDER BY action', ['target_cost_items']))
      .toEqual([{ action: 'create' }, { action: 'create' }])
  })
})
