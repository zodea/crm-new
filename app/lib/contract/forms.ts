import type { TransactionDb } from '~/lib/db/coordinator'
import type { LookupOption } from '~/lib/kit/lookup'
import { select, withTransaction } from '~/lib/db/connection'
import {
  hiddenCtesFor,
  logCreate,
  PARENT_REFS,
  restoreRecord,
  selectVisibleSql,
  softDelete,
  visibleCond,
  withUpdateLog,
} from '~/lib/db/soft-delete'
import { generateId } from '~/lib/util/id'

export type F2FormKind
  = | 'construction'
    | 'subcontract'
    | 'material'
    | 'other_expense'
    | 'company_expense'
    | 'other_settlement'
    | 'material_settlement'

export type F2SaveAction = 'draft' | 'save' | 'submit'

export type ContractAttachmentOwnerType
  = | 'contract'
    | 'contract_supplement'
    | 'company_expense_contract'
    | 'expenditure_settlement'

export interface ContractFormAttachmentDraft {
  fileName: string
  filePath?: string
  fileSize?: number
  mimeType?: string
  category?: string
  uploader?: string
}

export interface ContractFormAttachmentChanges {
  add?: ContractFormAttachmentDraft[]
  removeIds?: string[]
  restoreIds?: string[]
}

export interface ContractFormAttachment {
  id: string
  ownerType: ContractAttachmentOwnerType
  ownerId: string
  fileName: string
  filePath: string
  fileSize: number
  mimeType: string
  category: string
  uploader: string
  uploadedAt: string
  deletedAt: string | null
}

export interface ContractLineItemDraft {
  id?: string
  materialName?: string
  spec?: string
  brand?: string
  unit?: string
  qty?: number | null
  taxInclusiveUnitPrice?: number | null
  plannedArrivalDate?: string
  note?: string
  sortOrder?: number
}

export interface ProjectContractFormDraft {
  id?: string
  isSupplement?: boolean
  originalContractId?: string | null
  no?: string
  name?: string
  projectId?: string | null
  customerId?: string | null
  supplierId?: string | null
  subKind?: string
  content?: string
  invoiceType?: string
  contactName?: string
  contactPhone?: string
  taxRate?: number | null
  signDate?: string
  mainTerms?: string
  paymentTerms?: string
  brandQualityTerms?: string
  scheduleTerms?: string
  warrantyTerms?: string
  specialTerms?: string
  retentionRatio?: number | null
  retentionAmount?: number | null
  retentionDays?: number | null
  invoiceName?: string
  invoiceTaxNo?: string
  invoiceAddressPhone?: string
  invoiceBank?: string
  invoiceBankAccount?: string
  otherExpenseKind?: string
  servicePeriod?: string
  paymentCycle?: string
  amount?: number | null
  status?: string
  note?: string
  lineItems?: ContractLineItemDraft[]
}

export interface CompanyExpenseContractFormDraft {
  id?: string
  no?: string
  name?: string
  category?: string
  counterparty?: string
  signDate?: string
  servicePeriod?: string
  amount?: number | null
  paymentCycle?: string
  mainTerms?: string
  status?: string
  note?: string
}

export interface ExpenditureSettlementFormDraft {
  id?: string
  no?: string
  name?: string
  projectId?: string | null
  contractId?: string | null
  settlementType?: string
  totalAmount?: number | null
  amount?: number | null
  taxAmount?: number | null
  taxRate?: number | null
  settlementDate?: string
  settlementPeriod?: string
  deductionNote?: string
  status?: string
  note?: string
}

export type F2FormDraft
  = | ProjectContractFormDraft
    | CompanyExpenseContractFormDraft
    | ExpenditureSettlementFormDraft

export interface F2FormSaveResult {
  id: string
  logId: string | null
  attachmentIds: string[]
}

interface ContractReferenceRow {
  id: string
  kind: string
  sub_kind: string
  cost_category: string
  project_id: string | null
  customer_id: string | null
  supplier_id: string | null
  amount: number
  deleted_at: string | null
}

const PROJECT_FORM_KINDS = new Set<F2FormKind>([
  'construction',
  'subcontract',
  'material',
  'other_expense',
])

function normalizedText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function rawText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function nullableText(value: unknown): string | null {
  const valueText = normalizedText(value)
  return valueText || null
}

function nullableNumber(value: unknown): number | null {
  if (value === '' || value == null)
    return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function nonNegativeNumber(label: string, value: unknown): number {
  const number = nullableNumber(value) ?? 0
  if (number < 0)
    throw new Error(`${label}不能为负数`)
  return number
}

function requireFields(fields: Array<[label: string, value: unknown]>): void {
  const missing = fields.filter(([, value]) => !normalizedText(value))
  if (missing.length)
    throw new Error(`${missing[0]![0]}：为必填项（共 ${missing.length} 处）`)
}

function lifecycleStatus(
  action: F2SaveAction,
  current: string | undefined,
  submittedStatus: string,
): string {
  if (action === 'draft')
    return '草稿'
  if (action === 'submit')
    return submittedStatus
  if (current === 'draft')
    return '草稿'
  if (current === 'submitted')
    return '审批中'
  return current || '草稿'
}

async function activeRow<T>(
  tx: TransactionDb,
  table: string,
  id: string | null | undefined,
): Promise<T | null> {
  if (!id)
    return null
  const rows = await tx.select<T>(
    selectVisibleSql(table, 'AND id = ? LIMIT 1'),
    [id],
  )
  return rows[0] ?? null
}

async function assertActiveReference(
  tx: TransactionDb,
  table: string,
  id: string | null | undefined,
  label: string,
): Promise<void> {
  if (!id)
    return
  const row = await activeRow<{ id: string }>(tx, table, id)
  if (!row)
    throw new Error(`${label}不存在或已删除`)
}

async function assertProjectCustomerRelation(
  tx: TransactionDb,
  projectId: string | null | undefined,
  customerId: string | null | undefined,
): Promise<void> {
  if (!projectId || !customerId)
    return
  const [project] = await tx.select<{ customer_id: string | null }>(`
    SELECT customer_id
    FROM projects
    WHERE id = ? AND deleted_at IS NULL
  `, [projectId])
  if (!project)
    throw new Error('项目不存在或已删除')
  if (project.customer_id !== customerId)
    throw new Error('甲方客户与所选项目不一致')
}

export function contractLineItemAmount(line: ContractLineItemDraft): number {
  return (nullableNumber(line.qty) ?? 0)
    * (nullableNumber(line.taxInclusiveUnitPrice) ?? 0)
}

export function contractLineItemsTotal(lines: ContractLineItemDraft[] = []): number {
  return lines.reduce((total, line) => total + contractLineItemAmount(line), 0)
}

function validateLineItems(
  lines: ContractLineItemDraft[],
  action: F2SaveAction,
): void {
  for (const [index, line] of lines.entries()) {
    const qty = nullableNumber(line.qty)
    const price = nullableNumber(line.taxInclusiveUnitPrice)
    if (qty != null && qty <= 0)
      throw new Error(`第 ${index + 1} 行数量必须大于 0`)
    if (price != null && price < 0)
      throw new Error(`第 ${index + 1} 行含税单价不能为负数`)
    if (action === 'submit') {
      requireFields([
        [`第 ${index + 1} 行物资名称`, line.materialName],
        [`第 ${index + 1} 行数量`, qty == null ? '' : String(qty)],
        [`第 ${index + 1} 行含税单价`, price == null ? '' : String(price)],
      ])
    }
  }
}

function projectContractKind(kind: F2FormKind): {
  kind: '施工' | '分包' | '材采' | '其他支出'
  costCategory: '' | '专业分包' | '合同劳务' | '材料' | '机械' | '其他'
} {
  switch (kind) {
    case 'construction':
      return { kind: '施工', costCategory: '' }
    case 'subcontract':
      return { kind: '分包', costCategory: '专业分包' }
    case 'material':
      return { kind: '材采', costCategory: '材料' }
    case 'other_expense':
      return { kind: '其他支出', costCategory: '其他' }
    default:
      throw new Error(`不支持的项目合同表单：${kind}`)
  }
}

async function validateProjectContract(
  tx: TransactionDb,
  formKind: F2FormKind,
  draft: ProjectContractFormDraft,
  action: F2SaveAction,
): Promise<void> {
  const amount = nonNegativeNumber('含税合同金额', draft.amount)
  const taxRate = nullableNumber(draft.taxRate)
  if (taxRate != null && taxRate < 0)
    throw new Error('税率不能为负数')
  const retentionRatio = nullableNumber(draft.retentionRatio)
  if (retentionRatio != null && (retentionRatio < 0 || retentionRatio > 1))
    throw new Error('质保金比例必须在 0 到 1 之间')
  nonNegativeNumber('质保金金额', draft.retentionAmount)
  nonNegativeNumber('质保期', draft.retentionDays)

  if (draft.isSupplement) {
    await assertActiveReference(
      tx,
      'contracts',
      draft.originalContractId,
      '原合同',
    )
    if (action === 'submit') {
      requireFields([
        ['原合同', draft.originalContractId],
        ['协议名称', draft.name],
        ['协议内容', draft.content],
        ['签约日期', draft.signDate],
      ])
    }
    return
  }

  await assertActiveReference(tx, 'projects', draft.projectId, '项目')
  if (formKind === 'construction') {
    await assertActiveReference(tx, 'customers', draft.customerId, '甲方客户')
    await assertProjectCustomerRelation(tx, draft.projectId, draft.customerId)
  }
  else {
    await assertActiveReference(tx, 'suppliers', draft.supplierId, '分供方')
  }

  const lines = formKind === 'material' ? draft.lineItems ?? [] : []
  validateLineItems(lines, action)
  if (
    action === 'submit'
    && formKind === 'material'
    && Math.abs(contractLineItemsTotal(lines) - amount) > 0.005
  ) {
    throw new Error('材采明细含税汇总与合同头金额不一致')
  }

  if (action === 'submit') {
    requireFields([
      ['合同名称', draft.name],
      ['项目', draft.projectId],
      [
        formKind === 'construction' ? '甲方客户' : '分供方',
        formKind === 'construction' ? draft.customerId : draft.supplierId,
      ],
      ['合同内容简述', draft.content],
      ['签约日期', draft.signDate],
    ])
  }
}

async function applyAttachmentChanges(
  tx: TransactionDb,
  ownerType: ContractAttachmentOwnerType,
  ownerId: string,
  changes: ContractFormAttachmentChanges = {},
): Promise<string[]> {
  const attachmentIds: string[] = []
  for (const attachmentId of changes.removeIds ?? []) {
    await assertAttachmentOwner(tx, ownerType, ownerId, attachmentId)
    await softDelete(tx, 'file_refs', attachmentId)
  }
  for (const attachmentId of changes.restoreIds ?? []) {
    await assertAttachmentOwner(tx, ownerType, ownerId, attachmentId)
    await restoreRecord(tx, 'file_refs', attachmentId)
  }
  for (const attachment of changes.add ?? []) {
    const fileName = normalizedText(attachment.fileName)
    if (!fileName)
      throw new Error('附件文件名必填')
    const id = generateId('file')
    await tx.execute(`
      INSERT INTO file_refs (
        id, owner_type, owner_id, file_name, file_path, file_size,
        category, uploader, uploaded_at, mime_type
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      ownerType,
      ownerId,
      fileName,
      normalizedText(attachment.filePath),
      Math.max(0, nullableNumber(attachment.fileSize) ?? 0),
      normalizedText(attachment.category),
      normalizedText(attachment.uploader),
      new Date().toISOString(),
      normalizedText(attachment.mimeType),
    ])
    await logCreate(tx, 'file_refs', id)
    attachmentIds.push(id)
  }
  return attachmentIds
}

async function assertAttachmentOwner(
  tx: TransactionDb,
  ownerType: ContractAttachmentOwnerType,
  ownerId: string,
  attachmentId: string,
): Promise<void> {
  const rows = await tx.select<{ id: string }>(`
    SELECT id
    FROM file_refs
    WHERE id = ? AND owner_type = ? AND owner_id = ?
    LIMIT 1
  `, [attachmentId, ownerType, ownerId])
  if (!rows[0])
    throw new Error('附件不存在或不属于当前记录')
}

async function persistContractLineItems(
  tx: TransactionDb,
  contractId: string,
  lines: ContractLineItemDraft[],
): Promise<void> {
  const existing = await tx.select<{ id: string }>(`
    SELECT id
    FROM contract_line_items
    WHERE contract_id = ? AND deleted_at IS NULL
  `, [contractId])
  const incomingIds = new Set(lines.flatMap(line => line.id ? [line.id] : []))
  for (const row of existing) {
    if (!incomingIds.has(row.id))
      await softDelete(tx, 'contract_line_items', row.id)
  }

  for (const [index, line] of lines.entries()) {
    const values = [
      normalizedText(line.materialName),
      rawText(line.spec),
      rawText(line.brand),
      rawText(line.unit),
      nullableNumber(line.qty),
      nullableNumber(line.taxInclusiveUnitPrice),
      normalizedText(line.plannedArrivalDate),
      rawText(line.note),
      line.sortOrder ?? index,
      new Date().toISOString(),
    ]
    if (line.id && existing.some(row => row.id === line.id)) {
      await withUpdateLog(tx, 'contract_line_items', line.id, () => tx.execute(`
        UPDATE contract_line_items
        SET material_name = ?, spec = ?, brand = ?, unit = ?, qty = ?,
            tax_inclusive_unit_price = ?, planned_arrival_date = ?, note = ?,
            sort_order = ?, updated_at = ?
        WHERE id = ?
      `, [...values, line.id]))
      continue
    }

    const id = generateId('contract_line')
    await tx.execute(`
      INSERT INTO contract_line_items (
        id, contract_id, material_name, spec, brand, unit, qty,
        tax_inclusive_unit_price, planned_arrival_date, note, sort_order,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      contractId,
      ...values.slice(0, -1),
      values.at(-1),
      values.at(-1),
    ])
    await logCreate(tx, 'contract_line_items', id)
  }
}

async function saveProjectContract(
  tx: TransactionDb,
  formKind: F2FormKind,
  draft: ProjectContractFormDraft,
  action: F2SaveAction,
  attachments: ContractFormAttachmentChanges,
): Promise<F2FormSaveResult> {
  if (draft.id) {
    const [existingContract, existingSupplement] = await Promise.all([
      activeRow<{ id: string, kind: string }>(tx, 'contracts', draft.id),
      activeRow<{ id: string }>(tx, 'contract_supplements', draft.id),
    ])
    if (draft.isSupplement && existingContract && !existingSupplement)
      throw new Error('主合同不能改为补充协议')
    if (!draft.isSupplement && existingSupplement && !existingContract)
      throw new Error('补充协议不能改为主合同')
    if (existingContract && existingContract.kind !== projectContractKind(formKind).kind)
      throw new Error('合同类型与当前编辑入口不一致')
  }
  await validateProjectContract(tx, formKind, draft, action)
  const now = new Date().toISOString()
  if (draft.isSupplement) {
    const id = draft.id ?? generateId('contract_supplement')
    const values = [
      draft.originalContractId,
      rawText(draft.no),
      rawText(draft.name),
      rawText(draft.content),
      nonNegativeNumber('补充协议金额', draft.amount),
      normalizedText(draft.signDate),
      lifecycleStatus(action, draft.status, '审批中'),
      rawText(draft.note),
      now,
    ]
    const existing = draft.id
      ? await activeRow<{ id: string }>(tx, 'contract_supplements', draft.id)
      : null
    const logId = existing
      ? await withUpdateLog(tx, 'contract_supplements', id, () => tx.execute(`
          UPDATE contract_supplements
          SET contract_id = ?, no = ?, name = ?, content = ?, amount = ?,
              sign_date = ?, status = ?, note = ?, updated_at = ?
          WHERE id = ?
        `, [...values, id]))
      : await (async () => {
          await tx.execute(`
            INSERT INTO contract_supplements (
              id, contract_id, no, name, content, amount, sign_date,
              status, note, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [id, ...values.slice(0, -1), now, now])
          return logCreate(tx, 'contract_supplements', id)
        })()
    const attachmentIds = await applyAttachmentChanges(
      tx,
      'contract_supplement',
      id,
      attachments,
    )
    await tx.execute(`
      UPDATE contracts
      SET changed = amount + COALESCE((
        SELECT SUM(supplement.amount)
        FROM contract_supplements AS supplement
        WHERE supplement.contract_id = contracts.id
          AND supplement.deleted_at IS NULL
          AND supplement.status NOT IN ('draft', '草稿')
      ), 0)
      WHERE id = ?
    `, [draft.originalContractId])
    return { id, logId, attachmentIds }
  }

  const classification = projectContractKind(formKind)
  const subKind = formKind === 'subcontract'
    ? normalizedText(draft.subKind) || '专业'
    : ''
  const costCategory = formKind === 'subcontract'
    ? subKind === '劳务' ? '合同劳务' : '专业分包'
    : formKind === 'other_expense'
      ? /机械|租赁/.test(normalizedText(draft.otherExpenseKind)) ? '机械' : '其他'
      : classification.costCategory
  const id = draft.id ?? generateId('contract')
  const values = [
    rawText(draft.no),
    rawText(draft.name),
    classification.kind,
    subKind,
    costCategory,
    nullableText(draft.projectId),
    formKind === 'construction' ? nullableText(draft.customerId) : null,
    formKind === 'construction' ? null : nullableText(draft.supplierId),
    nonNegativeNumber('含税合同金额', draft.amount),
    rawText(draft.content),
    rawText(draft.invoiceType),
    rawText(draft.contactName),
    rawText(draft.contactPhone),
    nullableNumber(draft.taxRate),
    normalizedText(draft.signDate),
    rawText(draft.mainTerms),
    rawText(draft.paymentTerms),
    rawText(draft.brandQualityTerms),
    rawText(draft.scheduleTerms),
    rawText(draft.warrantyTerms),
    rawText(draft.specialTerms),
    nullableNumber(draft.retentionRatio),
    nullableNumber(draft.retentionAmount),
    nullableNumber(draft.retentionDays),
    rawText(draft.invoiceName),
    rawText(draft.invoiceTaxNo),
    rawText(draft.invoiceAddressPhone),
    rawText(draft.invoiceBank),
    rawText(draft.invoiceBankAccount),
    rawText(draft.otherExpenseKind),
    rawText(draft.servicePeriod),
    rawText(draft.paymentCycle),
    lifecycleStatus(action, draft.status, '审批中'),
    rawText(draft.note),
    now,
  ]
  const existing = draft.id
    ? await activeRow<{ id: string }>(tx, 'contracts', draft.id)
    : null
  const logId = existing
    ? await withUpdateLog(tx, 'contracts', id, () => tx.execute(`
        UPDATE contracts
        SET no = ?, name = ?, kind = ?, sub_kind = ?, cost_category = ?,
            project_id = ?, customer_id = ?, supplier_id = ?, amount = ?,
            content = ?, invoice_type = ?, contact_name = ?, contact_phone = ?,
            tax_rate = ?, sign_date = ?, main_terms = ?, payment_terms = ?,
            brand_quality_terms = ?, schedule_terms = ?, warranty_terms = ?,
            special_terms = ?, retention_ratio = ?, retention_amount = ?,
            retention_days = ?, invoice_name = ?, invoice_tax_no = ?,
            invoice_address_phone = ?, invoice_bank = ?,
            invoice_bank_account = ?, other_expense_kind = ?,
            service_period = ?, payment_cycle = ?, status = ?, note = ?,
            changed = ? + COALESCE((
              SELECT SUM(supplement.amount)
              FROM contract_supplements AS supplement
              WHERE supplement.contract_id = contracts.id
                AND supplement.deleted_at IS NULL
                AND supplement.status NOT IN ('draft', '草稿')
            ), 0),
            updated_at = ?
        WHERE id = ?
      `, [...values.slice(0, -1), nonNegativeNumber('含税合同金额', draft.amount), values.at(-1), id]))
    : await (async () => {
        await tx.execute(`
          INSERT INTO contracts (
            id, no, name, kind, sub_kind, cost_category, project_id,
            customer_id, supplier_id, amount, content, invoice_type,
            contact_name, contact_phone, tax_rate, sign_date, main_terms,
            payment_terms, brand_quality_terms, schedule_terms, warranty_terms,
            special_terms, retention_ratio, retention_amount, retention_days,
            invoice_name, invoice_tax_no, invoice_address_phone, invoice_bank,
            invoice_bank_account, other_expense_kind, service_period,
            payment_cycle, status, note, created_at, updated_at
          )
          VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          )
        `, [id, ...values.slice(0, -1), now, now])
        await tx.execute(`
          UPDATE contracts
          SET changed = amount
          WHERE id = ?
        `, [id])
        return logCreate(tx, 'contracts', id)
      })()

  if (formKind === 'material')
    await persistContractLineItems(tx, id, draft.lineItems ?? [])
  const attachmentIds = await applyAttachmentChanges(
    tx,
    'contract',
    id,
    attachments,
  )
  return { id, logId, attachmentIds }
}

async function saveCompanyExpenseContract(
  tx: TransactionDb,
  draft: CompanyExpenseContractFormDraft,
  action: F2SaveAction,
  attachments: ContractFormAttachmentChanges,
): Promise<F2FormSaveResult> {
  const amount = nonNegativeNumber('合同金额', draft.amount)
  if (action === 'submit') {
    requireFields([
      ['合同名称', draft.name],
      ['对方单位', draft.counterparty],
      ['签订日期', draft.signDate],
    ])
  }
  const id = draft.id ?? generateId('company_expense_contract')
  const now = new Date().toISOString()
  const values = [
    rawText(draft.no),
    rawText(draft.name),
    rawText(draft.category),
    rawText(draft.counterparty),
    normalizedText(draft.signDate),
    rawText(draft.servicePeriod),
    amount,
    rawText(draft.paymentCycle),
    rawText(draft.mainTerms),
    lifecycleStatus(action, draft.status, '审批中'),
    rawText(draft.note),
    now,
  ]
  const existing = draft.id
    ? await activeRow<{ id: string }>(tx, 'company_expense_contracts', draft.id)
    : null
  const logId = existing
    ? await withUpdateLog(tx, 'company_expense_contracts', id, () => tx.execute(`
        UPDATE company_expense_contracts
        SET no = ?, name = ?, category = ?, counterparty = ?, sign_date = ?,
            service_period = ?, amount = ?, payment_cycle = ?, main_terms = ?,
            status = ?, note = ?, updated_at = ?
        WHERE id = ?
      `, [...values, id]))
    : await (async () => {
        await tx.execute(`
          INSERT INTO company_expense_contracts (
            id, no, name, category, counterparty, sign_date, service_period,
            amount, payment_cycle, main_terms, status, note, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, ...values.slice(0, -1), now, now])
        return logCreate(tx, 'company_expense_contracts', id)
      })()
  const attachmentIds = await applyAttachmentChanges(
    tx,
    'company_expense_contract',
    id,
    attachments,
  )
  return { id, logId, attachmentIds }
}

async function saveExpenditureSettlement(
  tx: TransactionDb,
  kind: 'other_settlement' | 'material_settlement',
  draft: ExpenditureSettlementFormDraft,
  action: F2SaveAction,
  attachments: ContractFormAttachmentChanges,
): Promise<F2FormSaveResult> {
  const totalAmount = nonNegativeNumber('结算金额', draft.totalAmount)
  const amount = nullableNumber(draft.amount)
  const taxAmount = nullableNumber(draft.taxAmount)
  const taxRate = nullableNumber(draft.taxRate)
  for (const [label, value] of [
    ['不含税结算金额', amount],
    ['税额', taxAmount],
    ['税率', taxRate],
  ] as const) {
    if (value != null && value < 0)
      throw new Error(`${label}不能为负数`)
  }

  await assertActiveReference(tx, 'projects', draft.projectId, '项目')
  const contract = await activeRow<ContractReferenceRow>(
    tx,
    'contracts',
    draft.contractId,
  )
  const expectedContractKind = kind === 'material_settlement' ? '材采' : '其他支出'
  const contractLabel = kind === 'material_settlement' ? '材料采购合同' : '其他支出合同'
  if (draft.contractId && !contract)
    throw new Error(`${contractLabel}不存在或已删除`)
  if (contract && contract.kind !== expectedContractKind)
    throw new Error(`所选合同不是${contractLabel}`)
  if (contract && draft.projectId && contract.project_id !== draft.projectId)
    throw new Error(`${contractLabel}与所选项目不一致`)
  if (action === 'submit') {
    requireFields([
      ['结算名称', draft.name],
      ['项目', draft.projectId],
      [contractLabel, draft.contractId],
      ['结算日期', draft.settlementDate],
    ])
  }

  const id = draft.id ?? generateId('expenditure_settlement')
  const now = new Date().toISOString()
  const values = [
    rawText(draft.no),
    rawText(draft.name),
    contract?.cost_category || (kind === 'material_settlement' ? '材料' : '其他'),
    contract?.project_id ?? nullableText(draft.projectId),
    contract?.supplier_id ?? null,
    contract?.id ?? null,
    rawText(draft.settlementType),
    totalAmount,
    amount,
    taxAmount,
    taxRate,
    normalizedText(draft.settlementDate),
    rawText(draft.settlementPeriod),
    rawText(draft.deductionNote),
    lifecycleStatus(action, draft.status, '审批中'),
    rawText(draft.note),
    now,
  ]
  const existing = draft.id
    ? await activeRow<{ id: string, biz_type: string }>(
        tx,
        'expenditure_settlements',
        draft.id,
      )
    : null
  if (existing && !settlementMatchesKind(kind, existing.biz_type))
    throw new Error('错误路由不能修改该结算单')
  const logId = existing
    ? await withUpdateLog(tx, 'expenditure_settlements', id, () => tx.execute(`
        UPDATE expenditure_settlements
        SET no = ?, name = ?, biz_type = ?, project_id = ?, supplier_id = ?,
            contract_id = ?, settlement_type = ?, total_amount = ?, amount = ?,
            tax_amount = ?, tax_rate = ?, settlement_date = ?,
            settlement_period = ?, deduction_note = ?, status = ?, note = ?,
            updated_at = ?
        WHERE id = ?
      `, [...values, id]))
    : await (async () => {
        await tx.execute(`
          INSERT INTO expenditure_settlements (
            id, no, name, biz_type, project_id, supplier_id, contract_id,
            settlement_type, total_amount, amount, tax_amount, tax_rate,
            settlement_date, settlement_period, deduction_note, status, note,
            created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, ...values.slice(0, -1), now, now])
        return logCreate(tx, 'expenditure_settlements', id)
      })()
  const attachmentIds = await applyAttachmentChanges(
    tx,
    'expenditure_settlement',
    id,
    attachments,
  )
  return { id, logId, attachmentIds }
}

function settlementMatchesKind(
  kind: 'other_settlement' | 'material_settlement',
  bizType: string,
): boolean {
  return kind === 'material_settlement'
    ? bizType === '材料' || bizType === '材采'
    : bizType === '机械' || bizType === '其他'
}

export async function saveF2Form(
  kind: F2FormKind,
  draft: F2FormDraft,
  action: F2SaveAction,
  attachments: ContractFormAttachmentChanges = {},
): Promise<F2FormSaveResult> {
  return withTransaction(async (tx) => {
    if (PROJECT_FORM_KINDS.has(kind)) {
      return saveProjectContract(
        tx,
        kind,
        draft as ProjectContractFormDraft,
        action,
        attachments,
      )
    }
    if (kind === 'company_expense') {
      return saveCompanyExpenseContract(
        tx,
        draft as CompanyExpenseContractFormDraft,
        action,
        attachments,
      )
    }
    return saveExpenditureSettlement(
      tx,
      kind as 'other_settlement' | 'material_settlement',
      draft as ExpenditureSettlementFormDraft,
      action,
      attachments,
    )
  })
}

function mapProjectContractRow(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    no: (row.no ?? '') as string,
    name: (row.name ?? '') as string,
    projectId: (row.project_id ?? null) as string | null,
    customerId: (row.customer_id ?? null) as string | null,
    supplierId: (row.supplier_id ?? null) as string | null,
    subKind: (row.sub_kind ?? '') as string,
    content: (row.content ?? '') as string,
    invoiceType: (row.invoice_type ?? '') as string,
    contactName: (row.contact_name ?? '') as string,
    contactPhone: (row.contact_phone ?? '') as string,
    taxRate: nullableNumber(row.tax_rate),
    signDate: (row.sign_date ?? '') as string,
    mainTerms: (row.main_terms ?? '') as string,
    paymentTerms: (row.payment_terms ?? '') as string,
    brandQualityTerms: (row.brand_quality_terms ?? '') as string,
    scheduleTerms: (row.schedule_terms ?? '') as string,
    warrantyTerms: (row.warranty_terms ?? '') as string,
    specialTerms: (row.special_terms ?? '') as string,
    retentionRatio: nullableNumber(row.retention_ratio),
    retentionAmount: nullableNumber(row.retention_amount),
    retentionDays: nullableNumber(row.retention_days),
    invoiceName: (row.invoice_name ?? '') as string,
    invoiceTaxNo: (row.invoice_tax_no ?? '') as string,
    invoiceAddressPhone: (row.invoice_address_phone ?? '') as string,
    invoiceBank: (row.invoice_bank ?? '') as string,
    invoiceBankAccount: (row.invoice_bank_account ?? '') as string,
    otherExpenseKind: (row.other_expense_kind ?? '') as string,
    servicePeriod: (row.service_period ?? '') as string,
    paymentCycle: (row.payment_cycle ?? '') as string,
    amount: Number(row.amount ?? 0),
    status: (row.status ?? 'draft') as string,
    note: (row.note ?? '') as string,
  }
}

function mapLineItem(row: Record<string, unknown>): ContractLineItemDraft {
  return {
    id: row.id as string,
    materialName: (row.material_name ?? '') as string,
    spec: (row.spec ?? '') as string,
    brand: (row.brand ?? '') as string,
    unit: (row.unit ?? '') as string,
    qty: nullableNumber(row.qty),
    taxInclusiveUnitPrice: nullableNumber(row.tax_inclusive_unit_price),
    plannedArrivalDate: (row.planned_arrival_date ?? '') as string,
    note: (row.note ?? '') as string,
    sortOrder: Number(row.sort_order ?? 0),
  }
}

export async function loadF2Form(
  kind: F2FormKind,
  id: string,
): Promise<F2FormDraft | null> {
  if (PROJECT_FORM_KINDS.has(kind)) {
    const rows = await select<Record<string, unknown>>(
      selectVisibleSql('contracts', 'AND id = ? AND kind = ? LIMIT 1'),
      [id, projectContractKind(kind).kind],
    )
    if (!rows[0])
      return null
    const draft = mapProjectContractRow(rows[0])
    if (kind === 'material') {
      const lines = await select<Record<string, unknown>>(
        selectVisibleSql(
          'contract_line_items',
          'AND contract_id = ? ORDER BY sort_order, created_at, id',
        ),
        [id],
      )
      return { ...draft, lineItems: lines.map(mapLineItem) }
    }
    return draft
  }
  if (kind === 'company_expense') {
    const rows = await select<Record<string, unknown>>(
      selectVisibleSql('company_expense_contracts', 'AND id = ? LIMIT 1'),
      [id],
    )
    if (!rows[0])
      return null
    const row = rows[0]
    return {
      id: row.id as string,
      no: (row.no ?? '') as string,
      name: (row.name ?? '') as string,
      category: (row.category ?? '') as string,
      counterparty: (row.counterparty ?? '') as string,
      signDate: (row.sign_date ?? '') as string,
      servicePeriod: (row.service_period ?? '') as string,
      amount: Number(row.amount ?? 0),
      paymentCycle: (row.payment_cycle ?? '') as string,
      mainTerms: (row.main_terms ?? '') as string,
      status: (row.status ?? 'draft') as string,
      note: (row.note ?? '') as string,
    }
  }
  const rows = await select<Record<string, unknown>>(
    selectVisibleSql('expenditure_settlements', 'AND id = ? LIMIT 1'),
    [id],
  )
  if (!rows[0])
    return null
  const row = rows[0]
  if (
    (kind === 'other_settlement' || kind === 'material_settlement')
    && !settlementMatchesKind(kind, String(row.biz_type ?? ''))
  ) {
    return null
  }
  return {
    id: row.id as string,
    no: (row.no ?? '') as string,
    name: (row.name ?? '') as string,
    projectId: (row.project_id ?? null) as string | null,
    contractId: (row.contract_id ?? null) as string | null,
    settlementType: (row.settlement_type ?? '') as string,
    totalAmount: Number(row.total_amount ?? 0),
    amount: nullableNumber(row.amount),
    taxAmount: nullableNumber(row.tax_amount),
    taxRate: nullableNumber(row.tax_rate),
    settlementDate: (row.settlement_date ?? '') as string,
    settlementPeriod: (row.settlement_period ?? '') as string,
    deductionNote: (row.deduction_note ?? '') as string,
    status: (row.status ?? 'draft') as string,
    note: (row.note ?? '') as string,
  }
}

export async function loadContractSupplementForm(
  id: string,
): Promise<ProjectContractFormDraft | null> {
  const rows = await select<Record<string, unknown>>(
    selectVisibleSql('contract_supplements', 'AND id = ? LIMIT 1'),
    [id],
  )
  if (!rows[0])
    return null
  const row = rows[0]
  return {
    id: row.id as string,
    isSupplement: true,
    originalContractId: (row.contract_id ?? null) as string | null,
    no: (row.no ?? '') as string,
    name: (row.name ?? '') as string,
    content: (row.content ?? '') as string,
    amount: Number(row.amount ?? 0),
    signDate: (row.sign_date ?? '') as string,
    status: (row.status ?? 'draft') as string,
    note: (row.note ?? '') as string,
  }
}

export async function listContractFormAttachments(
  ownerType: ContractAttachmentOwnerType,
  ownerId: string,
  includeDeleted = false,
): Promise<ContractFormAttachment[]> {
  const rows = await select<Record<string, unknown>>(`
    SELECT *
    FROM file_refs
    WHERE owner_type = ? AND owner_id = ?
      ${includeDeleted ? '' : 'AND deleted_at IS NULL'}
    ORDER BY uploaded_at, id
  `, [ownerType, ownerId])
  return rows.map(row => ({
    id: row.id as string,
    ownerType: row.owner_type as ContractAttachmentOwnerType,
    ownerId: row.owner_id as string,
    fileName: (row.file_name ?? '') as string,
    filePath: (row.file_path ?? '') as string,
    fileSize: Number(row.file_size ?? 0),
    mimeType: (row.mime_type ?? '') as string,
    category: (row.category ?? '') as string,
    uploader: (row.uploader ?? '') as string,
    uploadedAt: (row.uploaded_at ?? '') as string,
    deletedAt: (row.deleted_at ?? null) as string | null,
  }))
}

export async function listExpenditureSettlementOptions(
  filters: {
    projectId?: string | null
    supplierId?: string | null
    contractId?: string | null
  } = {},
): Promise<LookupOption[]> {
  const conditions = [`settlement.status NOT IN ('draft', '草稿')`]
  const params: unknown[] = []
  for (const [column, value] of [
    ['project_id', filters.projectId],
    ['supplier_id', filters.supplierId],
    ['contract_id', filters.contractId],
  ] as const) {
    if (!value)
      continue
    conditions.push(`settlement.${column} = ?`)
    params.push(value)
  }
  const rows = await select<{
    id: string
    name: string
    total_amount: number
  }>(`
    ${hiddenCtesFor('expenditure_settlements', 'contracts')}
    SELECT settlement.id, settlement.name, settlement.total_amount
    FROM expenditure_settlements AS settlement
    JOIN contracts AS contract
      ON contract.id = settlement.contract_id
    WHERE ${visibleCond('expenditure_settlements', 'settlement')}
      AND ${visibleCond('contracts', 'contract')}
      AND ${conditions.join(' AND ')}
    ORDER BY settlement.settlement_date DESC, settlement.created_at DESC
  `, params)
  return rows.map(row => ({
    id: row.id,
    label: row.name,
    hint: Number(row.total_amount).toFixed(2),
  }))
}

interface DeleteBlocker {
  table: string
  column: string
  label: string
}

const CONTRACT_DELETE_BLOCKERS: DeleteBlocker[] = [
  { table: 'expenditure_settlements', column: 'contract_id', label: '有效结算' },
  { table: 'payment_applications', column: 'contract_id', label: '付款申请' },
  { table: 'invoices', column: 'contract_id', label: '发票' },
  { table: 'boq_files', column: 'contract_id', label: 'BOQ 文件' },
  { table: 'boq_change_orders', column: 'contract_id', label: '变洽签' },
  { table: 'monthly_statements', column: 'contract_id', label: '月度报量' },
  { table: 'schedule_groups', column: 'contract_id', label: '进度计划' },
]

async function tableColumns(
  tx: TransactionDb,
  table: string,
): Promise<Set<string>> {
  const rows = await tx.select<{ name: string }>(`PRAGMA table_info("${table}")`)
  return new Set(rows.map(row => row.name))
}

async function activeReferenceCount(
  tx: TransactionDb,
  blocker: DeleteBlocker,
  id: string,
): Promise<number> {
  const columns = await tableColumns(tx, blocker.table)
  if (!columns.has(blocker.column))
    return 0
  const visibility = Object.hasOwn(PARENT_REFS, blocker.table)
    ? `${hiddenCtesFor(blocker.table)}
       SELECT COUNT(*) AS total
       FROM "${blocker.table}"
       WHERE "${blocker.column}" = ?
         AND ${visibleCond(blocker.table)}`
    : `SELECT COUNT(*) AS total
       FROM "${blocker.table}"
       WHERE "${blocker.column}" = ?
         ${columns.has('deleted_at') ? 'AND deleted_at IS NULL' : ''}`
  const rows = await tx.select<{ total: number }>(`
    ${visibility}
  `, [id])
  return Number(rows[0]?.total ?? 0)
}

async function assertContractCanDelete(
  tx: TransactionDb,
  id: string,
): Promise<void> {
  const blockers: string[] = []
  for (const blocker of CONTRACT_DELETE_BLOCKERS) {
    const count = await activeReferenceCount(tx, blocker, id)
    if (count)
      blockers.push(`${blocker.label} ${count} 条`)
  }
  if (blockers.length)
    throw new Error(`合同存在${blockers.join('、')}，请先处理关联单据`)
}

async function assertSettlementCanDelete(
  tx: TransactionDb,
  id: string,
): Promise<void> {
  const count = await activeReferenceCount(tx, {
    table: 'payment_application_settlement_allocations',
    column: 'settlement_id',
    label: '付款申请分摊',
  }, id)
  if (count)
    throw new Error(`结算已被付款申请分摊引用 ${count} 条，请先解除关联`)
}

/**
 * F2 删除入口：合同删除前检查结算、付款、发票和 BOQ 等真实下游；
 * 公司支出合同与支出结算仍使用同一套日志化软删除。
 */
export async function deleteF2Form(
  kind: F2FormKind,
  id: string,
): Promise<string | null> {
  return withTransaction(async (tx) => {
    if (PROJECT_FORM_KINDS.has(kind)) {
      await assertContractCanDelete(tx, id)
      return softDelete(tx, 'contracts', id)
    }
    if (kind === 'company_expense')
      return softDelete(tx, 'company_expense_contracts', id)
    await assertSettlementCanDelete(tx, id)
    return softDelete(tx, 'expenditure_settlements', id)
  })
}
