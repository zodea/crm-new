import type { BoqChangeOperation, BoqChangeStatus, BoqLineView } from './read-model'
import type { SoftDb } from '~/lib/db/soft-delete'
import { logCreate, withUpdateLog } from '~/lib/db/soft-delete'
import { generateId } from '~/lib/util/id'
import { loadBoqWorkspace } from './read-model'

export type BoqChangeType = 'add' | 'qty' | 'price' | 'mixed'
export type BoqDirectiveType = '' | 'issued' | 'changed' | 'supplemented'

export interface BoqChangeLineDraft {
  operation: BoqChangeOperation
  boqLineId?: string
  itemId?: string | null
  section?: string
  trade?: string
  itemName?: string
  unit?: string
  qty?: number
  deltaQty?: number
  newUnitPrice?: number
  spec?: string
  note?: string
}

export interface CreateBoqChangeOrderDraft {
  projectId: string
  contractId: string
  code: string
  name: string
  changeType?: BoqChangeType
  directiveNo?: string
  directiveType?: BoqDirectiveType
  note?: string
  lines: readonly BoqChangeLineDraft[]
}

export interface CreateBoqChangeOrderResult {
  orderId: string
  logIds: readonly string[]
}

export interface ApproveBoqChangeOrderResult {
  ledgerId: string
  totalAmount: number
  logIds: readonly string[]
}

interface ChangeOrderRow {
  id: string
  project_id: string
  contract_id: string
  code: string
  name: string
  status: BoqChangeStatus
}

interface ChangeLineRow {
  id: string
  boq_line_id: string | null
  result_boq_line_id: string | null
  item_id: string | null
  operation: BoqChangeOperation
  section: string
  trade: string
  item_name: string
  unit: string
  spec: string
  delta_qty: number | null
  new_unit_price: number | null
  note: string
  sort_order: number
}

interface CalculatedLine {
  amount: number
  deltaQty: number | null
  newUnitPrice: number | null
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function requiredFinite(value: number | undefined | null, label: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed))
    throw new Error(`${label}必须是有效数字`)
  return parsed
}

function calculatedLine(
  operation: BoqChangeOperation,
  target: BoqLineView | null,
  deltaQty: number | null | undefined,
  newUnitPrice: number | null | undefined,
): CalculatedLine {
  if (operation === 'add') {
    const qty = requiredFinite(deltaQty, '新增工程量')
    const price = requiredFinite(newUnitPrice, '新增合同单价')
    if (qty <= 0 || price < 0)
      throw new Error('新增工程量必须大于 0，合同单价不能为负数')
    return { amount: money(qty * price), deltaQty: qty, newUnitPrice: price }
  }
  if (!target)
    throw new Error('调量或调价必须指向有效清单行')
  if (operation === 'qty') {
    const delta = requiredFinite(deltaQty, '调整工程量')
    if (delta === 0)
      throw new Error('调整工程量不能为 0')
    if (target.effectiveQty + delta < 0)
      throw new Error('调整后合同工程量不能为负数')
    return {
      amount: money(delta * target.effectiveUnitPrice),
      deltaQty: delta,
      newUnitPrice: null,
    }
  }
  const price = requiredFinite(newUnitPrice, '调整后合同单价')
  if (price < 0)
    throw new Error('调整后合同单价不能为负数')
  if (price === target.effectiveUnitPrice)
    throw new Error('调整后合同单价没有变化')
  return {
    amount: money(target.effectiveQty * (price - target.effectiveUnitPrice)),
    deltaQty: null,
    newUnitPrice: price,
  }
}

function derivedChangeType(lines: readonly Pick<BoqChangeLineDraft, 'operation'>[]): BoqChangeType {
  const operations = new Set(lines.map(line => line.operation))
  return operations.size === 1 ? [...operations][0]! : 'mixed'
}

async function activeOrder(db: SoftDb, orderId: string): Promise<ChangeOrderRow> {
  const [order] = await db.select<ChangeOrderRow>(
    `SELECT id, project_id, contract_id, code, name, status
     FROM boq_change_orders
     WHERE id = ? AND deleted_at IS NULL`,
    [orderId],
  )
  if (!order)
    throw new Error('变更单不存在或已删除')
  return order
}

export async function createBoqChangeOrder(
  db: SoftDb,
  draft: CreateBoqChangeOrderDraft,
): Promise<CreateBoqChangeOrderResult> {
  const code = draft.code.trim()
  const name = draft.name.trim()
  if (!draft.projectId || !draft.contractId || !code || !name)
    throw new Error('项目、施工合同、变更编号与名称必填')
  if (!draft.lines.length)
    throw new Error('变更单至少需要一条明细')

  const workspace = await loadBoqWorkspace(db, draft.projectId, draft.contractId)
  if (!workspace)
    throw new Error('施工合同不存在、已删除或不属于所选项目')
  const lineById = new Map(workspace.lines.map(line => [line.id, line]))
  const normalized = draft.lines.map((line) => {
    const target = line.boqLineId ? lineById.get(line.boqLineId) ?? null : null
    if (line.operation !== 'add' && !target)
      throw new Error('调量或调价明细包含无效清单行')
    const calculation = calculatedLine(
      line.operation,
      target,
      line.operation === 'add' ? line.qty : line.deltaQty,
      line.newUnitPrice,
    )
    const itemName = (line.itemName ?? target?.itemName ?? '').trim()
    if (!itemName)
      throw new Error('分项名称必填')
    return {
      ...line,
      target,
      itemName,
      itemId: line.itemId === undefined ? target?.itemId ?? null : line.itemId,
      section: (line.section ?? target?.section ?? '').trim(),
      trade: (line.trade ?? target?.trade ?? '').trim(),
      unit: (line.unit ?? target?.unit ?? '').trim(),
      spec: (line.spec ?? target?.spec ?? '').trim(),
      calculation,
    }
  })
  const changeType = derivedChangeType(normalized)
  if (draft.changeType && draft.changeType !== changeType)
    throw new Error('变更单主类型与明细操作不一致')
  const orderId = generateId('boq_change')
  const totalAmount = money(normalized.reduce((total, line) => total + line.calculation.amount, 0))
  const logIds: string[] = []
  await db.execute(
    `INSERT INTO boq_change_orders
      (id, project_id, contract_id, code, name, change_type, status, directive_no,
       directive_type, total_amount, note)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
    [
      orderId,
      draft.projectId,
      draft.contractId,
      code,
      name,
      changeType,
      draft.directiveNo?.trim() ?? '',
      draft.directiveType ?? '',
      totalAmount,
      draft.note?.trim() ?? '',
    ],
  )
  const orderLogId = await logCreate(db, 'boq_change_orders', orderId)
  if (orderLogId)
    logIds.push(orderLogId)

  for (const [index, line] of normalized.entries()) {
    const lineId = generateId('boq_change_line')
    await db.execute(
      `INSERT INTO boq_change_lines
        (id, change_order_id, boq_line_id, item_id, operation, section, trade,
         item_name, unit, spec, delta_qty, new_unit_price, amount, note, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        lineId,
        orderId,
        line.target?.id ?? null,
        line.itemId,
        line.operation,
        line.section,
        line.trade,
        line.itemName,
        line.unit,
        line.spec,
        line.calculation.deltaQty,
        line.calculation.newUnitPrice,
        line.calculation.amount,
        line.note?.trim() ?? '',
        (index + 1) * 10,
      ],
    )
    const lineLogId = await logCreate(db, 'boq_change_lines', lineId)
    if (lineLogId)
      logIds.push(lineLogId)
  }
  return { orderId, logIds }
}

export async function transitionBoqChangeOrder(
  db: SoftDb,
  orderId: string,
  target: BoqChangeStatus,
  statusNote = '',
): Promise<string | null> {
  const order = await activeOrder(db, orderId)
  if (order.status === 'approved')
    throw new Error('已签证变更不可逆，修改需走二次确认与新变更')
  if (target === 'approved')
    throw new Error('变更单必须先进入已上报，再执行签证')
  const allowed = (
    (order.status === 'draft' && target === 'submitted')
    || (order.status === 'submitted' && target === 'rejected')
    || (order.status === 'rejected' && target === 'submitted')
  )
  if (!allowed)
    throw new Error(`不允许从 ${order.status} 变更为 ${target}`)
  return withUpdateLog(db, 'boq_change_orders', orderId, () => db.execute(
    `UPDATE boq_change_orders
     SET status = ?, status_note = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [target, statusNote.trim(), orderId],
  ))
}

export async function approveBoqChangeOrder(
  db: SoftDb,
  orderId: string,
  approvedAt: string,
): Promise<ApproveBoqChangeOrderResult> {
  const order = await activeOrder(db, orderId)
  if (order.status === 'approved')
    throw new Error('该变更单已签证')
  if (order.status !== 'submitted')
    throw new Error('只有已上报变更单可以签证')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(approvedAt))
    throw new Error('签证日期格式必须为 yyyy-mm-dd')

  const workspace = await loadBoqWorkspace(db, order.project_id, order.contract_id)
  if (!workspace)
    throw new Error('施工合同不存在或已删除')
  const targetById = new Map(workspace.lines.map(line => [line.id, line]))
  const changeLines = await db.select<ChangeLineRow>(
    `SELECT id, boq_line_id, result_boq_line_id, item_id, operation, section, trade,
            item_name, unit, spec, delta_qty, new_unit_price, note, sort_order
     FROM boq_change_lines
     WHERE change_order_id = ? AND deleted_at IS NULL
     ORDER BY sort_order, id`,
    [orderId],
  )
  if (!changeLines.length)
    throw new Error('变更单没有可签证明细')

  const logIds: string[] = []
  const [orderRow] = await db.select<{ next_order: number }>(
    `SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_order
     FROM boq_lines
     WHERE contract_id = ? AND deleted_at IS NULL`,
    [order.contract_id],
  )
  let nextSortOrder = Number(orderRow?.next_order) || 10
  let totalAmount = 0
  for (const line of changeLines) {
    const target = line.boq_line_id ? targetById.get(line.boq_line_id) ?? null : null
    const calculation = calculatedLine(
      line.operation,
      target,
      line.delta_qty,
      line.new_unit_price,
    )
    totalAmount = money(totalAmount + calculation.amount)
    let resultBoqLineId = line.result_boq_line_id
    if (line.operation === 'add') {
      resultBoqLineId = generateId('boq_line')
      await db.execute(
        `INSERT INTO boq_lines
          (id, boq_file_id, project_id, contract_id, item_id, section, trade, item_name,
           unit, qty, unit_price, amount, trace_key, source_sheet, source_row,
           recognized_qty, recognized_unit_price, spec, change_order_id, sort_order)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', NULL, NULL, NULL, ?, ?, ?)`,
        [
          resultBoqLineId,
          order.project_id,
          order.contract_id,
          line.item_id,
          line.section,
          line.trade,
          line.item_name,
          line.unit,
          calculation.deltaQty,
          calculation.newUnitPrice,
          calculation.amount,
          `变更单·${order.code}·${line.id}`,
          line.spec,
          orderId,
          nextSortOrder,
        ],
      )
      nextSortOrder += 10
      const resultLogId = await logCreate(db, 'boq_lines', resultBoqLineId)
      if (resultLogId)
        logIds.push(resultLogId)
    }
    const lineLogId = await withUpdateLog(db, 'boq_change_lines', line.id, () => db.execute(
      `UPDATE boq_change_lines
       SET result_boq_line_id = ?, amount = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [resultBoqLineId, calculation.amount, line.id],
    ))
    if (lineLogId)
      logIds.push(lineLogId)
  }

  const ledgerId = generateId('owner_change')
  await db.execute(
    `INSERT INTO owner_change_orders
      (id, project_id, change_no, contract_name, tax_inc_amount, tax_exc_amount,
       applied_amount, approval_date, source_type, source_id, source_locked)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'boq_change_order', ?, 1)`,
    [
      ledgerId,
      order.project_id,
      order.code,
      workspace.contractName,
      totalAmount,
      totalAmount,
      totalAmount,
      approvedAt,
      orderId,
    ],
  )
  const ledgerLogId = await logCreate(db, 'owner_change_orders', ledgerId)
  if (ledgerLogId)
    logIds.push(ledgerLogId)

  const orderLogId = await withUpdateLog(db, 'boq_change_orders', orderId, () => db.execute(
    `UPDATE boq_change_orders
     SET status = 'approved',
         status_note = '甲方已签证',
         total_amount = ?,
         approved_at = ?,
         ledger_id = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
    [totalAmount, approvedAt, ledgerId, orderId],
  ))
  if (orderLogId)
    logIds.push(orderLogId)
  return { ledgerId, totalAmount, logIds }
}
