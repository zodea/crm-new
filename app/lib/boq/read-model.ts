import type { SoftDb } from '~/lib/db/soft-delete'
import { selectVisibleSql } from '~/lib/db/soft-delete'
import { round2 } from '~/lib/util/number'

export type BoqChangeStatus = 'draft' | 'submitted' | 'rejected' | 'approved'
export type BoqChangeOperation = 'add' | 'qty' | 'price'

export interface BoqCatalogContract {
  id: string
  no: string
  name: string
  lineCount: number
}

export interface BoqCatalogProject {
  id: string
  code: string
  name: string
  contracts: readonly BoqCatalogContract[]
}

export interface BoqFileView {
  id: string
  fileName: string
  filePath: string
  formatClass: string
  parseStatus: 'pending' | 'parsed'
  lineCount: number
  note: string
  createdAt: string
}

export interface BoqLineView {
  id: string
  boqFileId: string | null
  changeOrderId: string | null
  itemId: string | null
  section: string
  trade: string
  itemName: string
  unit: string
  baseQty: number | null
  baseUnitPrice: number | null
  baseAmount: number | null
  effectiveQty: number | null
  effectiveUnitPrice: number | null
  effectiveAmount: number | null
  approvedChangeAmount: number
  traceKey: string
  sourceSheet: string
  sourceRow: number | null
  recognizedQty: number | null
  recognizedUnitPrice: number | null
  manuallyCorrected: boolean
  building: string
  unitType: string
  multiplier: number | null
  room: string
  floorZone: string
  spec: string
  taxRate: number | null
  ownerSupplied: boolean
  sortOrder: number
}

export interface BoqCatalogTrade {
  name: string
  lineIds: readonly string[]
  items: readonly BoqCatalogItem[]
}

export interface BoqCatalogItem {
  name: string
  lineIds: readonly string[]
}

export interface BoqCatalogSection {
  name: string
  lineIds: readonly string[]
  trades: readonly BoqCatalogTrade[]
}

export interface BoqChangeOrderView {
  id: string
  code: string
  name: string
  changeType: 'add' | 'qty' | 'price' | 'mixed'
  status: BoqChangeStatus
  statusNote: string
  directiveNo: string
  directiveType: '' | 'issued' | 'changed' | 'supplemented'
  totalAmount: number | null
  approvedAt: string | null
  ledgerId: string | null
  attachmentCount: number
  attachments: readonly BoqAttachmentView[]
  lines: readonly BoqChangeLineView[]
  createdAt: string
}

export interface BoqChangeLineView {
  id: string
  operation: BoqChangeOperation
  boqLineId: string | null
  resultBoqLineId: string | null
  itemName: string
  deltaQty: number | null
  newUnitPrice: number | null
  amount: number
  note: string
}

export interface BoqAttachmentView {
  id: string
  orderId: string
  fileName: string
  fileSize: number
  mimeType: string
  category: string
  uploadedAt: string
}

export interface BoqMonthlyStatementSummary {
  id: string
  month: string
  status: 'draft' | 'adjusted' | 'exported'
  totalAmount: number
  note: string
}

export interface BoqWorkspaceSummary {
  lineCount: number
  baseAmount: number | null
  approvedChangeAmount: number | null
  effectiveAmount: number | null
}

export interface BoqWorkspace {
  monthlySourceState?: 'readable' | 'unavailable'
  projectId: string
  projectName: string
  contractId: string
  contractNo: string
  contractName: string
  files: readonly BoqFileView[]
  lines: readonly BoqLineView[]
  catalog: readonly BoqCatalogSection[]
  changes: readonly BoqChangeOrderView[]
  monthlyStatements: readonly BoqMonthlyStatementSummary[]
  summary: BoqWorkspaceSummary
}

interface ProjectRow {
  id: string
  code: string | null
  name: string
}

interface ContractRow {
  id: string
  no: string | null
  name: string
  project_id: string
}

interface CountRow {
  contract_id: string
  line_count: number
}

interface FileRow {
  id: string
  file_name: string
  file_path: string
  format_class: string
  parse_status: 'pending' | 'parsed'
  line_count: number
  note: string
  created_at: string
}

interface LineRow {
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
  amount: number | null
  trace_key: string
  source_sheet: string
  source_row: number | null
  recognized_qty: number | null
  recognized_unit_price: number | null
  building: string
  unit_type: string
  multiplier: number | null
  room: string
  floor_zone: string
  spec: string
  tax_rate: number | null
  owner_supplied: number
  sort_order: number
}

interface ApprovedChangeRow {
  id: string
  operation: BoqChangeOperation
  boq_line_id: string | null
  result_boq_line_id: string | null
  delta_qty: number | null
  new_unit_price: number | null
  amount: number
  approved_at: string
  order_created_at: string
  sort_order: number
}

interface ChangeOrderRow {
  id: string
  code: string
  name: string
  change_type: 'add' | 'qty' | 'price' | 'mixed'
  status: BoqChangeStatus
  status_note: string
  directive_no: string
  directive_type: '' | 'issued' | 'changed' | 'supplemented'
  total_amount: number
  approved_at: string | null
  ledger_id: string | null
  created_at: string
}
interface ChangeDetailRow {
  id: string
  change_order_id: string
  operation: BoqChangeOperation
  boq_line_id: string | null
  result_boq_line_id: string | null
  item_name: string
  delta_qty: number | null
  new_unit_price: number | null
  amount: number
  note: string
}

interface MonthlySummaryRow {
  id: string
  month: string
  status: 'draft' | 'adjusted' | 'exported'
  total_amount: number
  note: string
}
interface AttachmentRow {
  id: string
  owner_id: string
  file_name: string
  file_size: number
  mime_type: string
  category: string
  uploaded_at: string
}

function numberValue(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : numberValue(value)
}

export function buildCatalog(lines: readonly BoqLineView[]): BoqCatalogSection[] {
  const sections = new Map<string, Map<string, Map<string, string[]>>>()
  for (const line of lines) {
    const sectionName = line.section || '未分部'
    const tradeName = line.trade || '未分工种'
    const itemName = line.itemName || '未命名分项'
    const trades = sections.get(sectionName) ?? new Map<string, Map<string, string[]>>()
    const items = trades.get(tradeName) ?? new Map<string, string[]>()
    const lineIds = items.get(itemName) ?? []
    lineIds.push(line.id)
    items.set(itemName, lineIds)
    trades.set(tradeName, items)
    sections.set(sectionName, trades)
  }
  return [...sections.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
    .map(([name, trades]) => ({
      name,
      lineIds: [...trades.values()].flatMap(items => [...items.values()].flat()),
      trades: [...trades.entries()]
        .sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
        .map(([trade, items]) => ({
          name: trade,
          lineIds: [...items.values()].flat(),
          items: [...items.entries()]
            .sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
            .map(([itemName, lineIds]) => ({ name: itemName, lineIds })),
        })),
    }))
}

export async function loadBoqCatalog(db: SoftDb): Promise<BoqCatalogProject[]> {
  const [projects, contracts, counts] = await Promise.all([
    db.select<ProjectRow>(selectVisibleSql('projects', 'ORDER BY code, name, id')),
    db.select<ContractRow>(selectVisibleSql(
      'contracts',
      `AND kind = '施工' ORDER BY project_id, no, name, id`,
    )),
    db.select<CountRow>(`
      SELECT contract_id, COUNT(*) AS line_count
      FROM boq_lines
      WHERE deleted_at IS NULL
      GROUP BY contract_id
    `),
  ])
  const countByContract = new Map(counts.map(row => [row.contract_id, numberValue(row.line_count)]))
  const contractsByProject = new Map<string, BoqCatalogContract[]>()
  for (const contract of contracts) {
    const bucket = contractsByProject.get(contract.project_id) ?? []
    bucket.push({
      id: contract.id,
      no: contract.no ?? '',
      name: contract.name,
      lineCount: countByContract.get(contract.id) ?? 0,
    })
    contractsByProject.set(contract.project_id, bucket)
  }
  return projects
    .map(project => ({
      id: project.id,
      code: project.code ?? '',
      name: project.name,
      contracts: contractsByProject.get(project.id) ?? [],
    }))
    .filter(project => project.contracts.length > 0)
}

export async function loadBoqWorkspace(
  db: SoftDb,
  projectId: string,
  contractId: string,
): Promise<BoqWorkspace | null> {
  const [project] = await db.select<ProjectRow>(
    selectVisibleSql('projects', 'AND id = ?'),
    [projectId],
  )
  const [contract] = await db.select<ContractRow>(
    selectVisibleSql('contracts', `AND id = ? AND project_id = ? AND kind = '施工'`),
    [contractId, projectId],
  )
  if (!project || !contract)
    return null

  const [
    fileRows,
    lineRows,
    approvedRows,
    changeRows,
    changeDetailRows,
    monthlyRows,
    attachmentRows,
  ] = await Promise.all([
    db.select<FileRow>(
      selectVisibleSql('boq_files', 'AND contract_id = ? ORDER BY created_at, id'),
      [contractId],
    ),
    db.select<LineRow>(
      selectVisibleSql('boq_lines', 'AND project_id = ? AND contract_id = ? ORDER BY sort_order, id'),
      [projectId, contractId],
    ),
    db.select<ApprovedChangeRow>(`
      SELECT line.id,
             line.operation,
             line.boq_line_id,
             line.result_boq_line_id,
             line.delta_qty,
             line.new_unit_price,
             line.amount,
             order_row.approved_at,
             order_row.created_at AS order_created_at,
             line.sort_order
      FROM boq_change_lines line
      JOIN boq_change_orders order_row ON order_row.id = line.change_order_id
      WHERE line.deleted_at IS NULL
        AND order_row.deleted_at IS NULL
        AND order_row.project_id = ?
        AND order_row.contract_id = ?
        AND order_row.status = 'approved'
      ORDER BY order_row.approved_at, order_row.created_at, line.sort_order, line.id
    `, [projectId, contractId]),
    db.select<ChangeOrderRow>(`
      SELECT order_row.id,
             order_row.code,
             order_row.name,
             order_row.change_type,
             order_row.status,
             order_row.status_note,
             order_row.directive_no,
             order_row.directive_type,
             order_row.total_amount,
             order_row.approved_at,
             order_row.ledger_id,
             order_row.created_at
      FROM boq_change_orders order_row
      WHERE order_row.deleted_at IS NULL
        AND order_row.project_id = ?
        AND order_row.contract_id = ?
      ORDER BY order_row.created_at DESC, order_row.id DESC
    `, [projectId, contractId]),
    db.select<ChangeDetailRow>(`
      SELECT change_line.id,
             change_line.change_order_id,
             change_line.operation,
             change_line.boq_line_id,
             change_line.result_boq_line_id,
             COALESCE(NULLIF(change_line.item_name, ''), target.item_name, '') AS item_name,
             change_line.delta_qty,
             change_line.new_unit_price,
             change_line.amount,
             change_line.note
      FROM boq_change_lines change_line
      LEFT JOIN boq_lines target ON target.id = change_line.boq_line_id
      JOIN boq_change_orders order_row ON order_row.id = change_line.change_order_id
      WHERE change_line.deleted_at IS NULL
        AND order_row.deleted_at IS NULL
        AND order_row.project_id = ?
        AND order_row.contract_id = ?
      ORDER BY change_line.sort_order, change_line.id
    `, [projectId, contractId]),
    db.select<MonthlySummaryRow>(
      selectVisibleSql(
        'monthly_statements',
        'AND project_id = ? AND contract_id = ? ORDER BY month DESC, created_at DESC, id',
      ),
      [projectId, contractId],
    ),
    db.select<AttachmentRow>(`
      SELECT attachment.id,
             attachment.owner_id,
             attachment.file_name,
             attachment.file_size,
             attachment.mime_type,
             attachment.category,
             attachment.uploaded_at
      FROM file_refs attachment
      JOIN boq_change_orders order_row ON order_row.id = attachment.owner_id
      WHERE attachment.deleted_at IS NULL
        AND attachment.owner_type = 'boq_change_order'
        AND order_row.deleted_at IS NULL
        AND order_row.project_id = ?
        AND order_row.contract_id = ?
      ORDER BY attachment.uploaded_at, attachment.id
    `, [projectId, contractId]),
  ])

  const changesByLine = new Map<string, ApprovedChangeRow[]>()
  for (const change of approvedRows) {
    const targetId = change.operation === 'add' ? change.result_boq_line_id : change.boq_line_id
    if (!targetId)
      continue
    const bucket = changesByLine.get(targetId) ?? []
    bucket.push(change)
    changesByLine.set(targetId, bucket)
  }

  const lines = lineRows.map<BoqLineView>((row) => {
    const baseQty = numberValue(row.qty)
    const baseUnitPrice = numberValue(row.unit_price)
    const baseAmount = row.amount == null ? round2(baseQty * baseUnitPrice) : numberValue(row.amount)
    let effectiveQty = baseQty
    let effectiveUnitPrice = baseUnitPrice
    let approvedChangeAmount = 0
    for (const change of changesByLine.get(row.id) ?? []) {
      approvedChangeAmount = round2(approvedChangeAmount + numberValue(change.amount))
      if (change.operation === 'qty')
        effectiveQty += numberValue(change.delta_qty)
      else if (change.operation === 'price')
        effectiveUnitPrice = numberValue(change.new_unit_price)
    }
    const recognizedQty = nullableNumber(row.recognized_qty)
    const recognizedUnitPrice = nullableNumber(row.recognized_unit_price)
    return {
      id: row.id,
      boqFileId: row.boq_file_id,
      changeOrderId: row.change_order_id,
      itemId: row.item_id,
      section: row.section,
      trade: row.trade,
      itemName: row.item_name,
      unit: row.unit,
      baseQty,
      baseUnitPrice,
      baseAmount,
      effectiveQty,
      effectiveUnitPrice,
      effectiveAmount: round2(effectiveQty * effectiveUnitPrice),
      approvedChangeAmount,
      traceKey: row.trace_key,
      sourceSheet: row.source_sheet,
      sourceRow: nullableNumber(row.source_row),
      recognizedQty,
      recognizedUnitPrice,
      manuallyCorrected: row.boq_file_id != null && (
        (recognizedQty != null && recognizedQty !== baseQty)
        || (recognizedUnitPrice != null && recognizedUnitPrice !== baseUnitPrice)
      ),
      building: row.building,
      unitType: row.unit_type,
      multiplier: nullableNumber(row.multiplier),
      room: row.room,
      floorZone: row.floor_zone,
      spec: row.spec,
      taxRate: nullableNumber(row.tax_rate),
      ownerSupplied: Boolean(row.owner_supplied),
      sortOrder: numberValue(row.sort_order),
    }
  })

  const approvedChangeAmount = round2(changeRows
    .filter(change => change.status === 'approved')
    .reduce((total, change) => total + numberValue(change.total_amount), 0))
  const originalLines = lines.filter(line => line.boqFileId != null)
  const baseAmount = originalLines.some(line => line.baseAmount === null) ? null : round2(originalLines.reduce((total, line) => total + line.baseAmount!, 0))
  const effectiveAmount = lines.some(line => line.effectiveAmount === null) ? null : round2(lines.reduce((total, line) => total + line.effectiveAmount!, 0))
  const attachmentsByOrder = new Map<string, BoqAttachmentView[]>()
  for (const attachment of attachmentRows) {
    const bucket = attachmentsByOrder.get(attachment.owner_id) ?? []
    bucket.push({
      id: attachment.id,
      orderId: attachment.owner_id,
      fileName: attachment.file_name,
      fileSize: numberValue(attachment.file_size),
      mimeType: attachment.mime_type || 'application/octet-stream',
      category: attachment.category,
      uploadedAt: attachment.uploaded_at,
    })
    attachmentsByOrder.set(attachment.owner_id, bucket)
  }
  const changeLinesByOrder = new Map<string, BoqChangeLineView[]>()
  for (const line of changeDetailRows) {
    changeLinesByOrder.set(line.change_order_id, [
      ...(changeLinesByOrder.get(line.change_order_id) ?? []),
      {
        id: line.id,
        operation: line.operation,
        boqLineId: line.boq_line_id,
        resultBoqLineId: line.result_boq_line_id,
        itemName: line.item_name,
        deltaQty: nullableNumber(line.delta_qty),
        newUnitPrice: nullableNumber(line.new_unit_price),
        amount: numberValue(line.amount),
        note: line.note,
      },
    ])
  }

  return {
    projectId,
    projectName: project.name,
    contractId,
    contractNo: contract.no ?? '',
    contractName: contract.name,
    files: fileRows.map(row => ({
      id: row.id,
      fileName: row.file_name,
      filePath: row.file_path,
      formatClass: row.format_class,
      parseStatus: row.parse_status,
      lineCount: numberValue(row.line_count),
      note: row.note,
      createdAt: row.created_at,
    })),
    lines,
    catalog: buildCatalog(lines),
    changes: changeRows.map(row => ({
      id: row.id,
      code: row.code,
      name: row.name,
      changeType: row.change_type,
      status: row.status,
      statusNote: row.status_note,
      directiveNo: row.directive_no,
      directiveType: row.directive_type,
      totalAmount: numberValue(row.total_amount),
      approvedAt: row.approved_at,
      ledgerId: row.ledger_id,
      attachmentCount: attachmentsByOrder.get(row.id)?.length ?? 0,
      attachments: attachmentsByOrder.get(row.id) ?? [],
      lines: changeLinesByOrder.get(row.id) ?? [],
      createdAt: row.created_at,
    })),
    monthlyStatements: monthlyRows.map(row => ({
      id: row.id,
      month: row.month,
      status: row.status,
      totalAmount: numberValue(row.total_amount),
      note: row.note,
    })),
    summary: {
      lineCount: lines.length,
      baseAmount,
      approvedChangeAmount,
      effectiveAmount,
    },
  }
}
