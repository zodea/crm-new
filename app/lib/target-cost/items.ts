import type { TransactionDb } from '~/lib/db/coordinator'
import type { CostCategory } from '~/lib/project/cost-control'
import { withTransaction } from '~/lib/db/connection'
import { logCreate, selectVisibleSql, softDelete, withUpdateLog } from '~/lib/db/soft-delete'
import { COST_CATEGORIES } from '~/lib/project/cost-control'
import { generateId } from '~/lib/util/id'
import { round2 } from '~/lib/util/number'

export interface TargetCostItemDraft extends Record<string, unknown> {
  id?: string
  category?: CostCategory | ''
  itemName?: string
  unit?: string
  qty?: number | null
  unitPrice?: number | null
  amount?: number | null
  note?: string
  sortOrder?: number
}
interface NormalizedTargetCostItem {
  id?: string
  category: Exclude<CostCategory, '未分类'>
  itemName: string
  unit: string
  qty: number | null
  unitPrice: number | null
  amount: number
  note: string
  sortOrder: number
}
function nullableNonNegative(label: string, value: unknown): number | null {
  if (value === '' || value == null)
    return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new Error(`${label}必须是非负数`)
  return round2(parsed)
}
export class TargetCostItemValidationError extends Error {
  constructor(message: string, readonly field: string) {
    super(message)
  }
}
export function normalizeTargetCostItems(items: readonly TargetCostItemDraft[]): NormalizedTargetCostItem[] {
  const ids = new Set<string>()
  return items.map((item, index) => {
    const category = String(item.category ?? '').trim()
    if (!COST_CATEGORIES.includes(category as typeof COST_CATEGORIES[number]))
      throw new TargetCostItemValidationError(`第 ${index + 1} 行成本科目无效`, `items.${index}.category`)
    const itemName = String(item.itemName ?? '').trim()
    if (!itemName)
      throw new TargetCostItemValidationError(`第 ${index + 1} 行分项名称为必填项`, `items.${index}.itemName`)
    const numeric = (key: 'qty' | 'unitPrice' | 'amount', label: string) => {
      try {
        return nullableNonNegative(`第 ${index + 1} 行${label}`, item[key])
      }
      catch (error) {
        throw new TargetCostItemValidationError((error as Error).message, `items.${index}.${key}`)
      }
    }
    const amount = numeric('amount', '目标金额')
    if (amount == null)
      throw new TargetCostItemValidationError(`第 ${index + 1} 行目标金额为必填项`, `items.${index}.amount`)
    const id = item.id?.trim()
    if (id) {
      if (ids.has(id))
        throw new TargetCostItemValidationError(`第 ${index + 1} 行明细重复`, `items.${index}.id`)
      ids.add(id)
    }
    return {
      id,
      category: category as Exclude<CostCategory, '未分类'>,
      itemName,
      unit: String(item.unit ?? '').trim(),
      qty: numeric('qty', '数量'),
      unitPrice: numeric('unitPrice', '单价'),
      amount,
      note: String(item.note ?? ''),
      sortOrder: index,
    }
  })
}
async function assertActiveTargetCost(tx: TransactionDb, targetCostId: string): Promise<void> {
  const rows = await tx.select<{
    id: string
  }>(selectVisibleSql('target_costs', 'AND id = ?'), [targetCostId])
  if (!rows[0])
    throw new Error('目标成本版本不存在或已删除')
}
export async function saveTargetCostItems(targetCostId: string, drafts: readonly TargetCostItemDraft[]): Promise<void> {
  await withTransaction(tx => persistTargetCostItems(tx, targetCostId, drafts))
}
export async function persistTargetCostItems(tx: TransactionDb, targetCostId: string, drafts: readonly TargetCostItemDraft[], operator = ''): Promise<void> {
  const items = normalizeTargetCostItems(drafts)
  await assertActiveTargetCost(tx, targetCostId)
  const existing = await tx.select<{
    id: string
  }>(`
      SELECT id
      FROM target_cost_items
      WHERE target_cost_id = ? AND deleted_at IS NULL
      ORDER BY sort_order, created_at, id
    `, [targetCostId])
  const existingIds = new Set(existing.map(row => row.id))
  for (const item of items) {
    if (item.id && !existingIds.has(item.id))
      throw new TargetCostItemValidationError('科目明细不存在、已删除或不属于当前版本', 'items')
  }
  const incomingIds = new Set(items.flatMap(item => item.id ? [item.id] : []))
  for (const row of existing) {
    if (!incomingIds.has(row.id))
      await softDelete(tx, 'target_cost_items', row.id, operator)
  }
  for (const item of items) {
    const values = [
      item.category,
      item.itemName,
      item.unit,
      item.qty,
      item.unitPrice,
      item.amount,
      item.note,
      item.sortOrder,
      new Date().toISOString(),
    ]
    if (item.id) {
      await withUpdateLog(tx, 'target_cost_items', item.id, () => tx.execute(`
          UPDATE target_cost_items
          SET cost_category = ?, item_name = ?, unit = ?, qty = ?,
              unit_price = ?, amount = ?, note = ?, sort_order = ?, updated_at = ?
          WHERE id = ? AND target_cost_id = ? AND deleted_at IS NULL
        `, [...values, item.id, targetCostId]), operator)
      continue
    }
    const id = generateId('target_cost_item')
    const now = values.at(-1)
    await tx.execute(`
        INSERT INTO target_cost_items (
          id, target_cost_id, cost_category, item_name, unit, qty, unit_price,
          amount, note, sort_order, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [id, targetCostId, ...values.slice(0, -1), now, now])
    await logCreate(tx, 'target_cost_items', id, operator)
  }
}
