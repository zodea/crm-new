import type { TransactionDb } from '~/lib/db/coordinator'
import type {
  FileRefChanges,
  FileRefRecord,
} from '~/lib/forms/file-refs'
import { select, withTransaction } from '~/lib/db/connection'
import {
  logCreate,
  restoreRecord,
  softDelete,
  withUpdateLog,
} from '~/lib/db/soft-delete'
import {
  applyFileRefChanges,
  listFileRefs,
} from '~/lib/forms/file-refs'
import { generateId } from '~/lib/util/id'

export type MaterialFormKind
  = | 'mat_requisition'
    | 'mat_arrival'
    | 'mat_use'
    | 'stock_check'
    | 'owner_control'
    | 'owner_requisition'
    | 'owner_arrival'
    | 'owner_use'
    | 'owner_direct'

export type MaterialSaveAction = 'draft' | 'save' | 'post'

interface MaterialBaseDraft {
  id?: string
  no?: string
  status?: string
  note?: string
}

export interface MaterialRequisitionDraft extends MaterialBaseDraft {
  projectId?: string | null
  contractId?: string | null
  applicant?: string
  requisitionDate?: string
  requiredDate?: string
  materialName?: string
  spec?: string
  unit?: string
  plannedQty?: number | null
  warehouse?: string
  purpose?: string
}

export interface MaterialArrivalLineDraft {
  id?: string
  materialName?: string
  spec?: string
  unit?: string
  qty?: number | null
  unitPrice?: number | null
  note?: string
}

export interface MaterialArrivalDraft extends MaterialBaseDraft {
  projectId?: string | null
  supplierId?: string | null
  contractId?: string | null
  requisitionId?: string | null
  warehouse?: string
  arrivalDate?: string
  receiver?: string
  qualityResult?: string
  stockStatus?: string
  lines?: MaterialArrivalLineDraft[]
}

export interface MaterialUseDraft extends MaterialBaseDraft {
  projectId?: string | null
  warehouse?: string
  useDate?: string
  materialName?: string
  spec?: string
  unit?: string
  qty?: number | null
  receiver?: string
  crewId?: string | null
  purpose?: string
}

export interface StockCheckLineDraft {
  id?: string
  materialName?: string
  spec?: string
  unit?: string
  bookQty?: number | null
  actualQty?: number | null
  varianceAmount?: number | null
}

export interface StockCheckDraft extends MaterialBaseDraft {
  warehouse?: string
  checker?: string
  checkDate?: string
  lines?: StockCheckLineDraft[]
}

export interface OwnerMaterialControlDraft extends MaterialBaseDraft {
  projectId?: string | null
  customerId?: string | null
  materialName?: string
  spec?: string
  unit?: string
  controlQty?: number | null
}

export interface OwnerMaterialRequisitionDraft extends MaterialBaseDraft {
  projectId?: string | null
  applicant?: string
  applicationDate?: string
  requiredDate?: string
  materialName?: string
  spec?: string
  unit?: string
  plannedQty?: number | null
}

export interface OwnerMaterialArrivalDraft extends MaterialBaseDraft {
  projectId?: string | null
  warehouse?: string
  arrivalDate?: string
  receiver?: string
  materialName?: string
  spec?: string
  unit?: string
  qty?: number | null
  qualityResult?: string
  stockStatus?: string
}

export interface OwnerMaterialUseDraft extends MaterialBaseDraft {
  projectId?: string | null
  useDate?: string
  materialName?: string
  unit?: string
  qty?: number | null
  receiver?: string
  crewId?: string | null
  purpose?: string
}

export interface OwnerMaterialDirectDraft extends MaterialBaseDraft {
  projectId?: string | null
  customerId?: string | null
  transactionDate?: string
  materialName?: string
  unit?: string
  qty?: number | null
  purpose?: string
  useLocation?: string
}

export type MaterialFormDraft
  = | MaterialRequisitionDraft
    | MaterialArrivalDraft
    | MaterialUseDraft
    | StockCheckDraft
    | OwnerMaterialControlDraft
    | OwnerMaterialRequisitionDraft
    | OwnerMaterialArrivalDraft
    | OwnerMaterialUseDraft
    | OwnerMaterialDirectDraft

export interface MaterialStockSummary {
  receivedQty: number
  usedQty: number
  adjustedQty: number
  availableQty: number
}

export interface MaterialRequisitionSummary {
  plannedQty: number
  arrivedQty: number
  remainingQty: number
}

export interface MaterialArrivalSummary {
  materialSummary: string
  totalQty: number
  totalAmount: number
}

export interface StockCheckSummary {
  itemCount: number
  varianceQty: number
  varianceAmount: number
}

export interface OwnerMaterialSummary {
  controlQty: number
  arrivedQty: number
  usedQty: number
  remainingQty: number
  stockQty: number
}

export interface MaterialFormRecordMap {
  mat_requisition: MaterialRequisitionDraft & MaterialRequisitionSummary & { id: string }
  mat_arrival: MaterialArrivalDraft & MaterialArrivalSummary & {
    id: string
    lines: MaterialArrivalLineDraft[]
  }
  mat_use: MaterialUseDraft & { id: string }
  stock_check: StockCheckDraft & StockCheckSummary & {
    id: string
    lines: StockCheckLineDraft[]
  }
  owner_control: OwnerMaterialControlDraft & OwnerMaterialSummary & { id: string }
  owner_requisition: OwnerMaterialRequisitionDraft & { id: string }
  owner_arrival: OwnerMaterialArrivalDraft & { id: string }
  owner_use: OwnerMaterialUseDraft & { id: string }
  owner_direct: OwnerMaterialDirectDraft & { id: string }
}

export interface MaterialSaveResult {
  id: string
  logId: string | null
  attachmentIds: string[]
}

type MaterialTable
  = | 'material_requisitions'
    | 'material_arrivals'
    | 'material_arrival_lines'
    | 'material_uses'
    | 'stock_checks'
    | 'stock_check_lines'
    | 'owner_material_controls'
    | 'owner_material_requisitions'
    | 'owner_material_arrivals'
    | 'owner_material_uses'
    | 'owner_material_directs'
    | 'projects'
    | 'customers'
    | 'suppliers'
    | 'crews'
    | 'contracts'

interface PersistedHead {
  id: string
  logId: string | null
}

interface ExistingHead {
  id: string
  status: string
  deleted_at: string | null
}

const TABLE_BY_KIND: Record<MaterialFormKind, MaterialTable> = {
  mat_requisition: 'material_requisitions',
  mat_arrival: 'material_arrivals',
  mat_use: 'material_uses',
  stock_check: 'stock_checks',
  owner_control: 'owner_material_controls',
  owner_requisition: 'owner_material_requisitions',
  owner_arrival: 'owner_material_arrivals',
  owner_use: 'owner_material_uses',
  owner_direct: 'owner_material_directs',
}

const FINAL_STATUS: Record<MaterialFormKind, string> = {
  mat_requisition: 'submitted',
  mat_arrival: 'posted',
  mat_use: 'posted',
  stock_check: 'effective',
  owner_control: 'effective',
  owner_requisition: 'submitted',
  owner_arrival: 'posted',
  owner_use: 'posted',
  owner_direct: 'confirmed',
}

const NO_PREFIX: Record<MaterialFormKind, string> = {
  mat_requisition: 'XL',
  mat_arrival: 'DH',
  mat_use: 'LY',
  stock_check: 'PD',
  owner_control: 'JGZK',
  owner_requisition: 'JGXL',
  owner_arrival: 'JGDH',
  owner_use: 'JGLY',
  owner_direct: 'JGZR',
}

const OWNER_TYPE: Partial<Record<MaterialFormKind, string>> = {
  mat_requisition: 'material_requisition',
  mat_arrival: 'material_arrival',
  mat_use: 'material_use',
  stock_check: 'stock_check',
  owner_requisition: 'owner_material_requisition',
  owner_arrival: 'owner_material_arrival',
  owner_direct: 'owner_material_direct',
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function nullableId(value: unknown): string | null {
  const normalized = text(value)
  return normalized || null
}

function nonNegativeNumber(label: string, value: unknown): number {
  if (value === '' || value == null)
    return 0
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0)
    throw new Error(`${label}不能为负数`)
  return number
}

function positiveNumber(label: string, value: unknown): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0)
    throw new Error(`${label}必须大于 0`)
  return number
}

function requireFields(fields: Array<[string, unknown]>): void {
  const missing = fields
    .filter(([, value]) => value == null || text(value) === '')
    .map(([label]) => label)
  if (missing.length)
    throw new Error(`${missing.join('、')}不能为空`)
}

function generatedNo(prefix: string, requested: unknown, id: string): string {
  const supplied = text(requested)
  if (supplied)
    return supplied
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  return `${prefix}-${date}-${id.slice(-6).toUpperCase()}`
}

function rowText(row: Record<string, unknown>, key: string): string {
  return String(row[key] ?? '')
}

function rowNullableText(row: Record<string, unknown>, key: string): string | null {
  return row[key] == null ? null : String(row[key])
}

function rowNumber(row: Record<string, unknown>, key: string): number {
  return Number(row[key]) || 0
}

function almostEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.0001
}

async function activeRow<T>(
  tx: Pick<TransactionDb, 'select'>,
  table: MaterialTable,
  id: unknown,
): Promise<T | null> {
  const normalized = nullableId(id)
  if (!normalized)
    return null
  const rows = await tx.select<T>(
    `SELECT * FROM "${table}" WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [normalized],
  )
  return rows[0] ?? null
}

async function assertReference<T>(
  tx: Pick<TransactionDb, 'select'>,
  table: MaterialTable,
  id: unknown,
  label: string,
): Promise<T> {
  const row = await activeRow<T>(tx, table, id)
  if (!row)
    throw new Error(`${label}不存在或已删除`)
  return row
}

async function assertOptionalReference(
  tx: Pick<TransactionDb, 'select'>,
  table: MaterialTable,
  id: unknown,
  label: string,
): Promise<void> {
  if (nullableId(id))
    await assertReference(tx, table, id, label)
}

async function assertProjectSupplier(
  tx: Pick<TransactionDb, 'select'>,
  projectId: unknown,
  supplierId: unknown,
): Promise<void> {
  const selectedProjectId = nullableId(projectId)
  const selectedSupplierId = nullableId(supplierId)
  if (!selectedProjectId || !selectedSupplierId)
    return
  const rows = await tx.select<{ id: string, supplier_category: string | null }>(`
    SELECT relation.id, supplier.supplier_category
    FROM project_suppliers AS relation
    JOIN suppliers AS supplier ON supplier.id = relation.supplier_id
    WHERE relation.project_id = ?
      AND relation.supplier_id = ?
      AND relation.deleted_at IS NULL
      AND supplier.deleted_at IS NULL
    LIMIT 1
  `, [selectedProjectId, selectedSupplierId])
  if (!rows[0])
    throw new Error('分供方未关联所选项目')
  if (rows[0].supplier_category && rows[0].supplier_category !== '材料供应商')
    throw new Error('乙供材只能关联材料供应商')
}

async function assertMaterialContract(
  tx: Pick<TransactionDb, 'select'>,
  contractId: unknown,
  projectId: unknown,
  supplierId?: unknown,
): Promise<void> {
  if (!nullableId(contractId))
    return
  const contract = await assertReference<{
    kind: string
    project_id: string
    supplier_id: string | null
  }>(tx, 'contracts', contractId, '材料采购合同')
  if (contract.kind !== '材采')
    throw new Error('只能关联材料采购合同')
  if (contract.project_id !== nullableId(projectId))
    throw new Error('材料采购合同不属于所选项目')
  if (
    nullableId(supplierId)
    && contract.supplier_id
    && contract.supplier_id !== nullableId(supplierId)
  ) {
    throw new Error('分供方与材料采购合同不一致')
  }
}

async function assertProjectCustomer(
  tx: Pick<TransactionDb, 'select'>,
  projectId: unknown,
  customerId: unknown,
): Promise<void> {
  const selectedProjectId = nullableId(projectId)
  const selectedCustomerId = nullableId(customerId)
  if (!selectedProjectId || !selectedCustomerId)
    return
  const project = await assertReference<{
    customer_id: string | null
    secondary_customer_id: string | null
  }>(tx, 'projects', selectedProjectId, '项目')
  if (
    project.customer_id !== selectedCustomerId
    && project.secondary_customer_id !== selectedCustomerId
  ) {
    throw new Error('甲供单位不属于所选项目')
  }
}

async function persistHead(
  tx: TransactionDb,
  kind: MaterialFormKind,
  draft: MaterialBaseDraft,
  action: MaterialSaveAction,
  payload: Record<string, unknown>,
): Promise<PersistedHead> {
  const table = TABLE_BY_KIND[kind]
  const id = draft.id ?? generateId(kind)
  const [existing] = await tx.select<ExistingHead>(
    `SELECT id, status, deleted_at FROM "${table}" WHERE id = ? LIMIT 1`,
    [id],
  )
  if (draft.id && (!existing || existing.deleted_at != null))
    throw new Error('记录不存在或已删除')
  if (existing?.status === FINAL_STATUS[kind]) {
    if (action === 'post')
      throw new Error('该单据已完成生效动作，不能重复操作')
    throw new Error('已生效单据不能修改')
  }

  const now = new Date().toISOString()
  const status = action === 'post' ? FINAL_STATUS[kind] : 'draft'
  const valuesByColumn = {
    no: generatedNo(NO_PREFIX[kind], draft.no, id),
    ...payload,
    status,
    note: text(draft.note),
    updated_at: now,
  }
  const columns = Object.keys(valuesByColumn)
  const values = Object.values(valuesByColumn)
  if (existing) {
    const assignments = columns.map(column => `"${column}" = ?`).join(', ')
    const logId = await withUpdateLog(
      tx,
      table,
      id,
      () => tx.execute(
        `UPDATE "${table}" SET ${assignments} WHERE id = ?`,
        [...values, id],
      ),
    )
    return { id, logId }
  }

  const insertColumns = ['id', ...columns, 'created_at']
  const placeholders = insertColumns.map(() => '?').join(', ')
  await tx.execute(
    `INSERT INTO "${table}" (${insertColumns.map(column => `"${column}"`).join(', ')})
     VALUES (${placeholders})`,
    [id, ...values, now],
  )
  return {
    id,
    logId: await logCreate(tx, table, id),
  }
}

async function replaceChildren<T>(
  tx: TransactionDb,
  table: 'material_arrival_lines' | 'stock_check_lines',
  parentColumn: 'arrival_id' | 'stock_check_id',
  parentId: string,
  rows: T[],
  insert: (id: string, row: T, index: number) => Promise<void>,
): Promise<void> {
  const existing = await tx.select<{ id: string }>(
    `SELECT id FROM "${table}" WHERE "${parentColumn}" = ? AND deleted_at IS NULL`,
    [parentId],
  )
  for (const row of existing)
    await softDelete(tx, table, row.id)
  for (const [index, row] of rows.entries()) {
    const id = generateId(table === 'material_arrival_lines' ? 'arrival_line' : 'stock_line')
    await insert(id, row, index)
    await logCreate(tx, table, id)
  }
}

function populatedArrivalLines(
  draft: MaterialArrivalDraft,
  action: MaterialSaveAction,
): MaterialArrivalLineDraft[] {
  const lines: MaterialArrivalLineDraft[] = []
  for (const [index, line] of (draft.lines ?? []).entries()) {
    const materialName = text(line.materialName)
    const qty = Number(line.qty)
    const populated = Boolean(
      materialName
      || text(line.spec)
      || text(line.unit)
      || text(line.note)
      || line.qty != null
      || line.unitPrice != null,
    )
    if (!populated)
      continue
    if (action === 'draft' && (!materialName || !Number.isFinite(qty) || qty <= 0))
      continue
    requireFields([[`第 ${index + 1} 行材料名称`, materialName]])
    positiveNumber(`第 ${index + 1} 行数量`, line.qty)
    nonNegativeNumber(`第 ${index + 1} 行单价`, line.unitPrice)
    lines.push(line)
  }
  return lines
}

function populatedStockCheckLines(
  draft: StockCheckDraft,
  action: MaterialSaveAction,
): StockCheckLineDraft[] {
  const lines: StockCheckLineDraft[] = []
  for (const [index, line] of (draft.lines ?? []).entries()) {
    const materialName = text(line.materialName)
    if (!materialName) {
      if (action !== 'draft' && (
        line.bookQty != null
        || line.actualQty != null
        || line.varianceAmount != null
      )) {
        throw new Error(`第 ${index + 1} 行材料名称不能为空`)
      }
      continue
    }
    nonNegativeNumber(`第 ${index + 1} 行账面量`, line.bookQty)
    nonNegativeNumber(`第 ${index + 1} 行实盘量`, line.actualQty)
    const varianceAmount = Number(line.varianceAmount ?? 0)
    if (!Number.isFinite(varianceAmount))
      throw new Error(`第 ${index + 1} 行盈亏金额必须是数字`)
    lines.push(line)
  }
  return lines
}

async function getMaterialStockSummaryWith(
  db: Pick<TransactionDb, 'select'>,
  warehouse: string,
  materialName: string,
  spec: string,
  unit: string,
): Promise<MaterialStockSummary> {
  const params = [warehouse, materialName, spec, unit]
  const [received] = await db.select<{ qty: number }>(`
    SELECT COALESCE(SUM(line.qty), 0) AS qty
    FROM material_arrivals AS arrival
    JOIN material_arrival_lines AS line ON line.arrival_id = arrival.id
    WHERE arrival.deleted_at IS NULL
      AND line.deleted_at IS NULL
      AND arrival.status = 'posted'
      AND arrival.warehouse = ?
      AND line.material_name = ?
      AND line.spec = ?
      AND line.unit = ?
  `, params)
  const [used] = await db.select<{ qty: number }>(`
    SELECT COALESCE(SUM(qty), 0) AS qty
    FROM material_uses
    WHERE deleted_at IS NULL
      AND status = 'posted'
      AND warehouse = ?
      AND material_name = ?
      AND spec = ?
      AND unit = ?
  `, params)
  const [adjusted] = await db.select<{ qty: number }>(`
    SELECT COALESCE(SUM(line.actual_qty - line.book_qty), 0) AS qty
    FROM stock_checks AS stock_check
    JOIN stock_check_lines AS line ON line.stock_check_id = stock_check.id
    WHERE stock_check.deleted_at IS NULL
      AND line.deleted_at IS NULL
      AND stock_check.status = 'effective'
      AND stock_check.warehouse = ?
      AND line.material_name = ?
      AND line.spec = ?
      AND line.unit = ?
  `, params)
  const receivedQty = Number(received?.qty) || 0
  const usedQty = Number(used?.qty) || 0
  const adjustedQty = Number(adjusted?.qty) || 0
  return {
    receivedQty,
    usedQty,
    adjustedQty,
    availableQty: receivedQty - usedQty + adjustedQty,
  }
}

async function getOwnerMaterialSummaryWith(
  db: Pick<TransactionDb, 'select'>,
  projectId: string,
  materialName: string,
  unit: string,
): Promise<OwnerMaterialSummary> {
  const params = [projectId, materialName, unit]
  const [control] = await db.select<{ qty: number }>(`
    SELECT COALESCE(SUM(control_qty), 0) AS qty
    FROM owner_material_controls
    WHERE deleted_at IS NULL
      AND status = 'effective'
      AND project_id = ?
      AND material_name = ?
      AND unit = ?
  `, params)
  const [arrival] = await db.select<{ qty: number }>(`
    SELECT COALESCE(SUM(qty), 0) AS qty
    FROM owner_material_arrivals
    WHERE deleted_at IS NULL
      AND status = 'posted'
      AND project_id = ?
      AND material_name = ?
      AND unit = ?
  `, params)
  const [use] = await db.select<{ qty: number }>(`
    SELECT COALESCE(SUM(qty), 0) AS qty
    FROM owner_material_uses
    WHERE deleted_at IS NULL
      AND status = 'posted'
      AND project_id = ?
      AND material_name = ?
      AND unit = ?
  `, params)
  const [direct] = await db.select<{ qty: number }>(`
    SELECT COALESCE(SUM(qty), 0) AS qty
    FROM owner_material_directs
    WHERE deleted_at IS NULL
      AND status = 'confirmed'
      AND project_id = ?
      AND material_name = ?
      AND unit = ?
  `, params)
  const controlQty = Number(control?.qty) || 0
  const storedArrivalQty = Number(arrival?.qty) || 0
  const storedUseQty = Number(use?.qty) || 0
  const directQty = Number(direct?.qty) || 0
  return {
    controlQty,
    arrivedQty: storedArrivalQty + directQty,
    usedQty: storedUseQty + directQty,
    remainingQty: controlQty - storedUseQty - directQty,
    stockQty: storedArrivalQty - storedUseQty,
  }
}

async function saveMaterialRequisition(
  tx: TransactionDb,
  draft: MaterialRequisitionDraft,
  action: MaterialSaveAction,
): Promise<PersistedHead> {
  await assertOptionalReference(tx, 'projects', draft.projectId, '项目')
  await assertMaterialContract(tx, draft.contractId, draft.projectId)
  const plannedQty = nonNegativeNumber('计划量', draft.plannedQty)
  if (action === 'post') {
    requireFields([
      ['项目', draft.projectId],
      ['申请人', draft.applicant],
      ['下料日期', draft.requisitionDate],
      ['材料名称', draft.materialName],
      ['单位', draft.unit],
    ])
    if (plannedQty <= 0)
      throw new Error('计划量必须大于 0')
  }
  return persistHead(tx, 'mat_requisition', draft, action, {
    project_id: nullableId(draft.projectId),
    contract_id: nullableId(draft.contractId),
    applicant: text(draft.applicant),
    requisition_date: text(draft.requisitionDate),
    required_date: text(draft.requiredDate),
    material_name: text(draft.materialName),
    spec: text(draft.spec),
    unit: text(draft.unit),
    planned_qty: plannedQty,
    warehouse: text(draft.warehouse),
    purpose: text(draft.purpose),
  })
}

async function saveMaterialArrival(
  tx: TransactionDb,
  draft: MaterialArrivalDraft,
  action: MaterialSaveAction,
): Promise<PersistedHead> {
  await assertOptionalReference(tx, 'projects', draft.projectId, '项目')
  await assertOptionalReference(tx, 'suppliers', draft.supplierId, '分供方')
  await assertProjectSupplier(tx, draft.projectId, draft.supplierId)
  await assertMaterialContract(tx, draft.contractId, draft.projectId, draft.supplierId)
  if (draft.requisitionId) {
    const requisition = await assertReference<{
      project_id: string | null
      contract_id: string | null
    }>(tx, 'material_requisitions', draft.requisitionId, '关联下料单')
    if (requisition.project_id !== nullableId(draft.projectId))
      throw new Error('关联下料单不属于所选项目')
    if (
      draft.contractId
      && requisition.contract_id
      && requisition.contract_id !== nullableId(draft.contractId)
    ) {
      throw new Error('关联下料单与材料采购合同不一致')
    }
  }
  const lines = populatedArrivalLines(draft, action)
  if (action === 'post') {
    requireFields([
      ['项目', draft.projectId],
      ['分供方', draft.supplierId],
      ['到货仓库', draft.warehouse],
      ['到货日期', draft.arrivalDate],
    ])
    if (!lines.length)
      throw new Error('至少需要一条有效到货明细')
  }
  const result = await persistHead(tx, 'mat_arrival', draft, action, {
    project_id: nullableId(draft.projectId),
    supplier_id: nullableId(draft.supplierId),
    contract_id: nullableId(draft.contractId),
    requisition_id: nullableId(draft.requisitionId),
    warehouse: text(draft.warehouse),
    arrival_date: text(draft.arrivalDate),
    receiver: text(draft.receiver),
    quality_result: text(draft.qualityResult),
    stock_status: action === 'post' ? 'stored' : text(draft.stockStatus),
  })
  const now = new Date().toISOString()
  await replaceChildren(
    tx,
    'material_arrival_lines',
    'arrival_id',
    result.id,
    lines,
    async (id, line, index) => {
      await tx.execute(`
        INSERT INTO material_arrival_lines (
          id, arrival_id, material_name, spec, unit, qty, unit_price,
          note, sort_order, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        id,
        result.id,
        text(line.materialName),
        text(line.spec),
        text(line.unit),
        positiveNumber(`第 ${index + 1} 行数量`, line.qty),
        line.unitPrice == null ? null : nonNegativeNumber(`第 ${index + 1} 行单价`, line.unitPrice),
        text(line.note),
        index,
        now,
        now,
      ])
    },
  )
  return result
}

async function saveMaterialUse(
  tx: TransactionDb,
  draft: MaterialUseDraft,
  action: MaterialSaveAction,
): Promise<PersistedHead> {
  await assertOptionalReference(tx, 'projects', draft.projectId, '项目')
  await assertOptionalReference(tx, 'crews', draft.crewId, '领用班组')
  const qty = nonNegativeNumber('领用数量', draft.qty)
  if (action === 'post') {
    requireFields([
      ['项目', draft.projectId],
      ['领用仓库', draft.warehouse],
      ['领用日期', draft.useDate],
      ['材料名称', draft.materialName],
      ['单位', draft.unit],
      ['领用人', draft.receiver],
    ])
    if (qty <= 0)
      throw new Error('领用数量必须大于 0')
    const stock = await getMaterialStockSummaryWith(
      tx,
      text(draft.warehouse),
      text(draft.materialName),
      text(draft.spec),
      text(draft.unit),
    )
    if (qty > stock.availableQty + 0.0001)
      throw new Error(`库存不足，当前可用 ${stock.availableQty}`)
  }
  return persistHead(tx, 'mat_use', draft, action, {
    project_id: nullableId(draft.projectId),
    warehouse: text(draft.warehouse),
    use_date: text(draft.useDate),
    material_name: text(draft.materialName),
    spec: text(draft.spec),
    unit: text(draft.unit),
    qty,
    receiver: text(draft.receiver),
    crew_id: nullableId(draft.crewId),
    purpose: text(draft.purpose),
  })
}

async function saveStockCheck(
  tx: TransactionDb,
  draft: StockCheckDraft,
  action: MaterialSaveAction,
): Promise<PersistedHead> {
  const lines = populatedStockCheckLines(draft, action)
  if (action === 'post') {
    requireFields([
      ['仓库', draft.warehouse],
      ['盘点人', draft.checker],
      ['盘点日期', draft.checkDate],
    ])
    if (!lines.length)
      throw new Error('至少需要一条盘点明细')
    const keys = new Set<string>()
    for (const [index, line] of lines.entries()) {
      const key = [text(line.materialName), text(line.spec), text(line.unit)].join('\u001F')
      if (keys.has(key))
        throw new Error(`第 ${index + 1} 行材料规格重复`)
      keys.add(key)
      const stock = await getMaterialStockSummaryWith(
        tx,
        text(draft.warehouse),
        text(line.materialName),
        text(line.spec),
        text(line.unit),
      )
      const bookQty = nonNegativeNumber(`第 ${index + 1} 行账面量`, line.bookQty)
      if (!almostEqual(bookQty, stock.availableQty))
        throw new Error(`第 ${index + 1} 行账面量已变化，当前应为 ${stock.availableQty}`)
    }
  }
  const result = await persistHead(tx, 'stock_check', draft, action, {
    warehouse: text(draft.warehouse),
    checker: text(draft.checker),
    check_date: text(draft.checkDate),
  })
  const now = new Date().toISOString()
  await replaceChildren(
    tx,
    'stock_check_lines',
    'stock_check_id',
    result.id,
    lines,
    async (id, line, index) => {
      await tx.execute(`
        INSERT INTO stock_check_lines (
          id, stock_check_id, material_name, spec, unit, book_qty,
          actual_qty, variance_amount, sort_order, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        id,
        result.id,
        text(line.materialName),
        text(line.spec),
        text(line.unit),
        nonNegativeNumber(`第 ${index + 1} 行账面量`, line.bookQty),
        nonNegativeNumber(`第 ${index + 1} 行实盘量`, line.actualQty),
        Number(line.varianceAmount ?? 0),
        index,
        now,
        now,
      ])
    },
  )
  return result
}

async function saveOwnerControl(
  tx: TransactionDb,
  draft: OwnerMaterialControlDraft,
  action: MaterialSaveAction,
): Promise<PersistedHead> {
  await assertOptionalReference(tx, 'projects', draft.projectId, '项目')
  await assertOptionalReference(tx, 'customers', draft.customerId, '甲供单位')
  await assertProjectCustomer(tx, draft.projectId, draft.customerId)
  const controlQty = nonNegativeNumber('总控量', draft.controlQty)
  if (action === 'post') {
    requireFields([
      ['项目', draft.projectId],
      ['甲供单位', draft.customerId],
      ['甲供材料', draft.materialName],
      ['单位', draft.unit],
    ])
    if (controlQty <= 0)
      throw new Error('总控量必须大于 0')
    const summary = await getOwnerMaterialSummaryWith(
      tx,
      text(draft.projectId),
      text(draft.materialName),
      text(draft.unit),
    )
    if (summary.controlQty > 0)
      throw new Error('同一项目、材料和单位已存在生效总控量')
    if (controlQty + 0.0001 < summary.usedQty)
      throw new Error('总控量不能小于已领用量')
  }
  return persistHead(tx, 'owner_control', draft, action, {
    project_id: nullableId(draft.projectId),
    customer_id: nullableId(draft.customerId),
    material_name: text(draft.materialName),
    spec: text(draft.spec),
    unit: text(draft.unit),
    control_qty: controlQty,
  })
}

async function saveOwnerRequisition(
  tx: TransactionDb,
  draft: OwnerMaterialRequisitionDraft,
  action: MaterialSaveAction,
): Promise<PersistedHead> {
  await assertOptionalReference(tx, 'projects', draft.projectId, '项目')
  const plannedQty = nonNegativeNumber('计划量', draft.plannedQty)
  if (action === 'post') {
    requireFields([
      ['项目', draft.projectId],
      ['申请人', draft.applicant],
      ['申请日期', draft.applicationDate],
      ['甲供材料', draft.materialName],
      ['单位', draft.unit],
    ])
    if (plannedQty <= 0)
      throw new Error('计划量必须大于 0')
  }
  return persistHead(tx, 'owner_requisition', draft, action, {
    project_id: nullableId(draft.projectId),
    applicant: text(draft.applicant),
    application_date: text(draft.applicationDate),
    required_date: text(draft.requiredDate),
    material_name: text(draft.materialName),
    spec: text(draft.spec),
    unit: text(draft.unit),
    planned_qty: plannedQty,
  })
}

async function saveOwnerArrival(
  tx: TransactionDb,
  draft: OwnerMaterialArrivalDraft,
  action: MaterialSaveAction,
): Promise<PersistedHead> {
  await assertOptionalReference(tx, 'projects', draft.projectId, '项目')
  const qty = nonNegativeNumber('到货数量', draft.qty)
  if (action === 'post') {
    requireFields([
      ['项目', draft.projectId],
      ['仓库', draft.warehouse],
      ['到货日期', draft.arrivalDate],
      ['甲供材料', draft.materialName],
      ['单位', draft.unit],
    ])
    if (qty <= 0)
      throw new Error('到货数量必须大于 0')
    const summary = await getOwnerMaterialSummaryWith(
      tx,
      text(draft.projectId),
      text(draft.materialName),
      text(draft.unit),
    )
    if (summary.controlQty <= 0)
      throw new Error('请先建立并生效甲供材总控量')
    if (summary.arrivedQty + qty > summary.controlQty + 0.0001)
      throw new Error(`到货数量超过总控量，剩余可到 ${summary.controlQty - summary.arrivedQty}`)
  }
  return persistHead(tx, 'owner_arrival', draft, action, {
    project_id: nullableId(draft.projectId),
    warehouse: text(draft.warehouse),
    arrival_date: text(draft.arrivalDate),
    receiver: text(draft.receiver),
    material_name: text(draft.materialName),
    spec: text(draft.spec),
    unit: text(draft.unit),
    qty,
    quality_result: text(draft.qualityResult),
    stock_status: action === 'post' ? 'stored' : text(draft.stockStatus),
  })
}

async function saveOwnerUse(
  tx: TransactionDb,
  draft: OwnerMaterialUseDraft,
  action: MaterialSaveAction,
): Promise<PersistedHead> {
  await assertOptionalReference(tx, 'projects', draft.projectId, '项目')
  await assertOptionalReference(tx, 'crews', draft.crewId, '领用班组')
  const qty = nonNegativeNumber('领用数量', draft.qty)
  if (action === 'post') {
    requireFields([
      ['项目', draft.projectId],
      ['领用日期', draft.useDate],
      ['甲供材料', draft.materialName],
      ['单位', draft.unit],
      ['领用人', draft.receiver],
    ])
    if (qty <= 0)
      throw new Error('领用数量必须大于 0')
    const summary = await getOwnerMaterialSummaryWith(
      tx,
      text(draft.projectId),
      text(draft.materialName),
      text(draft.unit),
    )
    if (qty > summary.stockQty + 0.0001)
      throw new Error(`甲供材库存不足，当前可用 ${summary.stockQty}`)
    if (qty > summary.remainingQty + 0.0001)
      throw new Error(`甲供材总控余量不足，当前剩余 ${summary.remainingQty}`)
  }
  return persistHead(tx, 'owner_use', draft, action, {
    project_id: nullableId(draft.projectId),
    use_date: text(draft.useDate),
    material_name: text(draft.materialName),
    unit: text(draft.unit),
    qty,
    receiver: text(draft.receiver),
    crew_id: nullableId(draft.crewId),
    purpose: text(draft.purpose),
  })
}

async function saveOwnerDirect(
  tx: TransactionDb,
  draft: OwnerMaterialDirectDraft,
  action: MaterialSaveAction,
): Promise<PersistedHead> {
  await assertOptionalReference(tx, 'projects', draft.projectId, '项目')
  await assertOptionalReference(tx, 'customers', draft.customerId, '甲供单位')
  await assertProjectCustomer(tx, draft.projectId, draft.customerId)
  const qty = nonNegativeNumber('直入直出数量', draft.qty)
  if (action === 'post') {
    requireFields([
      ['项目', draft.projectId],
      ['甲供单位', draft.customerId],
      ['日期', draft.transactionDate],
      ['甲供材料', draft.materialName],
      ['单位', draft.unit],
      ['使用部位', draft.useLocation],
    ])
    if (qty <= 0)
      throw new Error('直入直出数量必须大于 0')
    const summary = await getOwnerMaterialSummaryWith(
      tx,
      text(draft.projectId),
      text(draft.materialName),
      text(draft.unit),
    )
    if (summary.controlQty <= 0)
      throw new Error('请先建立并生效甲供材总控量')
    if (qty > summary.remainingQty + 0.0001)
      throw new Error(`甲供材总控余量不足，当前剩余 ${summary.remainingQty}`)
  }
  return persistHead(tx, 'owner_direct', draft, action, {
    project_id: nullableId(draft.projectId),
    customer_id: nullableId(draft.customerId),
    transaction_date: text(draft.transactionDate),
    material_name: text(draft.materialName),
    unit: text(draft.unit),
    qty,
    purpose: text(draft.purpose),
    use_location: text(draft.useLocation),
  })
}

export async function saveMaterialForm(
  kind: MaterialFormKind,
  draft: MaterialFormDraft,
  action: MaterialSaveAction,
  attachments: FileRefChanges = {},
): Promise<MaterialSaveResult> {
  return withTransaction(async (tx) => {
    let result: PersistedHead
    switch (kind) {
      case 'mat_requisition':
        result = await saveMaterialRequisition(tx, draft as MaterialRequisitionDraft, action)
        break
      case 'mat_arrival':
        result = await saveMaterialArrival(tx, draft as MaterialArrivalDraft, action)
        break
      case 'mat_use':
        result = await saveMaterialUse(tx, draft as MaterialUseDraft, action)
        break
      case 'stock_check':
        result = await saveStockCheck(tx, draft as StockCheckDraft, action)
        break
      case 'owner_control':
        result = await saveOwnerControl(tx, draft as OwnerMaterialControlDraft, action)
        break
      case 'owner_requisition':
        result = await saveOwnerRequisition(tx, draft as OwnerMaterialRequisitionDraft, action)
        break
      case 'owner_arrival':
        result = await saveOwnerArrival(tx, draft as OwnerMaterialArrivalDraft, action)
        break
      case 'owner_use':
        result = await saveOwnerUse(tx, draft as OwnerMaterialUseDraft, action)
        break
      case 'owner_direct':
        result = await saveOwnerDirect(tx, draft as OwnerMaterialDirectDraft, action)
        break
    }
    const ownerType = OWNER_TYPE[kind]
    const hasAttachmentChanges = Boolean(
      attachments.add?.length
      || attachments.removeIds?.length
      || attachments.restoreIds?.length,
    )
    if (!ownerType && hasAttachmentChanges)
      throw new Error('当前表单不支持附件')
    const attachmentIds = ownerType
      ? await applyFileRefChanges(tx, ownerType, result.id, attachments)
      : []
    return {
      ...result,
      attachmentIds,
    }
  })
}

async function loadArrivalLines(id: string): Promise<MaterialArrivalLineDraft[]> {
  const rows = await select<Record<string, unknown>>(`
    SELECT *
    FROM material_arrival_lines
    WHERE arrival_id = ? AND deleted_at IS NULL
    ORDER BY sort_order, id
  `, [id])
  return rows.map(row => ({
    id: rowText(row, 'id'),
    materialName: rowText(row, 'material_name'),
    spec: rowText(row, 'spec'),
    unit: rowText(row, 'unit'),
    qty: rowNumber(row, 'qty'),
    unitPrice: row.unit_price == null ? null : rowNumber(row, 'unit_price'),
    note: rowText(row, 'note'),
  }))
}

async function loadStockCheckLines(id: string): Promise<StockCheckLineDraft[]> {
  const rows = await select<Record<string, unknown>>(`
    SELECT *
    FROM stock_check_lines
    WHERE stock_check_id = ? AND deleted_at IS NULL
    ORDER BY sort_order, id
  `, [id])
  return rows.map(row => ({
    id: rowText(row, 'id'),
    materialName: rowText(row, 'material_name'),
    spec: rowText(row, 'spec'),
    unit: rowText(row, 'unit'),
    bookQty: rowNumber(row, 'book_qty'),
    actualQty: rowNumber(row, 'actual_qty'),
    varianceAmount: rowNumber(row, 'variance_amount'),
  }))
}

async function materialRequisitionSummary(id: string): Promise<MaterialRequisitionSummary> {
  const [row] = await select<{ planned_qty: number, arrived_qty: number }>(`
    SELECT
      requisition.planned_qty,
      COALESCE(SUM(
        CASE WHEN arrival.status = 'posted' AND arrival.deleted_at IS NULL
          THEN line.qty ELSE 0 END
      ), 0) AS arrived_qty
    FROM material_requisitions AS requisition
    LEFT JOIN material_arrivals AS arrival
      ON arrival.requisition_id = requisition.id
    LEFT JOIN material_arrival_lines AS line
      ON line.arrival_id = arrival.id AND line.deleted_at IS NULL
    WHERE requisition.id = ?
    GROUP BY requisition.id
  `, [id])
  const plannedQty = Number(row?.planned_qty) || 0
  const arrivedQty = Number(row?.arrived_qty) || 0
  return {
    plannedQty,
    arrivedQty,
    remainingQty: plannedQty - arrivedQty,
  }
}

function arrivalSummary(lines: MaterialArrivalLineDraft[]): MaterialArrivalSummary {
  const names = [...new Set(lines.map(line => text(line.materialName)).filter(Boolean))]
  return {
    materialSummary: names.join('、').slice(0, 30),
    totalQty: lines.reduce((sum, line) => sum + (Number(line.qty) || 0), 0),
    totalAmount: lines.reduce(
      (sum, line) => sum + (Number(line.qty) || 0) * (Number(line.unitPrice) || 0),
      0,
    ),
  }
}

function stockCheckSummary(lines: StockCheckLineDraft[]): StockCheckSummary {
  return {
    itemCount: lines.length,
    varianceQty: lines.reduce(
      (sum, line) => sum + (Number(line.actualQty) || 0) - (Number(line.bookQty) || 0),
      0,
    ),
    varianceAmount: lines.reduce(
      (sum, line) => sum + (Number(line.varianceAmount) || 0),
      0,
    ),
  }
}

async function mapMaterialRow(
  kind: MaterialFormKind,
  row: Record<string, unknown>,
): Promise<MaterialFormRecordMap[MaterialFormKind]> {
  const base = {
    id: rowText(row, 'id'),
    no: rowText(row, 'no'),
    status: rowText(row, 'status'),
    note: rowText(row, 'note'),
  }
  switch (kind) {
    case 'mat_requisition': {
      const summary = await materialRequisitionSummary(base.id)
      return {
        ...base,
        projectId: rowNullableText(row, 'project_id'),
        contractId: rowNullableText(row, 'contract_id'),
        applicant: rowText(row, 'applicant'),
        requisitionDate: rowText(row, 'requisition_date'),
        requiredDate: rowText(row, 'required_date'),
        materialName: rowText(row, 'material_name'),
        spec: rowText(row, 'spec'),
        unit: rowText(row, 'unit'),
        warehouse: rowText(row, 'warehouse'),
        purpose: rowText(row, 'purpose'),
        ...summary,
      }
    }
    case 'mat_arrival': {
      const lines = await loadArrivalLines(base.id)
      return {
        ...base,
        projectId: rowNullableText(row, 'project_id'),
        supplierId: rowNullableText(row, 'supplier_id'),
        contractId: rowNullableText(row, 'contract_id'),
        requisitionId: rowNullableText(row, 'requisition_id'),
        warehouse: rowText(row, 'warehouse'),
        arrivalDate: rowText(row, 'arrival_date'),
        receiver: rowText(row, 'receiver'),
        qualityResult: rowText(row, 'quality_result'),
        stockStatus: rowText(row, 'stock_status'),
        lines,
        ...arrivalSummary(lines),
      }
    }
    case 'mat_use':
      return {
        ...base,
        projectId: rowNullableText(row, 'project_id'),
        warehouse: rowText(row, 'warehouse'),
        useDate: rowText(row, 'use_date'),
        materialName: rowText(row, 'material_name'),
        spec: rowText(row, 'spec'),
        unit: rowText(row, 'unit'),
        qty: rowNumber(row, 'qty'),
        receiver: rowText(row, 'receiver'),
        crewId: rowNullableText(row, 'crew_id'),
        purpose: rowText(row, 'purpose'),
      }
    case 'stock_check': {
      const lines = await loadStockCheckLines(base.id)
      return {
        ...base,
        warehouse: rowText(row, 'warehouse'),
        checker: rowText(row, 'checker'),
        checkDate: rowText(row, 'check_date'),
        lines,
        ...stockCheckSummary(lines),
      }
    }
    case 'owner_control': {
      const projectId = rowNullableText(row, 'project_id')
      const materialName = rowText(row, 'material_name')
      const unit = rowText(row, 'unit')
      const summary = projectId
        ? await getOwnerMaterialSummary(projectId, materialName, unit)
        : {
            controlQty: rowNumber(row, 'control_qty'),
            arrivedQty: 0,
            usedQty: 0,
            remainingQty: rowNumber(row, 'control_qty'),
            stockQty: 0,
          }
      return {
        ...base,
        projectId,
        customerId: rowNullableText(row, 'customer_id'),
        materialName,
        spec: rowText(row, 'spec'),
        unit,
        ...summary,
        controlQty: rowNumber(row, 'control_qty'),
      }
    }
    case 'owner_requisition':
      return {
        ...base,
        projectId: rowNullableText(row, 'project_id'),
        applicant: rowText(row, 'applicant'),
        applicationDate: rowText(row, 'application_date'),
        requiredDate: rowText(row, 'required_date'),
        materialName: rowText(row, 'material_name'),
        spec: rowText(row, 'spec'),
        unit: rowText(row, 'unit'),
        plannedQty: rowNumber(row, 'planned_qty'),
      }
    case 'owner_arrival':
      return {
        ...base,
        projectId: rowNullableText(row, 'project_id'),
        warehouse: rowText(row, 'warehouse'),
        arrivalDate: rowText(row, 'arrival_date'),
        receiver: rowText(row, 'receiver'),
        materialName: rowText(row, 'material_name'),
        spec: rowText(row, 'spec'),
        unit: rowText(row, 'unit'),
        qty: rowNumber(row, 'qty'),
        qualityResult: rowText(row, 'quality_result'),
        stockStatus: rowText(row, 'stock_status'),
      }
    case 'owner_use':
      return {
        ...base,
        projectId: rowNullableText(row, 'project_id'),
        useDate: rowText(row, 'use_date'),
        materialName: rowText(row, 'material_name'),
        unit: rowText(row, 'unit'),
        qty: rowNumber(row, 'qty'),
        receiver: rowText(row, 'receiver'),
        crewId: rowNullableText(row, 'crew_id'),
        purpose: rowText(row, 'purpose'),
      }
    case 'owner_direct':
      return {
        ...base,
        projectId: rowNullableText(row, 'project_id'),
        customerId: rowNullableText(row, 'customer_id'),
        transactionDate: rowText(row, 'transaction_date'),
        materialName: rowText(row, 'material_name'),
        unit: rowText(row, 'unit'),
        qty: rowNumber(row, 'qty'),
        purpose: rowText(row, 'purpose'),
        useLocation: rowText(row, 'use_location'),
      }
  }
}

export async function loadMaterialForm<K extends MaterialFormKind>(
  kind: K,
  id: string,
  includeDeleted = false,
): Promise<MaterialFormRecordMap[K] | null> {
  const table = TABLE_BY_KIND[kind]
  const rows = await select<Record<string, unknown>>(
    `SELECT * FROM "${table}" WHERE id = ?
      ${includeDeleted ? '' : 'AND deleted_at IS NULL'}
     LIMIT 1`,
    [id],
  )
  if (!rows[0])
    return null
  return await mapMaterialRow(kind, rows[0]) as MaterialFormRecordMap[K]
}

export async function listMaterialForms<K extends MaterialFormKind>(
  kind: K,
  includeDeleted = false,
): Promise<MaterialFormRecordMap[K][]> {
  const table = TABLE_BY_KIND[kind]
  const rows = await select<Record<string, unknown>>(`
    SELECT *
    FROM "${table}"
    ${includeDeleted ? '' : 'WHERE deleted_at IS NULL'}
    ORDER BY created_at DESC, id DESC
  `)
  return Promise.all(rows.map(async row =>
    await mapMaterialRow(kind, row) as MaterialFormRecordMap[K],
  ))
}

export async function getMaterialStockSummary(
  warehouse: string,
  materialName: string,
  spec = '',
  unit = '',
): Promise<MaterialStockSummary> {
  return getMaterialStockSummaryWith(
    { select },
    text(warehouse),
    text(materialName),
    text(spec),
    text(unit),
  )
}

export async function getOwnerMaterialSummary(
  projectId: string,
  materialName: string,
  unit: string,
): Promise<OwnerMaterialSummary> {
  return getOwnerMaterialSummaryWith(
    { select },
    text(projectId),
    text(materialName),
    text(unit),
  )
}

export async function listMaterialFormAttachments(
  kind: MaterialFormKind,
  id: string,
  includeDeleted = false,
): Promise<FileRefRecord[]> {
  const ownerType = OWNER_TYPE[kind]
  if (!ownerType)
    return []
  return listFileRefs(ownerType, id, includeDeleted)
}

export function materialFormIsFinal(
  kind: MaterialFormKind,
  status: string | null | undefined,
): boolean {
  return status === FINAL_STATUS[kind]
}

export function materialFormSupportsAttachments(kind: MaterialFormKind): boolean {
  return Boolean(OWNER_TYPE[kind])
}

export async function updateMaterialFormAttachments(
  kind: MaterialFormKind,
  id: string,
  changes: FileRefChanges,
): Promise<string[]> {
  const ownerType = OWNER_TYPE[kind]
  if (!ownerType)
    throw new Error('当前表单不支持附件')
  return withTransaction(async (tx) => {
    await assertReference(tx, TABLE_BY_KIND[kind], id, '单据')
    return applyFileRefChanges(tx, ownerType, id, changes)
  })
}

export async function deleteMaterialForm(
  kind: MaterialFormKind,
  id: string,
): Promise<string | null> {
  return withTransaction(tx => softDelete(tx, TABLE_BY_KIND[kind], id))
}

export async function restoreMaterialForm(
  kind: MaterialFormKind,
  id: string,
): Promise<string | null> {
  return withTransaction(tx => restoreRecord(tx, TABLE_BY_KIND[kind], id))
}
