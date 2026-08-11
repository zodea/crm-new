import type { TransactionDb } from '~/lib/db/coordinator'
import type {
  FileRefChanges,
  FileRefRecord,
} from '~/lib/forms/file-refs'
import { select, withTransaction } from '~/lib/db/connection'
import {
  logCreate,
  softDelete,
  withUpdateLog,
} from '~/lib/db/soft-delete'
import {
  applyFileRefChanges,
  listFileRefs,
} from '~/lib/forms/file-refs'
import { generateId } from '~/lib/util/id'

export type F3FormKind
  = | 'receipt'
    | 'invoice_application'
    | 'current'
    | 'payment_record'
    | 'reimbursement'
    | 'payment_application'

export type F3SaveAction = 'draft' | 'save' | 'submit' | 'confirm'
export type InvoiceState = '先票后款' | '先款后票' | '无需发票'
export type CurrentDirection = 'receipt' | 'payment'
export type PaymentSource = 'manual' | 'image_ocr' | 'excel_import'
export type PaymentConfirmationStatus = 'draft' | 'needs_review' | 'confirmed'

export interface ReceiptFormDraft {
  id?: string
  no?: string
  receiptDate?: string
  projectId?: string | null
  contractId?: string | null
  customerId?: string | null
  payerAccount?: string
  amount?: number | null
  paymentMethod?: string
  acceptanceBillNo?: string
  billDueDate?: string
  periodNo?: string
  bankSerialNo?: string
  handler?: string
  reviewStatus?: string
  status?: string
  note?: string
}

export interface InvoiceApplicationFormDraft {
  id?: string
  no?: string
  name?: string
  projectId?: string | null
  contractId?: string | null
  customerId?: string | null
  buyerNameSnapshot?: string
  buyerTaxNoSnapshot?: string
  invoiceType?: string
  amount?: number | null
  taxRate?: number | null
  taxAmount?: number | null
  invoiceContent?: string
  invoiceRemark?: string
  applicant?: string
  applicationDate?: string
  status?: string
  note?: string
}

export interface CurrentTransactionFormDraft {
  id?: string
  no?: string
  direction?: CurrentDirection
  projectId?: string | null
  counterparty?: string
  purpose?: string
  amount?: number | null
  paymentMethod?: string
  transactionDate?: string
  bankSerialNo?: string
  handler?: string
  status?: string
  note?: string
}

export interface ReimbursementLineDraft {
  id?: string
  expenseItem?: string
  expenseDate?: string
  amount?: number | null
  note?: string
}

export interface ExpenseReimbursementFormDraft {
  id?: string
  no?: string
  projectId?: string | null
  applicant?: string
  category?: string
  reimbursementDate?: string
  invoiceCount?: number | null
  reason?: string
  status?: string
  note?: string
  externalRef?: string
  lines?: ReimbursementLineDraft[]
}

export interface SettlementAllocationDraft {
  id?: string
  settlementId?: string | null
  allocatedAmount?: number | null
  note?: string
}

export interface InvoiceAllocationDraft {
  id?: string
  invoiceId?: string | null
  allocatedAmount?: number | null
  note?: string
}

export interface PaymentApplicationFormDraft {
  id?: string
  no?: string
  name?: string
  bizType?: string
  projectId?: string | null
  supplierId?: string | null
  contractId?: string | null
  costName?: string
  applyAmount?: number | null
  applyDate?: string
  applicant?: string
  invoiceState?: InvoiceState
  payContent?: string
  prepayDeduct?: number | null
  prepayNote?: string
  approvedAmount?: number | null
  approvalNote?: string
  status?: string
  note?: string
  externalRef?: string
  settlementAllocations?: SettlementAllocationDraft[]
  invoiceAllocations?: InvoiceAllocationDraft[]
}

export interface PaymentApplicationAllocationDraft {
  id?: string
  paymentApplicationId?: string | null
  allocatedAmount?: number | null
  note?: string
}

export interface PaymentRecordFormDraft {
  id?: string
  no?: string
  projectId?: string | null
  supplierId?: string | null
  payeeName?: string
  purpose?: string
  paymentDate?: string
  amount?: number | null
  paymentMethod?: string
  voucherNo?: string
  bankSerialNo?: string
  payeeAccount?: string
  payeeBank?: string
  payeeBankAccount?: string
  handler?: string
  source?: PaymentSource
  recognitionStatus?: string
  ocrPayload?: string | Record<string, unknown>
  fieldConfidence?: string | Record<string, number>
  confirmationStatus?: PaymentConfirmationStatus
  confirmedBy?: string
  confirmedAt?: string | null
  externalRef?: string
  note?: string
  applicationAllocations?: PaymentApplicationAllocationDraft[]
}

export type F3FormDraft
  = | ReceiptFormDraft
    | InvoiceApplicationFormDraft
    | CurrentTransactionFormDraft
    | ExpenseReimbursementFormDraft
    | PaymentApplicationFormDraft
    | PaymentRecordFormDraft

export interface F3SaveResult {
  id: string
  logId: string | null
  attachmentIds: string[]
}

export interface PaymentApplicationSummary {
  settlementAllocated: number
  settlementDifference: number
  invoiceAllocated: number
  invoiceDifference: number
  pendingInvoiceAmount: number
  paidAmount: number
}

export interface FinanceFormRecordMap {
  receipt: ReceiptFormDraft & { id: string }
  invoice_application: InvoiceApplicationFormDraft & {
    id: string
    totalAmount: number
  }
  current: CurrentTransactionFormDraft & { id: string }
  reimbursement: ExpenseReimbursementFormDraft & {
    id: string
    lines: ReimbursementLineDraft[]
    totalAmount: number
  }
  payment_application: PaymentApplicationFormDraft & PaymentApplicationSummary & {
    id: string
    settlementAllocations: SettlementAllocationDraft[]
    invoiceAllocations: InvoiceAllocationDraft[]
  }
  payment_record: PaymentRecordFormDraft & {
    id: string
    applicationAllocations: PaymentApplicationAllocationDraft[]
  }
}

type FinanceTable
  = | 'receipt_registrations'
    | 'invoice_applications'
    | 'current_transactions'
    | 'expense_reimbursements'
    | 'payment_applications'
    | 'payment_records'
    | 'projects'
    | 'customers'
    | 'suppliers'
    | 'contracts'
    | 'expenditure_settlements'
    | 'invoices'

const OWNER_TYPE: Record<F3FormKind, string> = {
  receipt: 'receipt_registration',
  invoice_application: 'invoice_application',
  current: 'current_transaction',
  reimbursement: 'expense_reimbursement',
  payment_application: 'payment_application',
  payment_record: 'payment_record',
}

const TABLE_BY_KIND: Record<F3FormKind, FinanceTable> = {
  receipt: 'receipt_registrations',
  invoice_application: 'invoice_applications',
  current: 'current_transactions',
  reimbursement: 'expense_reimbursements',
  payment_application: 'payment_applications',
  payment_record: 'payment_records',
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function nullableId(value: unknown): string | null {
  const normalized = text(value)
  return normalized || null
}

function nonNegativeMoney(label: string, value: unknown): number {
  if (value === '' || value == null)
    return 0
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0)
    throw new Error(`${label}不能为负数`)
  return number
}

function positiveMoney(label: string, value: unknown): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0)
    throw new Error(`${label}必须大于 0`)
  return number
}

function integerCount(label: string, value: unknown): number {
  const number = nonNegativeMoney(label, value)
  if (!Number.isInteger(number))
    throw new Error(`${label}必须是整数`)
  return number
}

function sumMoney(lines: Array<{ allocatedAmount?: number | null }>): number {
  return lines.reduce(
    (sum, line) => sum + positiveMoney('分摊金额', line.allocatedAmount),
    0,
  )
}

function moneyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.0001
}

function requireFields(fields: Array<[string, unknown]>): void {
  const missing = fields
    .filter(([, value]) => value == null || text(value) === '')
    .map(([label]) => label)
  if (missing.length)
    throw new Error(`${missing.join('、')}不能为空`)
}

function lifecycleStatus(
  action: F3SaveAction,
  requested: unknown,
): string {
  if (action === 'draft')
    return 'draft'
  if (action === 'submit')
    return 'submitted'
  const value = text(requested)
  return value || 'draft'
}

function generatedNo(prefix: string, requested: unknown, id: string): string {
  const supplied = text(requested)
  if (supplied)
    return supplied
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  return `${prefix}-${date}-${id.slice(-6).toUpperCase()}`
}

function serializedConfidence(
  value: PaymentRecordFormDraft['fieldConfidence'],
): string {
  if (typeof value === 'string') {
    try {
      JSON.parse(value)
      return value
    }
    catch {
      throw new Error('逐字段置信度必须是有效 JSON')
    }
  }
  return JSON.stringify(value ?? {})
}

function serializedOcrPayload(
  value: PaymentRecordFormDraft['ocrPayload'],
): string {
  if (typeof value === 'string') {
    try {
      JSON.parse(value)
      return value
    }
    catch {
      throw new Error('OCR 原始结果必须是合法 JSON')
    }
  }
  return JSON.stringify(value ?? {})
}

async function activeRow<T>(
  tx: Pick<TransactionDb, 'select'>,
  table: FinanceTable,
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
  table: FinanceTable,
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
  table: FinanceTable,
  id: unknown,
  label: string,
): Promise<void> {
  if (nullableId(id))
    await assertReference(tx, table, id, label)
}

async function persistReplacementRows<T>(
  tx: TransactionDb,
  table: string,
  parentColumn: string,
  parentId: string,
  rows: T[],
  insert: (id: string, row: T, index: number) => Promise<void>,
  idPrefix: string,
): Promise<void> {
  const existing = await tx.select<{ id: string }>(
    `SELECT id FROM "${table}" WHERE "${parentColumn}" = ? AND deleted_at IS NULL`,
    [parentId],
  )
  for (const row of existing)
    await softDelete(tx, table, row.id)
  for (const [index, row] of rows.entries()) {
    const id = generateId(idPrefix)
    await insert(id, row, index)
    await logCreate(tx, table, id)
  }
}

async function validateReceipt(
  tx: TransactionDb,
  draft: ReceiptFormDraft,
  action: F3SaveAction,
): Promise<number> {
  const amount = nonNegativeMoney('收款金额', draft.amount)
  const project = await activeRow<{ id: string }>(
    tx,
    'projects',
    draft.projectId,
  )
  if (nullableId(draft.projectId) && !project)
    throw new Error('项目不存在或已删除')
  const customer = await activeRow<{ id: string }>(
    tx,
    'customers',
    draft.customerId,
  )
  if (nullableId(draft.customerId) && !customer)
    throw new Error('付款方客户不存在或已删除')
  if (draft.contractId) {
    const contract = await assertReference<{
      project_id: string
      customer_id: string | null
      kind: string
    }>(tx, 'contracts', draft.contractId, '施工合同')
    if (contract.kind !== '施工')
      throw new Error('收款登记只能关联施工合同')
    if (contract.project_id !== draft.projectId)
      throw new Error('施工合同不属于所选项目')
    if (draft.customerId && contract.customer_id && contract.customer_id !== draft.customerId)
      throw new Error('付款方客户与施工合同不一致')
  }
  if (action !== 'draft') {
    requireFields([
      ['收款日期', draft.receiptDate],
      ['项目', draft.projectId],
      ['付款方客户', draft.customerId],
    ])
    if (amount <= 0)
      throw new Error('收款金额必须大于 0')
  }
  return amount
}

async function saveReceipt(
  tx: TransactionDb,
  draft: ReceiptFormDraft,
  action: F3SaveAction,
): Promise<{ id: string, logId: string | null }> {
  const amount = await validateReceipt(tx, draft, action)
  const id = draft.id ?? generateId('receipt')
  const now = new Date().toISOString()
  const values = [
    generatedNo('SK', draft.no, id),
    text(draft.receiptDate),
    nullableId(draft.projectId),
    nullableId(draft.contractId),
    nullableId(draft.customerId),
    text(draft.payerAccount),
    amount,
    text(draft.paymentMethod),
    text(draft.acceptanceBillNo),
    text(draft.billDueDate),
    text(draft.periodNo),
    text(draft.bankSerialNo),
    text(draft.handler),
    text(draft.reviewStatus),
    lifecycleStatus(action, draft.status),
    text(draft.note),
    now,
  ]
  const existing = await activeRow(tx, 'receipt_registrations', id)
  const logId = existing
    ? await withUpdateLog(tx, 'receipt_registrations', id, () => tx.execute(`
        UPDATE receipt_registrations
        SET no = ?, receipt_date = ?, project_id = ?, contract_id = ?,
            customer_id = ?, payer_account = ?, amount = ?, payment_method = ?,
            acceptance_bill_no = ?, bill_due_date = ?, period_no = ?,
            bank_serial_no = ?, handler = ?, review_status = ?, status = ?,
            note = ?, updated_at = ?
        WHERE id = ?
      `, [...values, id]))
    : await (async () => {
        await tx.execute(`
          INSERT INTO receipt_registrations (
            id, no, receipt_date, project_id, contract_id, customer_id,
            payer_account, amount, payment_method, acceptance_bill_no,
            bill_due_date, period_no, bank_serial_no, handler, review_status,
            status, note, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, ...values.slice(0, -1), now, now])
        return logCreate(tx, 'receipt_registrations', id)
      })()
  return { id, logId }
}

async function validateInvoiceApplication(
  tx: TransactionDb,
  draft: InvoiceApplicationFormDraft,
  action: F3SaveAction,
): Promise<{ amount: number, taxRate: number, taxAmount: number }> {
  const amount = nonNegativeMoney('开票金额', draft.amount)
  const taxRate = nonNegativeMoney('税率', draft.taxRate)
  const taxAmount = nonNegativeMoney('税额', draft.taxAmount)
  await assertOptionalReference(tx, 'projects', draft.projectId, '项目')
  await assertOptionalReference(tx, 'customers', draft.customerId, '购方客户')
  if (draft.contractId) {
    const contract = await assertReference<{
      project_id: string
      customer_id: string | null
      kind: string
    }>(tx, 'contracts', draft.contractId, '施工合同')
    if (contract.kind !== '施工' || contract.project_id !== draft.projectId)
      throw new Error('施工合同不属于所选项目')
    if (draft.customerId && contract.customer_id && contract.customer_id !== draft.customerId)
      throw new Error('购方客户与施工合同不一致')
  }
  if (action !== 'draft') {
    requireFields([
      ['申请名称', draft.name],
      ['项目', draft.projectId],
      ['购方客户', draft.customerId],
      ['购方名称快照', draft.buyerNameSnapshot],
      ['购方税号快照', draft.buyerTaxNoSnapshot],
      ['申请日期', draft.applicationDate],
    ])
    if (amount <= 0)
      throw new Error('开票金额必须大于 0')
  }
  return { amount, taxRate, taxAmount }
}

async function saveInvoiceApplication(
  tx: TransactionDb,
  draft: InvoiceApplicationFormDraft,
  action: F3SaveAction,
): Promise<{ id: string, logId: string | null }> {
  const money = await validateInvoiceApplication(tx, draft, action)
  const id = draft.id ?? generateId('invoice_application')
  const now = new Date().toISOString()
  const values = [
    generatedNo('KP', draft.no, id),
    text(draft.name),
    nullableId(draft.projectId),
    nullableId(draft.contractId),
    nullableId(draft.customerId),
    text(draft.buyerNameSnapshot),
    text(draft.buyerTaxNoSnapshot),
    text(draft.invoiceType),
    money.amount,
    money.taxRate,
    money.taxAmount,
    text(draft.invoiceContent),
    text(draft.invoiceRemark),
    text(draft.applicant),
    text(draft.applicationDate),
    lifecycleStatus(action, draft.status),
    text(draft.note),
    now,
  ]
  const existing = await activeRow(tx, 'invoice_applications', id)
  const logId = existing
    ? await withUpdateLog(tx, 'invoice_applications', id, () => tx.execute(`
        UPDATE invoice_applications
        SET no = ?, name = ?, project_id = ?, contract_id = ?, customer_id = ?,
            buyer_name_snapshot = ?, buyer_tax_no_snapshot = ?, invoice_type = ?,
            amount = ?, tax_rate = ?, tax_amount = ?, invoice_content = ?,
            invoice_remark = ?, applicant = ?, application_date = ?, status = ?,
            note = ?, updated_at = ?
        WHERE id = ?
      `, [...values, id]))
    : await (async () => {
        await tx.execute(`
          INSERT INTO invoice_applications (
            id, no, name, project_id, contract_id, customer_id,
            buyer_name_snapshot, buyer_tax_no_snapshot, invoice_type,
            amount, tax_rate, tax_amount, invoice_content, invoice_remark,
            applicant, application_date, status, note, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, ...values.slice(0, -1), now, now])
        return logCreate(tx, 'invoice_applications', id)
      })()
  return { id, logId }
}

async function saveCurrentTransaction(
  tx: TransactionDb,
  draft: CurrentTransactionFormDraft,
  action: F3SaveAction,
): Promise<{ id: string, logId: string | null }> {
  const amount = nonNegativeMoney('往来金额', draft.amount)
  await assertOptionalReference(tx, 'projects', draft.projectId, '项目')
  if (draft.direction && !['receipt', 'payment'].includes(draft.direction))
    throw new Error('收付方向无效')
  if (action !== 'draft') {
    requireFields([
      ['收付方向', draft.direction],
      ['项目', draft.projectId],
      ['往来方', draft.counterparty],
      ['日期', draft.transactionDate],
    ])
    if (amount <= 0)
      throw new Error('往来金额必须大于 0')
  }
  const id = draft.id ?? generateId('current_transaction')
  const now = new Date().toISOString()
  const values = [
    generatedNo('WL', draft.no, id),
    draft.direction ?? 'receipt',
    nullableId(draft.projectId),
    text(draft.counterparty),
    text(draft.purpose),
    amount,
    text(draft.paymentMethod),
    text(draft.transactionDate),
    text(draft.bankSerialNo),
    text(draft.handler),
    lifecycleStatus(action, draft.status),
    text(draft.note),
    now,
  ]
  const existing = await activeRow(tx, 'current_transactions', id)
  const logId = existing
    ? await withUpdateLog(tx, 'current_transactions', id, () => tx.execute(`
        UPDATE current_transactions
        SET no = ?, direction = ?, project_id = ?, counterparty = ?, purpose = ?,
            amount = ?, payment_method = ?, transaction_date = ?,
            bank_serial_no = ?, handler = ?, status = ?, note = ?, updated_at = ?
        WHERE id = ?
      `, [...values, id]))
    : await (async () => {
        await tx.execute(`
          INSERT INTO current_transactions (
            id, no, direction, project_id, counterparty, purpose, amount,
            payment_method, transaction_date, bank_serial_no, handler,
            status, note, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, ...values.slice(0, -1), now, now])
        return logCreate(tx, 'current_transactions', id)
      })()
  return { id, logId }
}

async function saveReimbursement(
  tx: TransactionDb,
  draft: ExpenseReimbursementFormDraft,
  action: F3SaveAction,
): Promise<{ id: string, logId: string | null }> {
  await assertOptionalReference(tx, 'projects', draft.projectId, '项目')
  const inputLines = draft.lines ?? []
  const lines = action === 'draft'
    ? inputLines.filter((line, index) => {
        const amount = Number(line.amount)
        if (!Number.isFinite(amount) || amount < 0)
          positiveMoney(`第 ${index + 1} 行金额`, line.amount)
        return amount > 0
      })
    : inputLines
  for (const [index, line] of lines.entries()) {
    positiveMoney(`第 ${index + 1} 行金额`, line.amount)
    if (action !== 'draft')
      requireFields([[`第 ${index + 1} 行费用项目`, line.expenseItem]])
  }
  if (action !== 'draft') {
    requireFields([
      ['报销人', draft.applicant],
      ['报销日期', draft.reimbursementDate],
    ])
    if (!lines.length)
      throw new Error('至少需要一条报销明细')
  }
  const id = draft.id ?? generateId('expense_reimbursement')
  const now = new Date().toISOString()
  const values = [
    generatedNo('BX', draft.no, id),
    nullableId(draft.projectId),
    text(draft.applicant),
    text(draft.category),
    text(draft.reimbursementDate),
    integerCount('发票张数', draft.invoiceCount),
    text(draft.reason),
    lifecycleStatus(action, draft.status),
    text(draft.note),
    text(draft.externalRef),
    now,
  ]
  const existing = await activeRow(tx, 'expense_reimbursements', id)
  const logId = existing
    ? await withUpdateLog(tx, 'expense_reimbursements', id, () => tx.execute(`
        UPDATE expense_reimbursements
        SET no = ?, project_id = ?, applicant = ?, category = ?,
            reimbursement_date = ?, invoice_count = ?, reason = ?, status = ?,
            note = ?, external_ref = ?, updated_at = ?
        WHERE id = ?
      `, [...values, id]))
    : await (async () => {
        await tx.execute(`
          INSERT INTO expense_reimbursements (
            id, no, project_id, applicant, category, reimbursement_date,
            invoice_count, reason, status, note, external_ref,
            created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, ...values.slice(0, -1), now, now])
        return logCreate(tx, 'expense_reimbursements', id)
      })()
  await persistReplacementRows(
    tx,
    'expense_reimbursement_lines',
    'reimbursement_id',
    id,
    lines,
    async (lineId, line, index) => {
      await tx.execute(`
        INSERT INTO expense_reimbursement_lines (
          id, reimbursement_id, expense_item, expense_date, amount,
          note, sort_order, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        lineId,
        id,
        text(line.expenseItem),
        text(line.expenseDate),
        positiveMoney(`第 ${index + 1} 行金额`, line.amount),
        text(line.note),
        index,
        now,
        now,
      ])
    },
    'expense_line',
  )
  return { id, logId }
}

function needsSettlementAllocation(bizType: string): boolean {
  return bizType.startsWith('有合同-')
}

function expenseContractMatchesPaymentType(
  bizType: string,
  contract: { kind: string, sub_kind: string | null },
): boolean {
  if (bizType === '预付款')
    return ['分包', '材采', '其他支出'].includes(contract.kind)
  if (bizType === '有合同-合同劳务')
    return contract.kind === '分包' && contract.sub_kind === '劳务'
  if (bizType === '有合同-专业分包')
    return contract.kind === '分包' && contract.sub_kind === '专业'
  if (bizType === '有合同-材料')
    return contract.kind === '材采'
  if (bizType === '有合同-机械' || bizType === '有合同-其他')
    return contract.kind === '其他支出'
  return true
}

async function validatePaymentApplicationAllocations(
  tx: TransactionDb,
  draft: PaymentApplicationFormDraft,
  id: string,
  action: F3SaveAction,
  amount: number,
): Promise<void> {
  const settlementLines = draft.settlementAllocations ?? []
  const invoiceLines = draft.invoiceAllocations ?? []
  const settlementIds = new Set<string>()
  for (const line of settlementLines) {
    const settlementId = nullableId(line.settlementId)
    if (!settlementId)
      throw new Error('关联结算不能为空')
    if (settlementIds.has(settlementId))
      throw new Error('同一付款申请不能重复关联结算')
    settlementIds.add(settlementId)
    positiveMoney('分摊金额', line.allocatedAmount)
    const settlement = await assertReference<{
      project_id: string
      contract_id: string
    }>(tx, 'expenditure_settlements', settlementId, '关联结算')
    if (draft.projectId && settlement.project_id !== draft.projectId)
      throw new Error('关联结算不属于所选项目')
    if (draft.contractId && settlement.contract_id !== draft.contractId)
      throw new Error('关联结算不属于所选合同')
  }
  const settlementTotal = sumMoney(settlementLines)
  if (
    action !== 'draft'
    && needsSettlementAllocation(text(draft.bizType))
    && !moneyEqual(settlementTotal, amount)
  ) {
    throw new Error('关联结算金额必须等于申请金额')
  }

  const invoiceIds = new Set<string>()
  for (const line of invoiceLines) {
    const invoiceId = nullableId(line.invoiceId)
    if (!invoiceId)
      throw new Error('关联发票不能为空')
    if (invoiceIds.has(invoiceId))
      throw new Error('同一付款申请不能重复关联发票')
    invoiceIds.add(invoiceId)
    const allocated = positiveMoney('分摊金额', line.allocatedAmount)
    const invoice = await assertReference<{
      project_id: string | null
      supplier_id: string | null
      total_amount: number
    }>(tx, 'invoices', invoiceId, '关联发票')
    if (draft.projectId && invoice.project_id && invoice.project_id !== draft.projectId)
      throw new Error('关联发票不属于所选项目')
    if (draft.supplierId && invoice.supplier_id && invoice.supplier_id !== draft.supplierId)
      throw new Error('关联发票不属于所选分供方')
    const [used] = await tx.select<{ amount: number }>(`
      SELECT COALESCE(SUM(allocation.allocated_amount), 0) AS amount
      FROM payment_application_invoice_allocations AS allocation
      WHERE allocation.invoice_id = ?
        AND allocation.deleted_at IS NULL
        AND allocation.payment_application_id <> ?
    `, [invoiceId, id])
    if ((used?.amount ?? 0) + allocated > invoice.total_amount + 0.0001)
      throw new Error(`发票可关联额度不足，剩余 ${Math.max(invoice.total_amount - (used?.amount ?? 0), 0).toFixed(2)}`)
  }
  const invoiceTotal = sumMoney(invoiceLines)
  const invoiceState = draft.invoiceState ?? '先款后票'
  if (invoiceState === '无需发票' && invoiceLines.length)
    throw new Error('无需发票不能关联发票')
  if (
    action !== 'draft'
    && invoiceState === '先票后款'
    && !moneyEqual(invoiceTotal, amount)
  ) {
    throw new Error('关联发票金额必须等于申请金额')
  }
}

async function savePaymentApplication(
  tx: TransactionDb,
  draft: PaymentApplicationFormDraft,
  action: F3SaveAction,
): Promise<{ id: string, logId: string | null }> {
  const amount = nonNegativeMoney('申请金额', draft.applyAmount)
  const approvedAmount = nonNegativeMoney('批复金额', draft.approvedAmount)
  const prepayDeduct = nonNegativeMoney('扣除预付款金额', draft.prepayDeduct)
  const id = draft.id ?? generateId('payment_application')
  const existing = await activeRow<{
    biz_type: string
    invoice_state: string
  }>(tx, 'payment_applications', id)
  if (existing && (
    existing.biz_type !== text(draft.bizType)
    || existing.invoice_state !== (draft.invoiceState ?? '先款后票')
  )) {
    const [links] = await tx.select<{ cnt: number }>(`
      SELECT (
        SELECT COUNT(*) FROM payment_application_settlement_allocations
        WHERE payment_application_id = ? AND deleted_at IS NULL
      ) + (
        SELECT COUNT(*) FROM payment_application_invoice_allocations
        WHERE payment_application_id = ? AND deleted_at IS NULL
      ) + (
        SELECT COUNT(*) FROM payment_record_application_allocations
        WHERE payment_application_id = ? AND deleted_at IS NULL
      ) AS cnt
    `, [id, id, id])
    if ((links?.cnt ?? 0) > 0)
      throw new Error('存在真实分摊或支付记录时，需先撤销关联再修改业务类型或回票类型')
  }

  const companyPayment = text(draft.bizType) === '公司付款'
  const projectId = companyPayment ? null : nullableId(draft.projectId)
  await assertOptionalReference(tx, 'projects', projectId, '项目')
  await assertOptionalReference(tx, 'suppliers', draft.supplierId, '收款单位')
  if (draft.contractId) {
    const contract = await assertReference<{
      project_id: string
      supplier_id: string | null
      kind: string
      sub_kind: string | null
    }>(tx, 'contracts', draft.contractId, '关联合同')
    if (projectId && contract.project_id !== projectId)
      throw new Error('关联合同不属于所选项目')
    if (!expenseContractMatchesPaymentType(text(draft.bizType), contract))
      throw new Error('关联合同类型与付款申请业务类型不一致')
    if (!contract.supplier_id)
      throw new Error('关联合同未指向实际分供方，不能作为付款对象依据')
    if (draft.supplierId && contract.supplier_id && contract.supplier_id !== draft.supplierId)
      throw new Error('收款单位与关联合同不一致')
  }
  if (action !== 'draft') {
    requireFields([
      ['付款申请名称', draft.name],
      ['业务类型', draft.bizType],
      ['申请日期', draft.applyDate],
      ['申请人', draft.applicant],
      ['回票类型', draft.invoiceState],
    ])
    if (!companyPayment)
      requireFields([['项目', projectId]])
    if (needsSettlementAllocation(text(draft.bizType)))
      requireFields([['收款单位', draft.supplierId], ['关联合同', draft.contractId]])
    if (amount <= 0)
      throw new Error('申请金额必须大于 0')
  }
  await validatePaymentApplicationAllocations(tx, draft, id, action, amount)

  const now = new Date().toISOString()
  const values = [
    generatedNo('FK', draft.no, id),
    text(draft.name),
    text(draft.bizType),
    projectId,
    nullableId(draft.supplierId),
    nullableId(draft.contractId),
    text(draft.costName),
    amount,
    text(draft.applyDate),
    text(draft.applicant),
    draft.invoiceState ?? '先款后票',
    text(draft.payContent),
    prepayDeduct,
    text(draft.prepayNote),
    approvedAmount,
    text(draft.approvalNote),
    lifecycleStatus(action, draft.status),
    text(draft.note),
    text(draft.externalRef),
    now,
  ]
  const logId = existing
    ? await withUpdateLog(tx, 'payment_applications', id, () => tx.execute(`
        UPDATE payment_applications
        SET no = ?, name = ?, biz_type = ?, project_id = ?, supplier_id = ?,
            contract_id = ?, cost_name = ?, apply_amount = ?, apply_date = ?,
            applicant = ?, invoice_state = ?, pay_content = ?, prepay_deduct = ?,
            prepay_note = ?, approved_amount = ?, approval_note = ?, status = ?,
            note = ?, external_ref = ?, updated_at = ?
        WHERE id = ?
      `, [...values, id]))
    : await (async () => {
        await tx.execute(`
          INSERT INTO payment_applications (
            id, no, name, biz_type, project_id, supplier_id, contract_id,
            cost_name, apply_amount, apply_date, applicant, invoice_state,
            pay_content, prepay_deduct, prepay_note, approved_amount,
            approval_note, status, note, external_ref, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, ...values.slice(0, -1), now, now])
        return logCreate(tx, 'payment_applications', id)
      })()

  await persistReplacementRows(
    tx,
    'payment_application_settlement_allocations',
    'payment_application_id',
    id,
    draft.settlementAllocations ?? [],
    async (allocationId, line) => {
      await tx.execute(`
        INSERT INTO payment_application_settlement_allocations (
          id, payment_application_id, settlement_id, allocated_amount,
          note, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        allocationId,
        id,
        nullableId(line.settlementId),
        positiveMoney('分摊金额', line.allocatedAmount),
        text(line.note),
        now,
        now,
      ])
    },
    'payment_settlement_allocation',
  )
  await persistReplacementRows(
    tx,
    'payment_application_invoice_allocations',
    'payment_application_id',
    id,
    draft.invoiceAllocations ?? [],
    async (allocationId, line) => {
      await tx.execute(`
        INSERT INTO payment_application_invoice_allocations (
          id, payment_application_id, invoice_id, allocated_amount,
          note, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        allocationId,
        id,
        nullableId(line.invoiceId),
        positiveMoney('分摊金额', line.allocatedAmount),
        text(line.note),
        now,
        now,
      ])
    },
    'payment_invoice_allocation',
  )
  return { id, logId }
}

async function validatePaymentRecord(
  tx: TransactionDb,
  draft: PaymentRecordFormDraft,
  action: F3SaveAction,
  id: string,
): Promise<number> {
  const amount = nonNegativeMoney('支付金额', draft.amount)
  await assertOptionalReference(tx, 'projects', draft.projectId, '项目')
  await assertOptionalReference(tx, 'suppliers', draft.supplierId, '收款分供方')
  const allocations = draft.applicationAllocations ?? []
  const ids = new Set<string>()
  for (const line of allocations) {
    const applicationId = nullableId(line.paymentApplicationId)
    if (!applicationId)
      throw new Error('付款申请不能为空')
    if (ids.has(applicationId))
      throw new Error('同一支付记录不能重复关联付款申请')
    ids.add(applicationId)
    positiveMoney('分摊金额', line.allocatedAmount)
    const application = await assertReference<{
      project_id: string | null
      supplier_id: string | null
      apply_amount: number
      approved_amount: number
    }>(tx, 'payment_applications', applicationId, '付款申请')
    if (nullableId(draft.projectId) !== application.project_id)
      throw new Error('付款申请与支付记录的项目归属不一致')
    if (draft.supplierId && application.supplier_id && application.supplier_id !== draft.supplierId)
      throw new Error('付款申请不属于所选分供方')
    if (action === 'confirm') {
      const [alreadyPaid] = await tx.select<{ amount: number }>(`
        SELECT COALESCE(SUM(allocation.allocated_amount), 0) AS amount
        FROM payment_record_application_allocations AS allocation
        JOIN payment_records AS payment
          ON payment.id = allocation.payment_record_id
        WHERE allocation.payment_application_id = ?
          AND allocation.payment_record_id <> ?
          AND allocation.deleted_at IS NULL
          AND payment.deleted_at IS NULL
          AND payment.confirmation_status = 'confirmed'
      `, [applicationId, id])
      const cap = application.approved_amount > 0
        ? application.approved_amount
        : application.apply_amount
      const thisAmount = positiveMoney('分摊金额', line.allocatedAmount)
      if ((alreadyPaid?.amount ?? 0) + thisAmount > cap + 0.0001)
        throw new Error('支付分摊超过付款申请可付金额')
    }
  }
  if (action !== 'draft') {
    requireFields([
      ['支付日期', draft.paymentDate],
      ['收款方', draft.payeeName],
      ['付款凭证号', draft.voucherNo],
      ['银行流水号', draft.bankSerialNo],
    ])
    if (amount <= 0)
      throw new Error('支付金额必须大于 0')
  }
  if (action === 'confirm' && !moneyEqual(sumMoney(allocations), amount))
    throw new Error('支付分摊合计必须等于支付金额')
  if (action === 'confirm')
    requireFields([['确认人', draft.confirmedBy]])
  return amount
}

async function savePaymentRecord(
  tx: TransactionDb,
  draft: PaymentRecordFormDraft,
  action: F3SaveAction,
): Promise<{ id: string, logId: string | null }> {
  const id = draft.id ?? generateId('payment_record')
  const existing = await activeRow<{ confirmation_status: string }>(
    tx,
    'payment_records',
    id,
  )
  if (existing?.confirmation_status === 'confirmed')
    throw new Error('已确认支付需先撤回再修改')
  const amount = await validatePaymentRecord(tx, draft, action, id)
  const now = new Date().toISOString()
  const confirmationStatus: PaymentConfirmationStatus = action === 'confirm'
    ? 'confirmed'
    : action === 'submit'
      ? 'needs_review'
      : (existing?.confirmation_status as PaymentConfirmationStatus | undefined)
        ?? draft.confirmationStatus
        ?? 'draft'
  const source = draft.source ?? 'manual'
  if (!['manual', 'image_ocr', 'excel_import'].includes(source))
    throw new Error('支付来源无效')
  const values = [
    generatedNo('ZF', draft.no, id),
    nullableId(draft.projectId),
    nullableId(draft.supplierId),
    text(draft.payeeName),
    text(draft.purpose),
    text(draft.paymentDate),
    amount,
    text(draft.paymentMethod),
    text(draft.voucherNo),
    text(draft.bankSerialNo),
    text(draft.payeeAccount),
    text(draft.payeeBank),
    text(draft.payeeBankAccount),
    text(draft.handler),
    source,
    text(draft.recognitionStatus) || (source === 'manual' ? 'not_applicable' : 'pending'),
    serializedOcrPayload(draft.ocrPayload),
    serializedConfidence(draft.fieldConfidence),
    action === 'confirm' ? 'needs_review' : confirmationStatus,
    '',
    null,
    text(draft.externalRef),
    text(draft.note),
    now,
  ]
  const logId = existing
    ? await withUpdateLog(tx, 'payment_records', id, () => tx.execute(`
        UPDATE payment_records
        SET no = ?, project_id = ?, supplier_id = ?, payee_name = ?, purpose = ?,
            payment_date = ?, amount = ?, payment_method = ?, voucher_no = ?,
            bank_serial_no = ?, payee_account = ?, payee_bank = ?,
            payee_bank_account = ?, handler = ?, source = ?, recognition_status = ?,
            ocr_payload = ?, field_confidence = ?, confirmation_status = ?,
            confirmed_by = ?, confirmed_at = ?,
            external_ref = ?, note = ?, updated_at = ?
        WHERE id = ?
      `, [...values, id]))
    : await (async () => {
        await tx.execute(`
          INSERT INTO payment_records (
            id, no, project_id, supplier_id, payee_name, purpose,
            payment_date, amount, payment_method, voucher_no, bank_serial_no,
            payee_account, payee_bank, payee_bank_account, handler, source,
            recognition_status, ocr_payload, field_confidence, confirmation_status,
            confirmed_by, confirmed_at, external_ref, note, created_at, updated_at
          )
          VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?
          )
        `, [id, ...values.slice(0, -1), now, now])
        return logCreate(tx, 'payment_records', id)
      })()

  await persistReplacementRows(
    tx,
    'payment_record_application_allocations',
    'payment_record_id',
    id,
    draft.applicationAllocations ?? [],
    async (allocationId, line) => {
      await tx.execute(`
        INSERT INTO payment_record_application_allocations (
          id, payment_record_id, payment_application_id, allocated_amount,
          note, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        allocationId,
        id,
        nullableId(line.paymentApplicationId),
        positiveMoney('分摊金额', line.allocatedAmount),
        text(line.note),
        now,
        now,
      ])
    },
    'payment_application_allocation',
  )
  let finalLogId = logId
  if (action === 'confirm') {
    finalLogId = await withUpdateLog(tx, 'payment_records', id, () => tx.execute(`
      UPDATE payment_records
      SET confirmation_status = 'confirmed', confirmed_by = ?,
          confirmed_at = ?, updated_at = ?
      WHERE id = ?
    `, [text(draft.confirmedBy), now, now, id]), text(draft.confirmedBy)) ?? logId
  }
  return { id, logId: finalLogId }
}

export async function saveFinanceForm(
  kind: F3FormKind,
  draft: F3FormDraft,
  action: F3SaveAction,
  attachments: FileRefChanges = {},
): Promise<F3SaveResult> {
  if (action === 'confirm' && kind !== 'payment_record')
    throw new Error('只有支付记录支持确认动作')
  return withTransaction(async (tx) => {
    let result: { id: string, logId: string | null }
    switch (kind) {
      case 'receipt':
        result = await saveReceipt(tx, draft as ReceiptFormDraft, action)
        break
      case 'invoice_application':
        result = await saveInvoiceApplication(
          tx,
          draft as InvoiceApplicationFormDraft,
          action,
        )
        break
      case 'current':
        result = await saveCurrentTransaction(
          tx,
          draft as CurrentTransactionFormDraft,
          action,
        )
        break
      case 'reimbursement':
        result = await saveReimbursement(
          tx,
          draft as ExpenseReimbursementFormDraft,
          action,
        )
        break
      case 'payment_application':
        result = await savePaymentApplication(
          tx,
          draft as PaymentApplicationFormDraft,
          action,
        )
        break
      case 'payment_record':
        result = await savePaymentRecord(
          tx,
          draft as PaymentRecordFormDraft,
          action,
        )
        break
    }
    const attachmentIds = await applyFileRefChanges(
      tx,
      OWNER_TYPE[kind],
      result.id,
      attachments,
    )
    return { ...result, attachmentIds }
  })
}

function mapCommon(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    no: String(row.no ?? ''),
    status: String(row.status ?? ''),
    note: String(row.note ?? ''),
  }
}

async function loadReceipt(id: string): Promise<FinanceFormRecordMap['receipt'] | null> {
  const [row] = await select<Record<string, unknown>>(`
    SELECT * FROM receipt_registrations WHERE id = ? AND deleted_at IS NULL
  `, [id])
  if (!row)
    return null
  return {
    ...mapCommon(row),
    receiptDate: String(row.receipt_date ?? ''),
    projectId: row.project_id == null ? null : String(row.project_id),
    contractId: row.contract_id == null ? null : String(row.contract_id),
    customerId: row.customer_id == null ? null : String(row.customer_id),
    payerAccount: String(row.payer_account ?? ''),
    amount: Number(row.amount) || 0,
    paymentMethod: String(row.payment_method ?? ''),
    acceptanceBillNo: String(row.acceptance_bill_no ?? ''),
    billDueDate: String(row.bill_due_date ?? ''),
    periodNo: String(row.period_no ?? ''),
    bankSerialNo: String(row.bank_serial_no ?? ''),
    handler: String(row.handler ?? ''),
    reviewStatus: String(row.review_status ?? ''),
  }
}

async function loadInvoiceApplication(
  id: string,
): Promise<FinanceFormRecordMap['invoice_application'] | null> {
  const [row] = await select<Record<string, unknown>>(`
    SELECT * FROM invoice_applications WHERE id = ? AND deleted_at IS NULL
  `, [id])
  if (!row)
    return null
  const amount = Number(row.amount) || 0
  const taxAmount = Number(row.tax_amount) || 0
  return {
    ...mapCommon(row),
    name: String(row.name ?? ''),
    projectId: row.project_id == null ? null : String(row.project_id),
    contractId: row.contract_id == null ? null : String(row.contract_id),
    customerId: row.customer_id == null ? null : String(row.customer_id),
    buyerNameSnapshot: String(row.buyer_name_snapshot ?? ''),
    buyerTaxNoSnapshot: String(row.buyer_tax_no_snapshot ?? ''),
    invoiceType: String(row.invoice_type ?? ''),
    amount,
    taxRate: Number(row.tax_rate) || 0,
    taxAmount,
    totalAmount: amount + taxAmount,
    invoiceContent: String(row.invoice_content ?? ''),
    invoiceRemark: String(row.invoice_remark ?? ''),
    applicant: String(row.applicant ?? ''),
    applicationDate: String(row.application_date ?? ''),
  }
}

async function loadCurrent(
  id: string,
): Promise<FinanceFormRecordMap['current'] | null> {
  const [row] = await select<Record<string, unknown>>(`
    SELECT * FROM current_transactions WHERE id = ? AND deleted_at IS NULL
  `, [id])
  if (!row)
    return null
  return {
    ...mapCommon(row),
    direction: String(row.direction) as CurrentDirection,
    projectId: row.project_id == null ? null : String(row.project_id),
    counterparty: String(row.counterparty ?? ''),
    purpose: String(row.purpose ?? ''),
    amount: Number(row.amount) || 0,
    paymentMethod: String(row.payment_method ?? ''),
    transactionDate: String(row.transaction_date ?? ''),
    bankSerialNo: String(row.bank_serial_no ?? ''),
    handler: String(row.handler ?? ''),
  }
}

async function loadReimbursement(
  id: string,
): Promise<FinanceFormRecordMap['reimbursement'] | null> {
  const [row] = await select<Record<string, unknown>>(`
    SELECT * FROM expense_reimbursements WHERE id = ? AND deleted_at IS NULL
  `, [id])
  if (!row)
    return null
  const lines = await select<Record<string, unknown>>(`
    SELECT * FROM expense_reimbursement_lines
    WHERE reimbursement_id = ? AND deleted_at IS NULL
    ORDER BY sort_order, created_at
  `, [id])
  const mappedLines = lines.map(line => ({
    id: String(line.id),
    expenseItem: String(line.expense_item ?? ''),
    expenseDate: String(line.expense_date ?? ''),
    amount: Number(line.amount) || 0,
    note: String(line.note ?? ''),
  }))
  return {
    ...mapCommon(row),
    projectId: row.project_id == null ? null : String(row.project_id),
    applicant: String(row.applicant ?? ''),
    category: String(row.category ?? ''),
    reimbursementDate: String(row.reimbursement_date ?? ''),
    invoiceCount: Number(row.invoice_count) || 0,
    reason: String(row.reason ?? ''),
    externalRef: String(row.external_ref ?? ''),
    lines: mappedLines,
    totalAmount: mappedLines.reduce((sum, line) => sum + line.amount, 0),
  }
}

export async function getPaymentApplicationSummary(
  id: string,
): Promise<PaymentApplicationSummary> {
  const [row] = await select<{
    apply_amount: number
    settlement_allocated: number
    invoice_allocated: number
    paid_amount: number
  }>(`
    SELECT
      application.apply_amount,
      COALESCE((
        SELECT SUM(allocation.allocated_amount)
        FROM payment_application_settlement_allocations AS allocation
        WHERE allocation.payment_application_id = application.id
          AND allocation.deleted_at IS NULL
      ), 0) AS settlement_allocated,
      COALESCE((
        SELECT SUM(allocation.allocated_amount)
        FROM payment_application_invoice_allocations AS allocation
        WHERE allocation.payment_application_id = application.id
          AND allocation.deleted_at IS NULL
      ), 0) AS invoice_allocated,
      COALESCE((
        SELECT SUM(allocation.allocated_amount)
        FROM payment_record_application_allocations AS allocation
        JOIN payment_records AS payment
          ON payment.id = allocation.payment_record_id
        WHERE allocation.payment_application_id = application.id
          AND allocation.deleted_at IS NULL
          AND payment.deleted_at IS NULL
          AND payment.confirmation_status = 'confirmed'
      ), 0) AS paid_amount
    FROM payment_applications AS application
    WHERE application.id = ? AND application.deleted_at IS NULL
  `, [id])
  if (!row)
    throw new Error('付款申请不存在或已删除')
  return {
    settlementAllocated: row.settlement_allocated,
    settlementDifference: row.apply_amount - row.settlement_allocated,
    invoiceAllocated: row.invoice_allocated,
    invoiceDifference: row.apply_amount - row.invoice_allocated,
    pendingInvoiceAmount: Math.max(row.apply_amount - row.invoice_allocated, 0),
    paidAmount: row.paid_amount,
  }
}

async function loadPaymentApplication(
  id: string,
): Promise<FinanceFormRecordMap['payment_application'] | null> {
  const [row] = await select<Record<string, unknown>>(`
    SELECT * FROM payment_applications WHERE id = ? AND deleted_at IS NULL
  `, [id])
  if (!row)
    return null
  const [settlements, invoices, summary] = await Promise.all([
    select<Record<string, unknown>>(`
      SELECT * FROM payment_application_settlement_allocations
      WHERE payment_application_id = ? AND deleted_at IS NULL
      ORDER BY created_at, id
    `, [id]),
    select<Record<string, unknown>>(`
      SELECT * FROM payment_application_invoice_allocations
      WHERE payment_application_id = ? AND deleted_at IS NULL
      ORDER BY created_at, id
    `, [id]),
    getPaymentApplicationSummary(id),
  ])
  return {
    ...mapCommon(row),
    name: String(row.name ?? ''),
    bizType: String(row.biz_type ?? ''),
    projectId: row.project_id == null ? null : String(row.project_id),
    supplierId: row.supplier_id == null ? null : String(row.supplier_id),
    contractId: row.contract_id == null ? null : String(row.contract_id),
    costName: String(row.cost_name ?? ''),
    applyAmount: Number(row.apply_amount) || 0,
    applyDate: String(row.apply_date ?? ''),
    applicant: String(row.applicant ?? ''),
    invoiceState: String(row.invoice_state) as InvoiceState,
    payContent: String(row.pay_content ?? ''),
    prepayDeduct: Number(row.prepay_deduct) || 0,
    prepayNote: String(row.prepay_note ?? ''),
    approvedAmount: Number(row.approved_amount) || 0,
    approvalNote: String(row.approval_note ?? ''),
    externalRef: String(row.external_ref ?? ''),
    settlementAllocations: settlements.map(line => ({
      id: String(line.id),
      settlementId: String(line.settlement_id),
      allocatedAmount: Number(line.allocated_amount) || 0,
      note: String(line.note ?? ''),
    })),
    invoiceAllocations: invoices.map(line => ({
      id: String(line.id),
      invoiceId: String(line.invoice_id),
      allocatedAmount: Number(line.allocated_amount) || 0,
      note: String(line.note ?? ''),
    })),
    ...summary,
  }
}

async function loadPaymentRecord(
  id: string,
): Promise<FinanceFormRecordMap['payment_record'] | null> {
  const [row] = await select<Record<string, unknown>>(`
    SELECT * FROM payment_records WHERE id = ? AND deleted_at IS NULL
  `, [id])
  if (!row)
    return null
  const allocations = await select<Record<string, unknown>>(`
    SELECT * FROM payment_record_application_allocations
    WHERE payment_record_id = ? AND deleted_at IS NULL
    ORDER BY created_at, id
  `, [id])
  return {
    id: String(row.id),
    no: String(row.no ?? ''),
    projectId: row.project_id == null ? null : String(row.project_id),
    supplierId: row.supplier_id == null ? null : String(row.supplier_id),
    payeeName: String(row.payee_name ?? ''),
    purpose: String(row.purpose ?? ''),
    paymentDate: String(row.payment_date ?? ''),
    amount: Number(row.amount) || 0,
    paymentMethod: String(row.payment_method ?? ''),
    voucherNo: String(row.voucher_no ?? ''),
    bankSerialNo: String(row.bank_serial_no ?? ''),
    payeeAccount: String(row.payee_account ?? ''),
    payeeBank: String(row.payee_bank ?? ''),
    payeeBankAccount: String(row.payee_bank_account ?? ''),
    handler: String(row.handler ?? ''),
    source: String(row.source) as PaymentSource,
    recognitionStatus: String(row.recognition_status ?? ''),
    ocrPayload: String(row.ocr_payload ?? '{}'),
    fieldConfidence: String(row.field_confidence ?? '{}'),
    confirmationStatus: String(row.confirmation_status) as PaymentConfirmationStatus,
    confirmedBy: String(row.confirmed_by ?? ''),
    confirmedAt: row.confirmed_at == null ? null : String(row.confirmed_at),
    externalRef: String(row.external_ref ?? ''),
    note: String(row.note ?? ''),
    applicationAllocations: allocations.map(line => ({
      id: String(line.id),
      paymentApplicationId: String(line.payment_application_id),
      allocatedAmount: Number(line.allocated_amount) || 0,
      note: String(line.note ?? ''),
    })),
  }
}

export async function loadFinanceForm<K extends F3FormKind>(
  kind: K,
  id: string,
): Promise<FinanceFormRecordMap[K] | null> {
  switch (kind) {
    case 'receipt':
      return await loadReceipt(id) as FinanceFormRecordMap[K] | null
    case 'invoice_application':
      return await loadInvoiceApplication(id) as FinanceFormRecordMap[K] | null
    case 'current':
      return await loadCurrent(id) as FinanceFormRecordMap[K] | null
    case 'reimbursement':
      return await loadReimbursement(id) as FinanceFormRecordMap[K] | null
    case 'payment_application':
      return await loadPaymentApplication(id) as FinanceFormRecordMap[K] | null
    case 'payment_record':
      return await loadPaymentRecord(id) as FinanceFormRecordMap[K] | null
  }
}

export function listFinanceFormAttachments(
  kind: F3FormKind,
  id: string,
  includeDeleted = false,
): Promise<FileRefRecord[]> {
  return listFileRefs(OWNER_TYPE[kind], id, includeDeleted)
}

export async function unconfirmPaymentRecord(id: string): Promise<void> {
  await withTransaction(async (tx) => {
    const record = await assertReference<{ confirmation_status: string }>(
      tx,
      'payment_records',
      id,
      '支付记录',
    )
    if (record.confirmation_status !== 'confirmed')
      return
    await withUpdateLog(tx, 'payment_records', id, () => tx.execute(`
      UPDATE payment_records
      SET confirmation_status = 'needs_review',
          confirmed_by = '',
          confirmed_at = NULL,
          updated_at = ?
      WHERE id = ?
    `, [new Date().toISOString(), id]))
  })
}

export async function deleteFinanceForm(
  kind: F3FormKind,
  id: string,
): Promise<string | null> {
  return withTransaction(async tx => softDelete(tx, TABLE_BY_KIND[kind], id))
}

export async function getProjectConfirmedPaymentTotal(
  projectId: string,
): Promise<number> {
  const [row] = await select<{ amount: number }>(`
    SELECT COALESCE(SUM(amount), 0) AS amount
    FROM payment_records
    WHERE project_id = ?
      AND confirmation_status = 'confirmed'
      AND deleted_at IS NULL
  `, [projectId])
  return row?.amount ?? 0
}
