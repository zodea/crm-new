import type { BoqChangeOperation, BoqChangeStatus, BoqLineView } from './read-model'
import type { SoftDb } from '~/lib/db/soft-delete'
import { logCreate, softDelete, withUpdateLog } from '~/lib/db/soft-delete'
import { generateId } from '~/lib/util/id'
import { round2 } from '~/lib/util/number'
import { loadBoqWorkspace } from './read-model'

export type BoqChangeType = 'add' | 'qty' | 'price' | 'mixed'
export type BoqDirectiveType = '' | 'issued' | 'changed' | 'supplemented'
export type BoqDocumentType
  = | 'change_negotiation'
    | 'site_visa'
    | 'claim'
    | 'material_price_approval'

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
  id?: string
  projectId: string
  contractId: string
  code: string
  name: string
  changeType?: BoqChangeType
  directiveNo?: string
  directiveType?: BoqDirectiveType
  documentType?: BoqDocumentType
  applicationDate?: string
  reason?: string
  approvedTaxInclusiveAmount?: number | null
  approvedTaxExclusiveAmount?: number | null
  appliedTaxExclusiveAmount?: number | null
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

export interface ReviseApprovedBoqChangeOrderDraft {
  name?: string
  directiveNo?: string
  note?: string
  line: {
    id: string
    deltaQty?: number
    newUnitPrice?: number
    note?: string
  }
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
    return { amount: round2(qty * price), deltaQty: qty, newUnitPrice: price }
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
      amount: round2(delta * target.effectiveUnitPrice),
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
    amount: round2(target.effectiveQty * (price - target.effectiveUnitPrice)),
    deltaQty: null,
    newUnitPrice: price,
  }
}

function derivedChangeType(lines: readonly Pick<BoqChangeLineDraft, 'operation'>[]): BoqChangeType {
  const operations = new Set(lines.map(line => line.operation))
  return operations.size === 1 ? [...operations][0]! : 'mixed'
}

function nextTargetState(
  target: BoqLineView,
  operation: BoqChangeOperation,
  calculation: CalculatedLine,
): BoqLineView {
  if (operation === 'qty') {
    return {
      ...target,
      effectiveQty: target.effectiveQty + (calculation.deltaQty ?? 0),
    }
  }
  if (operation === 'price') {
    return {
      ...target,
      effectiveUnitPrice: calculation.newUnitPrice ?? target.effectiveUnitPrice,
    }
  }
  return target
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

async function normalizeChangeDraft(
  db: SoftDb,
  draft: CreateBoqChangeOrderDraft,
) {
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
    if (target)
      lineById.set(target.id, nextTargetState(target, line.operation, calculation))
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
  const totalAmount = round2(normalized.reduce(
    (total, line) => total + line.calculation.amount,
    0,
  ))
  return { normalized, changeType, totalAmount }
}

async function insertChangeLines(
  db: SoftDb,
  orderId: string,
  normalized: Awaited<ReturnType<typeof normalizeChangeDraft>>['normalized'],
): Promise<string[]> {
  const logIds: string[] = []
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
  return logIds
}

export async function createBoqChangeOrder(
  db: SoftDb,
  draft: CreateBoqChangeOrderDraft,
): Promise<CreateBoqChangeOrderResult> {
  const code = draft.code.trim()
  const name = draft.name.trim()
  if (!draft.projectId || !draft.contractId || !code)
    throw new Error('项目、施工合同与变更编号必填')
  if (!draft.lines.length)
    throw new Error('变更单至少需要一条明细')

  const { normalized, changeType, totalAmount } = await normalizeChangeDraft(db, draft)
  const orderId = draft.id ?? generateId('boq_change')
  const logIds: string[] = []
  await db.execute(
    `INSERT INTO boq_change_orders
      (id, project_id, contract_id, code, name, change_type, status, directive_no,
       directive_type, document_type, application_date, reason,
       approved_tax_inclusive_amount, approved_tax_exclusive_amount,
       applied_tax_exclusive_amount, total_amount, note)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      orderId,
      draft.projectId,
      draft.contractId,
      code,
      name,
      changeType,
      draft.directiveNo?.trim() ?? '',
      draft.directiveType ?? '',
      draft.documentType ?? 'change_negotiation',
      draft.applicationDate?.trim() ?? '',
      draft.reason?.trim() ?? '',
      draft.approvedTaxInclusiveAmount ?? null,
      draft.approvedTaxExclusiveAmount ?? null,
      draft.appliedTaxExclusiveAmount ?? null,
      totalAmount,
      draft.note?.trim() ?? '',
    ],
  )
  const orderLogId = await logCreate(db, 'boq_change_orders', orderId)
  if (orderLogId)
    logIds.push(orderLogId)

  logIds.push(...await insertChangeLines(db, orderId, normalized))
  return { orderId, logIds }
}

export async function replaceBoqChangeOrderDraft(
  db: SoftDb,
  orderId: string,
  draft: CreateBoqChangeOrderDraft,
): Promise<CreateBoqChangeOrderResult> {
  const order = await activeOrder(db, orderId)
  if (!['draft', 'rejected'].includes(order.status))
    throw new Error('只有草稿或已退回变更单可以编辑')
  const code = draft.code.trim()
  const name = draft.name.trim()
  if (!draft.projectId || !draft.contractId || !code)
    throw new Error('项目、施工合同与变更编号必填')
  if (!draft.lines.length)
    throw new Error('量价变更单至少需要一条明细')

  const { normalized, changeType, totalAmount } = await normalizeChangeDraft(db, draft)
  const logIds: string[] = []
  const orderLogId = await withUpdateLog(db, 'boq_change_orders', orderId, () => db.execute(
    `UPDATE boq_change_orders
     SET project_id = ?, contract_id = ?, code = ?, name = ?, change_type = ?,
         status = 'draft', status_note = '', directive_no = ?, directive_type = ?,
         document_type = ?, application_date = ?, reason = ?,
         approved_tax_inclusive_amount = ?, approved_tax_exclusive_amount = ?,
         applied_tax_exclusive_amount = ?, total_amount = ?, note = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
    [
      draft.projectId,
      draft.contractId,
      code,
      name,
      changeType,
      draft.directiveNo?.trim() ?? '',
      draft.directiveType ?? '',
      draft.documentType ?? 'change_negotiation',
      draft.applicationDate?.trim() ?? '',
      draft.reason?.trim() ?? '',
      draft.approvedTaxInclusiveAmount ?? null,
      draft.approvedTaxExclusiveAmount ?? null,
      draft.appliedTaxExclusiveAmount ?? null,
      totalAmount,
      draft.note?.trim() ?? '',
      orderId,
    ],
  ))
  if (orderLogId)
    logIds.push(orderLogId)

  const existingLines = await db.select<{ id: string }>(
    `SELECT id FROM boq_change_lines
     WHERE change_order_id = ? AND deleted_at IS NULL`,
    [orderId],
  )
  for (const line of existingLines) {
    const lineLogId = await softDelete(db, 'boq_change_lines', line.id)
    if (lineLogId)
      logIds.push(lineLogId)
  }
  logIds.push(...await insertChangeLines(db, orderId, normalized))
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
    if (target)
      targetById.set(target.id, nextTargetState(target, line.operation, calculation))
    totalAmount = round2(totalAmount + calculation.amount)
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

  const [formAmounts] = await db.select<{
    approved_tax_inclusive_amount: number | null
    approved_tax_exclusive_amount: number | null
    applied_tax_exclusive_amount: number | null
    application_date: string
    contract_id: string
    directive_no: string
    directive_type: string
    document_type: string
    name: string
    note: string
    reason: string
  }>(`
    SELECT approved_tax_inclusive_amount, approved_tax_exclusive_amount,
           applied_tax_exclusive_amount, application_date, contract_id,
           directive_no, directive_type, document_type, name, note, reason
    FROM boq_change_orders
    WHERE id = ? AND deleted_at IS NULL
  `, [orderId])
  const taxInclusiveAmount = formAmounts?.approved_tax_inclusive_amount ?? totalAmount
  const taxExclusiveAmount = formAmounts?.approved_tax_exclusive_amount ?? totalAmount
  const appliedAmount = formAmounts?.applied_tax_exclusive_amount ?? totalAmount
  const ledgerId = generateId('owner_change')
  await db.execute(
    `INSERT INTO owner_change_orders
      (id, project_id, change_no, contract_name, tax_inc_amount, tax_exc_amount,
       applied_amount, approval_date, source_type, source_id, source_locked,
       contract_id, name, document_type, directive_no, directive_type,
       application_date, reason, status, status_note, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'boq_change_order', ?, 1, ?, ?, ?, ?, ?, ?, ?,
             'approved', '甲方已签证', ?)`,
    [
      ledgerId,
      order.project_id,
      order.code,
      workspace.contractName,
      taxInclusiveAmount,
      taxExclusiveAmount,
      appliedAmount,
      approvedAt,
      orderId,
      formAmounts?.contract_id ?? order.contract_id,
      formAmounts?.name ?? order.name,
      formAmounts?.document_type ?? 'change_negotiation',
      formAmounts?.directive_no ?? '',
      formAmounts?.directive_type ?? '',
      formAmounts?.application_date ?? '',
      formAmounts?.reason ?? '',
      formAmounts?.note ?? '',
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

export async function reviseApprovedBoqChangeOrder(
  db: SoftDb,
  orderId: string,
  draft: ReviseApprovedBoqChangeOrderDraft,
  secondConfirmed: boolean,
): Promise<{ totalAmount: number, logIds: readonly string[] }> {
  if (!secondConfirmed)
    throw new Error('修改已签证内容需要二次确认')
  const order = await activeOrder(db, orderId)
  if (order.status !== 'approved')
    throw new Error('只有已签证变更可走签证更正')
  const [orderDetail] = await db.select<{
    approved_at: string
    created_at: string
    directive_no: string
    ledger_id: string | null
    note: string
  }>(`
    SELECT approved_at, created_at, directive_no, ledger_id, note
    FROM boq_change_orders
    WHERE id = ? AND deleted_at IS NULL
  `, [orderId])
  if (!orderDetail?.ledger_id)
    throw new Error('已签证变更缺少锁定台账，不能更正')
  const lines = await db.select<ChangeLineRow>(`
    SELECT id, boq_line_id, result_boq_line_id, item_id, operation, section, trade,
           item_name, unit, spec, delta_qty, new_unit_price, note, sort_order
    FROM boq_change_lines
    WHERE change_order_id = ? AND deleted_at IS NULL
    ORDER BY sort_order, id
  `, [orderId])
  if (lines.length !== 1 || lines[0]?.id !== draft.line.id)
    throw new Error('多明细混合签证请新增更正变更单，不能原地改写')
  const line = lines[0]
  const laterTargetId = line.boq_line_id ?? line.result_boq_line_id
  if (laterTargetId) {
    const [laterChange] = await db.select<{ id: string }>(`
      SELECT later_line.id
      FROM boq_change_lines later_line
      JOIN boq_change_orders later_order ON later_order.id = later_line.change_order_id
      WHERE later_line.deleted_at IS NULL
        AND later_order.deleted_at IS NULL
        AND later_order.status = 'approved'
        AND later_line.boq_line_id = ?
        AND (
          later_order.approved_at > ?
          OR (later_order.approved_at = ? AND later_order.created_at > ?)
        )
      LIMIT 1
    `, [
      laterTargetId,
      orderDetail.approved_at,
      orderDetail.approved_at,
      orderDetail.created_at,
    ])
    if (laterChange)
      throw new Error('该清单行已有后续签证，请新增更正变更单以保持金额链可追溯')
  }
  const workspace = await loadBoqWorkspace(db, order.project_id, order.contract_id)
  if (!workspace)
    throw new Error('施工合同不存在或已删除')
  const target = line.boq_line_id
    ? workspace.lines.find(candidate => candidate.id === line.boq_line_id) ?? null
    : null

  let deltaQty = line.delta_qty
  let newUnitPrice = line.new_unit_price
  let totalAmount = 0
  const logIds: string[] = []
  if (line.operation === 'add') {
    deltaQty = requiredFinite(draft.line.deltaQty ?? line.delta_qty, '新增工程量')
    newUnitPrice = requiredFinite(draft.line.newUnitPrice ?? line.new_unit_price, '新增合同单价')
    const calculated = calculatedLine('add', null, deltaQty, newUnitPrice)
    totalAmount = calculated.amount
    if (!line.result_boq_line_id)
      throw new Error('签证新增行缺少结果清单引用')
    const resultLogId = await withUpdateLog(db, 'boq_lines', line.result_boq_line_id, () => db.execute(
      `UPDATE boq_lines
       SET qty = ?, unit_price = ?, amount = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [deltaQty, newUnitPrice, totalAmount, line.result_boq_line_id],
    ))
    if (resultLogId)
      logIds.push(resultLogId)
  }
  else if (line.operation === 'qty') {
    if (!target)
      throw new Error('调量签证缺少目标清单行')
    const nextDelta = requiredFinite(draft.line.deltaQty ?? line.delta_qty, '调整工程量')
    const effectiveQtyWithoutOrder = target.effectiveQty - Number(line.delta_qty ?? 0)
    if (nextDelta === 0)
      throw new Error('调整工程量不能为 0')
    if (effectiveQtyWithoutOrder + nextDelta < 0)
      throw new Error('调整后合同工程量不能为负数')
    deltaQty = nextDelta
    totalAmount = round2(nextDelta * target.effectiveUnitPrice)
  }
  else {
    if (!target || !line.boq_line_id)
      throw new Error('调价签证缺少目标清单行')
    const nextPrice = requiredFinite(draft.line.newUnitPrice ?? line.new_unit_price, '调整后合同单价')
    if (nextPrice < 0)
      throw new Error('调整后合同单价不能为负数')
    const [priorPriceRow] = await db.select<{ unit_price: number }>(`
      SELECT change_line.new_unit_price AS unit_price
      FROM boq_change_lines change_line
      JOIN boq_change_orders order_row ON order_row.id = change_line.change_order_id
      WHERE change_line.deleted_at IS NULL
        AND order_row.deleted_at IS NULL
        AND order_row.status = 'approved'
        AND change_line.operation = 'price'
        AND change_line.boq_line_id = ?
        AND order_row.id <> ?
        AND (
          order_row.approved_at < ?
          OR (order_row.approved_at = ? AND order_row.created_at < ?)
        )
      ORDER BY order_row.approved_at DESC, order_row.created_at DESC, change_line.sort_order DESC
      LIMIT 1
    `, [
      line.boq_line_id,
      orderId,
      orderDetail.approved_at,
      orderDetail.approved_at,
      orderDetail.created_at,
    ])
    const [baseLine] = await db.select<{ unit_price: number | null }>(
      `SELECT unit_price FROM boq_lines WHERE id = ?`,
      [line.boq_line_id],
    )
    const priorPrice = Number(priorPriceRow?.unit_price ?? baseLine?.unit_price ?? 0)
    if (nextPrice === priorPrice)
      throw new Error('更正后合同单价没有变化')
    newUnitPrice = nextPrice
    totalAmount = round2(target.effectiveQty * (nextPrice - priorPrice))
  }

  const lineLogId = await withUpdateLog(db, 'boq_change_lines', line.id, () => db.execute(
    `UPDATE boq_change_lines
     SET delta_qty = ?, new_unit_price = ?, amount = ?, note = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [
      deltaQty,
      newUnitPrice,
      totalAmount,
      draft.line.note?.trim() ?? line.note,
      line.id,
    ],
  ))
  if (lineLogId)
    logIds.push(lineLogId)
  const orderLogId = await withUpdateLog(db, 'boq_change_orders', orderId, () => db.execute(
    `UPDATE boq_change_orders
     SET name = ?,
         directive_no = ?,
         total_amount = ?,
         note = ?,
         status_note = '甲方已签证 · 二次确认更正',
         updated_at = datetime('now')
     WHERE id = ?`,
    [
      draft.name?.trim() || order.name,
      draft.directiveNo?.trim() ?? orderDetail.directive_no,
      totalAmount,
      draft.note?.trim() ?? orderDetail.note,
      orderId,
    ],
  ))
  if (orderLogId)
    logIds.push(orderLogId)
  const ledgerLogId = await withUpdateLog(db, 'owner_change_orders', orderDetail.ledger_id, () => db.execute(
    `UPDATE owner_change_orders
     SET tax_inc_amount = ?,
         tax_exc_amount = ?,
         applied_amount = ?
     WHERE id = ?`,
    [totalAmount, totalAmount, totalAmount, orderDetail.ledger_id],
  ))
  if (ledgerLogId)
    logIds.push(ledgerLogId)
  return { totalAmount, logIds }
}
