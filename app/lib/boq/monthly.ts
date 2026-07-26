import type { SoftDb } from '~/lib/db/soft-delete'
import { hiddenCtesFor, logCreate, selectVisibleSql, visibleCond, withUpdateLog } from '~/lib/db/soft-delete'
import { generateId } from '~/lib/util/id'
import { loadBoqWorkspace } from './read-model'

export interface MonthlyStatementLineView {
  id: string
  boqLineId: string
  itemName: string
  unit: string
  autoQty: number
  adjustedQty: number | null
  effectiveQty: number
  unitPrice: number
  amount: number
  note: string
  sortOrder: number
}

export interface MonthlyStatementView {
  id: string
  projectId: string
  contractId: string
  month: string
  status: 'draft' | 'adjusted' | 'exported'
  totalAmount: number
  note: string
  lines: readonly MonthlyStatementLineView[]
}

export interface GenerateMonthlyStatementResult {
  statementId: string
  lineCount: number
  totalAmount: number
  logIds: readonly string[]
}

interface MonthlyQuantityRow {
  boq_line_id: string
  auto_qty: number
}

interface StatementRow {
  id: string
  project_id: string
  contract_id: string
  month: string
  status: 'draft' | 'adjusted' | 'exported'
  total_amount: number
  note: string
}

interface StatementLineRow {
  id: string
  boq_line_id: string
  item_name: string
  unit: string
  auto_qty: number
  adjusted_qty: number | null
  unit_price: number
  amount: number
  note: string
  sort_order: number
}

function numberValue(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : numberValue(value)
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function assertMonth(month: string) {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month))
    throw new Error('报量月份格式必须为 yyyy-mm')
}

async function loadMonthlyQuantities(
  db: SoftDb,
  projectId: string,
  contractId: string,
  month: string,
): Promise<MonthlyQuantityRow[]> {
  return db.select<MonthlyQuantityRow>(
    `${hiddenCtesFor(
      'unit_stage_completions',
      'construction_stage_items',
      'house_type_template_items',
      'boq_lines',
    )}
     SELECT hti.boq_line_id,
            SUM(COALESCE(hti.field_qty, hti.provisional_qty, hti.contract_qty, 0)) AS auto_qty
     FROM unit_stage_completions usc
     JOIN units unit_row ON unit_row.id = usc.unit_id
     JOIN floors floor_row ON floor_row.id = unit_row.floor_id
     JOIN buildings building ON building.id = floor_row.building_id
     JOIN construction_stage_items csi
       ON csi.stage_id = usc.stage_id
      AND csi.is_reporting_stage = 1
     JOIN house_type_template_items hti ON hti.item_id = csi.item_id
     JOIN rooms room_row
       ON room_row.id = hti.room_id
      AND room_row.template_id = unit_row.house_type_template_id
     JOIN boq_lines boq_line ON boq_line.id = hti.boq_line_id
     WHERE ${visibleCond('unit_stage_completions', 'usc')}
       AND ${visibleCond('units', 'unit_row')}
       AND ${visibleCond('construction_stage_items', 'csi')}
       AND ${visibleCond('house_type_template_items', 'hti')}
       AND ${visibleCond('rooms', 'room_row')}
       AND ${visibleCond('boq_lines', 'boq_line')}
       AND usc.status = 'completed'
       AND substr(usc.completed_at, 1, 7) = ?
       AND building.project_id = ?
       AND boq_line.contract_id = ?
     GROUP BY hti.boq_line_id
     ORDER BY MIN(boq_line.sort_order), hti.boq_line_id`,
    [month, projectId, contractId],
  )
}

export async function generateMonthlyStatement(
  db: SoftDb,
  projectId: string,
  contractId: string,
  month: string,
): Promise<GenerateMonthlyStatementResult> {
  assertMonth(month)
  const [existing] = await db.select<{ id: string }>(
    `SELECT id
     FROM monthly_statements
     WHERE contract_id = ? AND month = ? AND deleted_at IS NULL`,
    [contractId, month],
  )
  if (existing)
    throw new Error(`${month} 月度报量已存在`)

  const workspace = await loadBoqWorkspace(db, projectId, contractId)
  if (!workspace)
    throw new Error('施工合同不存在、已删除或不属于所选项目')
  const lineById = new Map(workspace.lines.map(line => [line.id, line]))
  const quantities = await loadMonthlyQuantities(db, projectId, contractId, month)
  const rows = quantities.flatMap((quantity) => {
    const line = lineById.get(quantity.boq_line_id)
    if (!line)
      return []
    const autoQty = numberValue(quantity.auto_qty)
    return [{
      line,
      autoQty,
      amount: money(autoQty * line.effectiveUnitPrice),
    }]
  })
  if (!rows.length)
    throw new Error(`${month} 没有可报量的已完成工程量`)

  const statementId = generateId('monthly_statement')
  const totalAmount = money(rows.reduce((total, row) => total + row.amount, 0))
  const logIds: string[] = []
  await db.execute(
    `INSERT INTO monthly_statements
      (id, project_id, contract_id, month, status, total_amount)
     VALUES (?, ?, ?, ?, 'draft', ?)`,
    [statementId, projectId, contractId, month, totalAmount],
  )
  const statementLogId = await logCreate(db, 'monthly_statements', statementId)
  if (statementLogId)
    logIds.push(statementLogId)

  for (const [index, row] of rows.entries()) {
    const lineId = generateId('monthly_statement_line')
    await db.execute(
      `INSERT INTO monthly_statement_lines
        (id, statement_id, boq_line_id, item_name, unit, auto_qty, adjusted_qty,
         unit_price, amount, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      [
        lineId,
        statementId,
        row.line.id,
        row.line.itemName,
        row.line.unit,
        row.autoQty,
        row.line.effectiveUnitPrice,
        row.amount,
        (index + 1) * 10,
      ],
    )
    const lineLogId = await logCreate(db, 'monthly_statement_lines', lineId)
    if (lineLogId)
      logIds.push(lineLogId)
  }
  return { statementId, lineCount: rows.length, totalAmount, logIds }
}

export async function loadMonthlyStatement(
  db: SoftDb,
  statementId: string,
): Promise<MonthlyStatementView | null> {
  const [statement] = await db.select<StatementRow>(
    selectVisibleSql('monthly_statements', 'AND id = ?'),
    [statementId],
  )
  if (!statement)
    return null
  const lines = await db.select<StatementLineRow>(
    selectVisibleSql(
      'monthly_statement_lines',
      'AND statement_id = ? ORDER BY sort_order, id',
    ),
    [statementId],
  )
  return {
    id: statement.id,
    projectId: statement.project_id,
    contractId: statement.contract_id,
    month: statement.month,
    status: statement.status,
    totalAmount: numberValue(statement.total_amount),
    note: statement.note,
    lines: lines.map((line) => {
      const autoQty = numberValue(line.auto_qty)
      const adjustedQty = nullableNumber(line.adjusted_qty)
      return {
        id: line.id,
        boqLineId: line.boq_line_id,
        itemName: line.item_name,
        unit: line.unit,
        autoQty,
        adjustedQty,
        effectiveQty: adjustedQty ?? autoQty,
        unitPrice: numberValue(line.unit_price),
        amount: numberValue(line.amount),
        note: line.note,
        sortOrder: numberValue(line.sort_order),
      }
    }),
  }
}

export async function adjustMonthlyStatementLine(
  db: SoftDb,
  statementLineId: string,
  adjustedQty: number,
  note: string,
): Promise<readonly string[]> {
  if (!Number.isFinite(adjustedQty) || adjustedQty < 0)
    throw new Error('手调工程量必须是非负有效数字')
  const [line] = await db.select<{ statement_id: string, unit_price: number }>(
    `SELECT statement_id, unit_price
     FROM monthly_statement_lines
     WHERE id = ? AND deleted_at IS NULL`,
    [statementLineId],
  )
  if (!line)
    throw new Error('月度报量行不存在或已删除')
  const [statement] = await db.select<{ status: string }>(
    `SELECT status
     FROM monthly_statements
     WHERE id = ? AND deleted_at IS NULL`,
    [line.statement_id],
  )
  if (!statement)
    throw new Error('月度报量单不存在或已删除')
  if (statement.status === 'exported')
    throw new Error('已导出的月度报量不能直接调整')

  const logIds: string[] = []
  const lineLogId = await withUpdateLog(db, 'monthly_statement_lines', statementLineId, () => db.execute(
    `UPDATE monthly_statement_lines
     SET adjusted_qty = ?, amount = ?, note = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [adjustedQty, money(adjustedQty * numberValue(line.unit_price)), note.trim(), statementLineId],
  ))
  if (lineLogId)
    logIds.push(lineLogId)

  const [total] = await db.select<{ amount: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS amount
     FROM monthly_statement_lines
     WHERE statement_id = ? AND deleted_at IS NULL`,
    [line.statement_id],
  )
  const statementLogId = await withUpdateLog(db, 'monthly_statements', line.statement_id, () => db.execute(
    `UPDATE monthly_statements
     SET status = 'adjusted', total_amount = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [money(numberValue(total?.amount)), line.statement_id],
  ))
  if (statementLogId)
    logIds.push(statementLogId)
  return logIds
}

export async function markMonthlyStatementExported(
  db: SoftDb,
  statementId: string,
): Promise<string | null> {
  return withUpdateLog(db, 'monthly_statements', statementId, () => db.execute(
    `UPDATE monthly_statements
     SET status = 'exported', updated_at = datetime('now')
     WHERE id = ?`,
    [statementId],
  ))
}
