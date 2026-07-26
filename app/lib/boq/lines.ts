import type { SoftDb } from '~/lib/db/soft-delete'
import { withUpdateLog } from '~/lib/db/soft-delete'
import { round2 } from '~/lib/util/number'

export interface BoqLinePatch {
  itemId?: string | null
  section?: string
  trade?: string
  itemName?: string
  unit?: string
  qty?: number
  unitPrice?: number
  building?: string
  unitType?: string
  multiplier?: number | null
  room?: string
  floorZone?: string
  spec?: string
  taxRate?: number | null
  ownerSupplied?: boolean
}

interface EditableLineRow {
  id: string
  boq_file_id: string | null
  change_order_id: string | null
  item_id: string | null
  section: string
  trade: string
  item_name: string
  unit: string
  qty: number | null
  unit_price: number | null
  building: string
  unit_type: string
  multiplier: number | null
  room: string
  floor_zone: string
  spec: string
  tax_rate: number | null
  owner_supplied: number
}

function finiteNumber(value: number, label: string): number {
  if (!Number.isFinite(value))
    throw new Error(`${label}必须是有效数字`)
  return value
}

export async function persistBoqLinePatch(
  db: SoftDb,
  lineId: string,
  patch: BoqLinePatch,
): Promise<string | null> {
  const [current] = await db.select<EditableLineRow>(
    `SELECT id, boq_file_id, change_order_id, item_id, section, trade, item_name, unit,
            qty, unit_price, building, unit_type, multiplier, room, floor_zone, spec,
            tax_rate, owner_supplied
     FROM boq_lines
     WHERE id = ? AND deleted_at IS NULL`,
    [lineId],
  )
  if (!current)
    throw new Error('清单行不存在或已删除')
  if (!current.boq_file_id || current.change_order_id)
    throw new Error('已签证变更新增行不可直接修改')

  const qty = patch.qty == null ? Number(current.qty ?? 0) : finiteNumber(patch.qty, '工程量')
  const unitPrice = patch.unitPrice == null
    ? Number(current.unit_price ?? 0)
    : finiteNumber(patch.unitPrice, '合同单价')
  if (qty < 0 || unitPrice < 0)
    throw new Error('工程量与合同单价不能为负数')

  const next = {
    itemId: patch.itemId === undefined ? current.item_id : patch.itemId,
    section: patch.section === undefined ? current.section : patch.section.trim(),
    trade: patch.trade === undefined ? current.trade : patch.trade.trim(),
    itemName: patch.itemName === undefined ? current.item_name : patch.itemName.trim(),
    unit: patch.unit === undefined ? current.unit : patch.unit.trim(),
    qty,
    unitPrice,
    building: patch.building === undefined ? current.building : patch.building.trim(),
    unitType: patch.unitType === undefined ? current.unit_type : patch.unitType.trim(),
    multiplier: patch.multiplier === undefined ? current.multiplier : patch.multiplier,
    room: patch.room === undefined ? current.room : patch.room.trim(),
    floorZone: patch.floorZone === undefined ? current.floor_zone : patch.floorZone.trim(),
    spec: patch.spec === undefined ? current.spec : patch.spec.trim(),
    taxRate: patch.taxRate === undefined ? current.tax_rate : patch.taxRate,
    ownerSupplied: patch.ownerSupplied === undefined
      ? current.owner_supplied
      : Number(patch.ownerSupplied),
  }
  if (!next.itemName)
    throw new Error('分项名称必填')
  if (next.multiplier != null)
    finiteNumber(next.multiplier, '套数')
  if (next.taxRate != null)
    finiteNumber(next.taxRate, '税率')

  return withUpdateLog(db, 'boq_lines', lineId, () => db.execute(
    `UPDATE boq_lines
     SET item_id = ?,
         section = ?,
         trade = ?,
         item_name = ?,
         unit = ?,
         qty = ?,
         unit_price = ?,
         amount = ?,
         building = ?,
         unit_type = ?,
         multiplier = ?,
         room = ?,
         floor_zone = ?,
         spec = ?,
         tax_rate = ?,
         owner_supplied = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
    [
      next.itemId,
      next.section,
      next.trade,
      next.itemName,
      next.unit,
      next.qty,
      next.unitPrice,
      round2(next.qty * next.unitPrice),
      next.building,
      next.unitType,
      next.multiplier,
      next.room,
      next.floorZone,
      next.spec,
      next.taxRate,
      next.ownerSupplied,
      lineId,
    ],
  ))
}
