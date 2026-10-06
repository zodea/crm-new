import type { ApprovedAmountEdit, ApprovedAmountOrigin } from './approval-amount'
import type { ExpenseClearanceVerificationEdit, ExpenseClearanceVerificationState } from './clearance-verification'
import type { PaymentVerificationEdit, PaymentVerificationState } from './payment-verification'
import type { FinanceDomainTx } from './reference'
import type { TransactionDb } from '~/lib/db/coordinator'

import { isConfirmedExpenditureSettlement } from '~/lib/contract/effective-status'
import {
  logCreate,
  softDelete,
  withUpdateLog,
} from '~/lib/db/soft-delete'
import { readNativeOtherSettlementReference } from '~/lib/other-settlement/storage'
import { generateId } from '~/lib/util/id'
import { approvalAmountForSave, paymentConfirmationCap } from './approval-amount'
import { originalExpenseReference } from './expense-references'
import { financePartySnapshot } from './party-references'
import { requiresPaymentVerification } from './payment-verification'
import { FinanceAmountSourceError, requireVerifiedFinanceNumbers, verifiedFinanceNumber, verifiedFinanceSum } from './persistent-rows'
import { isFinanceReferenceTable } from './reference'

export type F3FormKind
  = | 'receipt'
    | 'invoice_application'
    | 'current'
    | 'payment_record'
    | 'reimbursement'
    | 'payment_application'

export type F3SaveAction = 'draft' | 'save' | 'submit' | 'confirm'
export type InvoiceState = '先票后款' | '先款后票' | '无需发票'
/** Only post-payment invoicing creates an outstanding invoice obligation. */
export function pendingInvoiceAmountForRead(invoiceState: unknown, applyAmount: unknown, invoiceAllocated: unknown): number | null {
  const applied = verifiedFinanceSum([applyAmount])
  const allocated = verifiedFinanceSum([invoiceAllocated])
  if (invoiceState === '先款后票')
    return Math.max(applied - allocated, 0)
  if (invoiceState === '先票后款' || invoiceState === '无需发票')
    return 0
  return null
}
export type CurrentDirection = 'receipt' | 'payment'
export type PaymentSource = 'manual' | 'image_ocr' | 'excel_import'
export const PAYMENT_BIZ_TYPES = ['有合同-合同劳务', '有合同-材料', '有合同-专业分包', '有合同-机械', '有合同-其他', '无合同-零星采购', '预付款', '管理费', '项目费用', '公司付款'] as const
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
  supplierId?: string | null
  counterpartyNameSnapshot?: string | null
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
  /** 明确采用的既有费用行，不根据姓名、项目或金额猜接。 */
  originalExpenseLineId?: string | null
  counterpartySupplierId?: string | null
  counterpartyNameSnapshot?: string | null
  expenseItem?: string
  expenseDate?: string
  amount?: number | null
  note?: string
}

export interface ExpenseReimbursementFormDraft {
  clearanceVerificationEdit?: ExpenseClearanceVerificationEdit
  clearanceVerification?: ExpenseClearanceVerificationState
  clearanceAttachmentsOnly?: true
  id?: string
  no?: string
  projectId?: string | null
  applicant?: string
  applicantWorkerId?: string | null
  applicantSupplierId?: string | null
  applicantNameSnapshot?: string | null
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
  verificationEdit?: PaymentVerificationEdit
  paymentVerification?: PaymentVerificationState
  id?: string
  no?: string
  name?: string
  bizType?: string
  projectId?: string | null
  supplierId?: string | null
  workerId?: string | null
  payeeNameSnapshot?: string | null
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
  approvedAmountOrigin?: ApprovedAmountOrigin
  approvedAmountEdit?: ApprovedAmountEdit
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
  workerId?: string | null
  payeeNameSnapshot?: string | null
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
  pendingInvoiceAmount: number | null
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
  payment_application: Required<Omit<PaymentApplicationFormDraft, 'approvedAmountEdit' | 'verificationEdit' | 'settlementAllocations' | 'invoiceAllocations'>> & PaymentApplicationSummary & {
    applyAmount: number
    prepayDeduct: number
    settlementAllocations: Array<{ id: string, settlementId: string, allocatedAmount: number, note: string }>
    invoiceAllocations: Array<{ id: string, invoiceId: string, allocatedAmount: number, note: string }>
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
    | 'workers'
    | 'contracts'
    | 'expenditure_settlements'
    | 'invoices'

export const FINANCE_OWNER_TYPE: Record<F3FormKind, string> = {
  receipt: 'receipt_registration',
  invoice_application: 'invoice_application',
  current: 'current_transaction',
  reimbursement: 'expense_reimbursement',
  payment_application: 'payment_application',
  payment_record: 'payment_record',
}

export const FINANCE_TABLE_BY_KIND: Record<F3FormKind, FinanceTable> = {
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

function nullableSnapshot(value: unknown): string | null {
  return typeof value === 'string' ? value : null
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
  tx: Pick<FinanceDomainTx, 'select' | 'references'>,
  table: FinanceTable,
  id: unknown,
): Promise<T | null> {
  const normalized = nullableId(id)
  if (!normalized)
    return null
  if (tx.references && isFinanceReferenceTable(table))
    return tx.references.read<T>(table, normalized)
  if (table === 'expenditure_settlements')
    return await readNativeOtherSettlementReference(tx, normalized) as T | null
  const rows = await tx.select<T>(
    `SELECT * FROM "${table}" WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [normalized],
  )
  return rows[0] ?? null
}

async function assertReference<T>(
  tx: Pick<FinanceDomainTx, 'select' | 'references'>,
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
  tx: Pick<FinanceDomainTx, 'select' | 'references'>,
  table: FinanceTable,
  id: unknown,
  label: string,
): Promise<void> {
  if (nullableId(id))
    await assertReference(tx, table, id, label)
}

async function persistReplacementRows<T>(
  tx: FinanceDomainTx,
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
  tx: FinanceDomainTx,
  draft: ReceiptFormDraft,
  action: F3SaveAction,
): Promise<number> {
  const amount = nonNegativeMoney('收款金额', draft.amount)
  const project = await activeRow<{ id: string, customer_id: string | null }>(
    tx,
    'projects',
    draft.projectId,
  )
  if (nullableId(draft.projectId) && !project)
    throw new Error('项目不存在或已删除')
  const customerId = nullableId(draft.customerId)
  const customer = await activeRow<{ id: string }>(
    tx,
    'customers',
    customerId,
  )
  if (customerId && !customer)
    throw new Error('付款方客户不存在或已删除')
  if (project && customerId && project.customer_id !== customerId)
    throw new Error('付款方客户必须是所选项目的主客户')
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
    if (customerId && contract.customer_id && contract.customer_id !== customerId)
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
  tx: FinanceDomainTx,
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
  tx: FinanceDomainTx,
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
  tx: FinanceDomainTx,
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
  tx: FinanceDomainTx,
  draft: CurrentTransactionFormDraft,
  action: F3SaveAction,
): Promise<{ id: string, logId: string | null }> {
  const existing = await activeRow<Record<string, unknown>>(tx, 'current_transactions', draft.id)
  if (action !== 'draft' && (!existing || existing.status === 'draft'))
    await assertOptionalReference(tx, 'suppliers', draft.supplierId, '往来分供方')
  const party = await financePartySnapshot(tx, { supplierId: draft.supplierId }, existing
    ? {
        workerId: null,
        supplierId: nullableId(existing.supplier_id),
        nameSnapshot: nullableSnapshot(existing.counterparty_name_snapshot),
      }
    : undefined, tx.references)
  if (action !== 'draft' && (!existing || existing.status === 'draft') && !party.supplierId)
    throw new Error('新增往来收付请明确选择分供方，个人临时金也使用分供方目录')
  const amount = nonNegativeMoney('往来金额', draft.amount)
  await assertOptionalReference(tx, 'projects', draft.projectId, '项目')
  if (draft.direction && !['receipt', 'payment'].includes(draft.direction))
    throw new Error('收付方向无效')
  if (action !== 'draft') {
    requireFields([
      ['收付方向', draft.direction],
      ['项目', draft.projectId],
      ['往来方', party.nameSnapshot || draft.counterparty],
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
    existing ? String(existing.counterparty ?? '') : text(draft.counterparty),
    party.supplierId,
    party.nameSnapshot,
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
  const logId = existing
    ? await withUpdateLog(tx, 'current_transactions', id, () => tx.execute(`
        UPDATE current_transactions
        SET no = ?, direction = ?, project_id = ?, counterparty = ?, supplier_id = ?, counterparty_name_snapshot = ?, purpose = ?,
            amount = ?, payment_method = ?, transaction_date = ?,
            bank_serial_no = ?, handler = ?, status = ?, note = ?, updated_at = ?
        WHERE id = ?
      `, [...values, id]))
    : await (async () => {
        await tx.execute(`
          INSERT INTO current_transactions (
            id, no, direction, project_id, counterparty, supplier_id, counterparty_name_snapshot, purpose, amount,
            payment_method, transaction_date, bank_serial_no, handler,
            status, note, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, ...values.slice(0, -1), now, now])
        return logCreate(tx, 'current_transactions', id)
      })()
  return { id, logId }
}

async function saveReimbursement(
  tx: FinanceDomainTx,
  draft: ExpenseReimbursementFormDraft,
  action: F3SaveAction,
): Promise<{ id: string, logId: string | null }> {
  const existing = await activeRow<Record<string, unknown>>(tx, 'expense_reimbursements', draft.id)
  const inputLines = draft.lines ?? []
  const adoptingNewExpense = action !== 'draft' && (!existing || existing.status === 'draft')
  // A new expense adopts a currently valid master. Clearance of an already
  // adopted expense continues to use that expense's proven frozen identity.
  if (adoptingNewExpense && inputLines.some(line => !nullableId(line.originalExpenseLineId))) {
    await assertOptionalReference(tx, 'workers', draft.applicantWorkerId, '垫付工人')
    await assertOptionalReference(tx, 'suppliers', draft.applicantSupplierId, '垫付分供方')
  }
  const applicant = await financePartySnapshot(tx, { workerId: draft.applicantWorkerId, supplierId: draft.applicantSupplierId }, existing
    ? {
        workerId: nullableId(existing.applicant_worker_id),
        supplierId: nullableId(existing.applicant_supplier_id),
        nameSnapshot: nullableSnapshot(existing.applicant_name_snapshot),
      }
    : undefined, tx.references)
  if (action !== 'draft' && (!existing || existing.status === 'draft') && !applicant.workerId && !applicant.supplierId)
    throw new Error('新增报销请明确选择工人或分供方身份，不能按姓名猜关联')
  await assertOptionalReference(tx, 'projects', draft.projectId, '项目')
  const lines = action === 'draft'
    ? inputLines.filter((line, index) => {
        const amount = Number(line.amount)
        if (!Number.isFinite(amount) || amount < 0)
          positiveMoney(`第 ${index + 1} 行金额`, line.amount)
        return amount > 0
      })
    : inputLines
  const clearanceBySource = new Map<string, number>()
  const sourceParties = new Map<string, { supplierId: string | null, nameSnapshot: string | null }>()
  for (const [index, line] of lines.entries()) {
    positiveMoney(`第 ${index + 1} 行金额`, line.amount)
    const sourceId = nullableId(line.originalExpenseLineId)
    if (adoptingNewExpense && !sourceId)
      await assertOptionalReference(tx, 'suppliers', line.counterpartySupplierId, `第 ${index + 1} 行实际服务分供方`)
    if (sourceId) {
      const original = await originalExpenseReference(tx, sourceId)
      if (!original || original.projectId !== nullableId(draft.projectId) || original.reimbursementId === draft.id)
        throw new Error(`第 ${index + 1} 行原费用必须是同归属已确认的独立费用`)
      const [owner] = await tx.select<Record<string, unknown>>('SELECT * FROM expense_reimbursements WHERE id = ?', [original.reimbursementId])
      const [sourceLine] = await tx.select<Record<string, unknown>>('SELECT * FROM expense_reimbursement_lines WHERE id = ?', [sourceId])
      const sourceWorkerId = nullableId(owner?.applicant_worker_id)
      const sourceSupplierId = nullableId(owner?.applicant_supplier_id)
      const sourceCounterpartyId = nullableId(sourceLine?.counterparty_supplier_id)
      if (line.counterpartySupplierId && line.counterpartySupplierId !== sourceCounterpartyId)
        throw new Error('原费用清偿不能改换实际交易方')
      sourceParties.set(sourceId, { supplierId: sourceCounterpartyId, nameSnapshot: nullableSnapshot(sourceLine?.counterparty_name_snapshot) })
      if (action !== 'draft') {
        if ((!sourceWorkerId && !sourceSupplierId) || !owner?.applicant_name_snapshot)
          throw new Error('原费用垫付身份尚待核实，只能保留草稿，不能确认清偿')
        if (sourceWorkerId !== applicant.workerId || sourceSupplierId !== applicant.supplierId)
          throw new Error('清偿必须采用原费用的同一垫付工人或分供方身份')
        const clearanceRows = await tx.select<{ amount: unknown }>(`
          SELECT clearance.amount FROM expense_reimbursement_lines AS clearance
          JOIN expense_reimbursements AS owner ON owner.id = clearance.reimbursement_id
          WHERE clearance.original_expense_line_id = ? AND clearance.deleted_at IS NULL AND owner.deleted_at IS NULL
            AND owner.status NOT IN ('draft','草稿','cancelled','作废','无效') AND owner.id <> ?
        `, [sourceId, draft.id ?? ''])
        const repaid = verifiedFinanceSum(clearanceRows.map(clearance => clearance.amount))
        const inThisForm = (clearanceBySource.get(sourceId) ?? 0) + positiveMoney('清偿金额', line.amount)
        if (repaid + inThisForm > original.amount + 0.0001)
          throw new Error('同一原费用累计清偿金额不能超过原垫付金额')
        clearanceBySource.set(sourceId, inThisForm)
      }
    }
    if (action !== 'draft')
      requireFields([[`第 ${index + 1} 行费用项目`, line.expenseItem]])
  }
  if (action !== 'draft') {
    requireFields([
      ['报销人', applicant.nameSnapshot || draft.applicant],
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
    existing ? String(existing.applicant ?? '') : text(draft.applicant),
    applicant.workerId,
    applicant.supplierId,
    applicant.nameSnapshot,
    text(draft.category),
    text(draft.reimbursementDate),
    integerCount('发票张数', draft.invoiceCount),
    text(draft.reason),
    lifecycleStatus(action, draft.status),
    text(draft.note),
    text(draft.externalRef),
    now,
  ]
  const logId = existing
    ? await withUpdateLog(tx, 'expense_reimbursements', id, () => tx.execute(`
        UPDATE expense_reimbursements
        SET no = ?, project_id = ?, applicant = ?, applicant_worker_id = ?, applicant_supplier_id = ?, applicant_name_snapshot = ?, category = ?,
            reimbursement_date = ?, invoice_count = ?, reason = ?, status = ?,
            note = ?, external_ref = ?, updated_at = ?
        WHERE id = ?
      `, [...values, id]))
    : await (async () => {
        await tx.execute(`
          INSERT INTO expense_reimbursements (
            id, no, project_id, applicant, applicant_worker_id, applicant_supplier_id, applicant_name_snapshot, category, reimbursement_date,
            invoice_count, reason, status, note, external_ref,
            created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, ...values.slice(0, -1), now, now])
        return logCreate(tx, 'expense_reimbursements', id)
      })()
  const currentLines = await tx.select<{ id: string }>(`
    SELECT id FROM expense_reimbursement_lines
    WHERE reimbursement_id = ? AND deleted_at IS NULL
  `, [id])
  const ownedLineIds = new Set(currentLines.map(line => line.id))
  const adoptedLineIds = new Set<string>()
  for (const [index, line] of lines.entries()) {
    const existingId = nullableId(line.id)
    if (existingId && !ownedLineIds.has(existingId))
      throw new Error('费用明细身份不属于当前报销单或已删除，请重新读取')
    if (existingId && adoptedLineIds.has(existingId))
      throw new Error('同一费用明细不能重复采用，请使用复制新增')
    const lineId = existingId ?? generateId('expense_line')
    adoptedLineIds.add(lineId)
    const previous = existingId ? (await tx.select<Record<string, unknown>>('SELECT * FROM expense_reimbursement_lines WHERE id = ?', [existingId]))[0] : null
    const sourceParty = line.originalExpenseLineId ? sourceParties.get(line.originalExpenseLineId) : undefined
    const counterparty = sourceParty ?? await financePartySnapshot(tx, { supplierId: line.counterpartySupplierId }, previous
      ? {
          workerId: null,
          supplierId: nullableId(previous.counterparty_supplier_id),
          nameSnapshot: nullableSnapshot(previous.counterparty_name_snapshot),
        }
      : undefined, tx.references)
    const lineValues = [
      text(line.expenseItem),
      text(line.expenseDate),
      positiveMoney(`第 ${index + 1} 行金额`, line.amount),
      text(line.note),
      index,
      nullableId(line.originalExpenseLineId),
      counterparty.supplierId,
      counterparty.nameSnapshot,
      now,
    ]
    if (existingId) {
      await withUpdateLog(tx, 'expense_reimbursement_lines', lineId, () => tx.execute(`
        UPDATE expense_reimbursement_lines
        SET expense_item = ?, expense_date = ?, amount = ?, note = ?, sort_order = ?, original_expense_line_id = ?, counterparty_supplier_id = ?, counterparty_name_snapshot = ?, updated_at = ?
        WHERE id = ? AND reimbursement_id = ? AND deleted_at IS NULL
      `, [...lineValues, lineId, id]))
    }
    else {
      await tx.execute(`
        INSERT INTO expense_reimbursement_lines (
          id, reimbursement_id, expense_item, expense_date, amount,
          note, sort_order, original_expense_line_id, counterparty_supplier_id, counterparty_name_snapshot, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [lineId, id, ...lineValues.slice(0, -1), now, now])
      await logCreate(tx, 'expense_reimbursement_lines', lineId)
    }
  }
  for (const line of currentLines) {
    if (!adoptedLineIds.has(line.id))
      await softDelete(tx, 'expense_reimbursement_lines', line.id)
  }
  return { id, logId }
}

export function needsSettlementAllocation(bizType: string, hasAllocations = false, workerId?: string | null): boolean {
  return hasAllocations || Boolean(workerId) || bizType.startsWith('有合同-') || ['无合同-零星采购', '项目费用'].includes(bizType)
}

export function expenseContractMatchesPaymentType(
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
export function expenseContractKindsForPaymentType(bizType: string): string[] {
  return ['分包', '材采', '其他支出'].filter(kind => [null, '劳务', '专业'].some(sub_kind => expenseContractMatchesPaymentType(bizType, { kind, sub_kind })))
}

async function hasConfirmedPaymentForApplication(tx: Pick<TransactionDb, 'select'>, id: string): Promise<boolean> {
  return (await tx.select(`SELECT 1 FROM payment_record_application_allocations allocation JOIN payment_records payment ON payment.id=allocation.payment_record_id
    WHERE allocation.payment_application_id=? AND allocation.deleted_at IS NULL AND payment.deleted_at IS NULL AND payment.confirmation_status='confirmed' LIMIT 1`, [id])).length > 0
}

async function existingApplicationAllocationTotal(tx: Pick<TransactionDb, 'select'>, family: 'settlement' | 'invoice', sourceId: string, excludeId: string): Promise<number> {
  const table = family === 'settlement' ? 'payment_application_settlement_allocations' : 'payment_application_invoice_allocations'
  const field = family === 'settlement' ? 'settlement_id' : 'invoice_id'
  const rows = await tx.select<{ amount: unknown, application_id: string, allocation_deleted_at: string | null, application_deleted_at: string | null }>(`SELECT allocation.allocated_amount AS amount,head.id AS application_id,allocation.deleted_at AS allocation_deleted_at,head.deleted_at AS application_deleted_at
    FROM ${table} allocation JOIN payment_applications head ON head.id=allocation.payment_application_id WHERE allocation.${field}=? AND allocation.payment_application_id<>?`, [sourceId, excludeId])
  const active: unknown[] = []
  for (const row of rows) {
    if (row.application_deleted_at !== null) {
      if (await hasConfirmedPaymentForApplication(tx, row.application_id))
        throw new FinanceAmountSourceError('原来源存在已删除申请的真实支付历史，余款资格尚未核实；保留原现金、原件和历史，不可释放额度再次申请。')
      continue
    }
    if (row.allocation_deleted_at === null)
      active.push(row.amount)
  }
  return verifiedFinanceSum(active)
}

export async function deleteFinanceFormInTransaction(kind: F3FormKind, id: string, tx: TransactionDb, operator?: string): Promise<string | null> {
  if (kind === 'payment_record' && (await loadFinanceForm('payment_record', id, tx))?.confirmationStatus === 'confirmed')
    throw new Error('已确认支付需先撤回确认，不能删除实际现金事实')
  if (kind === 'payment_application' && await hasConfirmedPaymentForApplication(tx, id))
    throw new Error('付款申请已被真实确认支付采用，请先沿原支付撤回确认，不能删除冻结申请')
  return softDelete(tx, FINANCE_TABLE_BY_KIND[kind], id, operator)
}

async function validatePaymentApplicationAllocations(
  tx: FinanceDomainTx,
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
      project_id: string | null
      contract_id: string | null
      supplier_id: string | null
      worker_id?: string | null
      original_expense_line_ids?: string[]
      total_amount: number
      status: string
    }>(tx, 'expenditure_settlements', settlementId, '关联结算')
    if (!isConfirmedExpenditureSettlement(settlement.status))
      throw new Error('关联结算尚未确认，不能用于付款申请')
    if (nullableId(draft.projectId) !== settlement.project_id)
      throw new Error('关联结算不属于所选项目')
    if (draft.contractId && settlement.contract_id !== draft.contractId)
      throw new Error('关联结算不属于所选合同')
    if (nullableId(draft.workerId) !== nullableId(settlement.worker_id) || nullableId(draft.supplierId) !== nullableId(settlement.supplier_id))
      throw new Error('关联结算的真实收款对象与付款申请不一致')
    if (draft.workerId && (settlement.contract_id !== null || !Array.isArray(settlement.original_expense_line_ids) || settlement.original_expense_line_ids.length === 0))
      throw new Error('付给工人的本域清偿必须采用已核实的原费用结算；工人工资请使用既有工资收付流程')
    if (typeof settlement.total_amount !== 'number' || !Number.isFinite(settlement.total_amount) || settlement.total_amount <= 0)
      throw new Error('关联结算金额尚未可靠核实')
    const used = await existingApplicationAllocationTotal(tx, 'settlement', settlementId, id)
    if (used + positiveMoney('分摊金额', line.allocatedAmount) > settlement.total_amount + 0.0001)
      throw new Error('结算累计付款申请分摊超过可采用金额')
  }
  const settlementTotal = sumMoney(settlementLines)
  if (
    action !== 'draft'
    && needsSettlementAllocation(text(draft.bizType), settlementLines.length > 0, draft.workerId)
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
    const usedAmount = await existingApplicationAllocationTotal(tx, 'invoice', invoiceId, id)
    if (usedAmount + allocated > invoice.total_amount + 0.0001)
      throw new Error(`发票可关联额度不足，剩余 ${Math.max(invoice.total_amount - usedAmount, 0).toFixed(2)}`)
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
  tx: FinanceDomainTx,
  draft: PaymentApplicationFormDraft,
  action: F3SaveAction,
): Promise<{ id: string, logId: string | null }> {
  const amount = nonNegativeMoney('申请金额', draft.applyAmount)
  const prepayDeduct = nonNegativeMoney('扣除预付款金额', draft.prepayDeduct)
  const id = draft.id ?? generateId('payment_application')
  const existing = await activeRow<{
    biz_type: string
    invoice_state: string
    approved_amount: number | null
    approved_amount_origin: ApprovedAmountOrigin
    worker_id: string | null
    supplier_id: string | null
    payee_name_snapshot: string | null
  }>(tx, 'payment_applications', id)
  const approval = approvalAmountForSave(draft.approvedAmount, draft.approvedAmountEdit, existing)
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
  await assertOptionalReference(tx, 'workers', draft.workerId, '收款工人')
  const party = await financePartySnapshot(tx, { workerId: draft.workerId, supplierId: draft.supplierId }, existing ? { workerId: nullableId(existing.worker_id), supplierId: nullableId(existing.supplier_id), nameSnapshot: nullableSnapshot(existing.payee_name_snapshot) } : undefined, tx.references)
  if (party.workerId && ((action !== 'draft' && !draft.settlementAllocations?.length) || draft.contractId || draft.bizType === '管理费' || draft.bizType === '预付款' || draft.bizType?.startsWith('有合同-')))
    throw new Error('工人收款必须沿已核实原费用结算清偿；工资请使用工人工资实际收付流程')
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
    if (!PAYMENT_BIZ_TYPES.includes(text(draft.bizType) as typeof PAYMENT_BIZ_TYPES[number]))
      throw new Error('付款业务类型无效，工资请使用工人工资实际收付流程')
    if (!party.workerId && !party.supplierId)
      throw new Error('实际收款对象需明确选择工人或分供方稳定身份')
    requireFields([
      ['付款申请名称', draft.name],
      ['业务类型', draft.bizType],
      ['申请日期', draft.applyDate],
      ['申请人', draft.applicant],
      ['回票类型', draft.invoiceState],
    ])
    if (!companyPayment)
      requireFields([['项目', projectId]])
    if (text(draft.bizType).startsWith('有合同-'))
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
    party.workerId,
    party.nameSnapshot,
    nullableId(draft.contractId),
    text(draft.costName),
    amount,
    text(draft.applyDate),
    text(draft.applicant),
    draft.invoiceState ?? '先款后票',
    text(draft.payContent),
    prepayDeduct,
    text(draft.prepayNote),
    approval.approved_amount,
    approval.approved_amount_origin,
    text(draft.approvalNote),
    lifecycleStatus(action, draft.status),
    text(draft.note),
    text(draft.externalRef),
    now,
  ]
  const logId = existing
    ? await withUpdateLog(tx, 'payment_applications', id, () => tx.execute(`
        UPDATE payment_applications
        SET no = ?, name = ?, biz_type = ?, project_id = ?, supplier_id = ?, worker_id = ?, payee_name_snapshot = ?,
            contract_id = ?, cost_name = ?, apply_amount = ?, apply_date = ?,
            applicant = ?, invoice_state = ?, pay_content = ?, prepay_deduct = ?,
            prepay_note = ?, approved_amount = ?, approved_amount_origin = ?, approval_note = ?, status = ?,
            note = ?, external_ref = ?, updated_at = ?
        WHERE id = ?
      `, [...values, id]))
    : await (async () => {
        await tx.execute(`
          INSERT INTO payment_applications (
            id, no, name, biz_type, project_id, supplier_id, worker_id, payee_name_snapshot, contract_id,
            cost_name, apply_amount, apply_date, applicant, invoice_state,
            pay_content, prepay_deduct, prepay_note, approved_amount, approved_amount_origin,
            approval_note, status, note, external_ref, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  tx: FinanceDomainTx,
  draft: PaymentRecordFormDraft,
  action: F3SaveAction,
  id: string,
): Promise<number> {
  const amount = nonNegativeMoney('支付金额', draft.amount)
  await assertOptionalReference(tx, 'projects', draft.projectId, '项目')
  await assertOptionalReference(tx, 'suppliers', draft.supplierId, '收款分供方')
  await assertOptionalReference(tx, 'workers', draft.workerId, '收款工人')
  if (draft.workerId && draft.supplierId)
    throw new Error('付款对象只能选择工人或分供方之一')
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
      worker_id: string | null
      apply_amount: number
      approved_amount: number | null
      approved_amount_origin: ApprovedAmountOrigin
    }>(tx, 'payment_applications', applicationId, '付款申请')
    if (nullableId(draft.projectId) !== application.project_id)
      throw new Error('付款申请与支付记录的项目归属不一致')
    if (nullableId(draft.supplierId) !== application.supplier_id || nullableId(draft.workerId) !== nullableId(application.worker_id))
      throw new Error('付款申请与支付记录的真实收款对象不一致')
    if (action === 'confirm') {
      const alreadyPaid = await tx.select<{ amount: unknown }>(`
        SELECT allocation.allocated_amount AS amount
        FROM payment_record_application_allocations AS allocation
        JOIN payment_records AS payment
          ON payment.id = allocation.payment_record_id
        WHERE allocation.payment_application_id = ?
          AND allocation.payment_record_id <> ?
          AND allocation.deleted_at IS NULL
          AND payment.deleted_at IS NULL
          AND payment.confirmation_status = 'confirmed'
      `, [applicationId, id])
      const required = await requiresPaymentVerification(tx, applicationId)
      if (required && !tx.paymentVerification)
        throw new FinanceAmountSourceError('历史批复未知需先在可信财务来源完成业务核验；真实回单仍可保存草稿，既有实付保留。')
      const cap = required
        ? await tx.paymentVerification!.confirmationCap(applicationId)
        : paymentConfirmationCap(application.apply_amount, application.approved_amount, application.approved_amount_origin)
      const thisAmount = positiveMoney('分摊金额', line.allocatedAmount)
      if (verifiedFinanceSum(alreadyPaid.map(row => row.amount)) + thisAmount > cap + 0.0001)
        throw new Error('支付分摊超过付款申请可付金额')
    }
  }
  if (action !== 'draft') {
    if (!draft.supplierId && !draft.workerId)
      throw new Error('实际支付需明确工人或分供方稳定身份，历史收款原文继续保留')
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
  if (draft.workerId && ((action !== 'draft' && !allocations.length) || ['工资', '工资发放', '工人工资', '补发工资', '工资退款'].includes(text(draft.purpose))))
    throw new Error('工人支付需清偿原费用付款申请；工资使用工人工资实际收付流程')
  return amount
}

async function savePaymentRecord(
  tx: FinanceDomainTx,
  draft: PaymentRecordFormDraft,
  action: F3SaveAction,
): Promise<{ id: string, logId: string | null }> {
  const id = draft.id ?? generateId('payment_record')
  const existing = await activeRow<{ confirmation_status: string, worker_id: string | null, supplier_id: string | null, payee_name_snapshot: string | null }>(
    tx,
    'payment_records',
    id,
  )
  if (existing?.confirmation_status === 'confirmed')
    throw new Error('已确认支付需先撤回再修改')
  const amount = await validatePaymentRecord(tx, draft, action, id)
  const party = await financePartySnapshot(tx, { workerId: draft.workerId, supplierId: draft.supplierId }, existing ? { workerId: nullableId(existing.worker_id), supplierId: nullableId(existing.supplier_id), nameSnapshot: nullableSnapshot(existing.payee_name_snapshot) } : undefined, tx.references)
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
    party.workerId,
    party.nameSnapshot,
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
        SET no = ?, project_id = ?, supplier_id = ?, worker_id = ?, payee_name_snapshot = ?, payee_name = ?, purpose = ?,
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
            id, no, project_id, supplier_id, worker_id, payee_name_snapshot, payee_name, purpose,
            payment_date, amount, payment_method, voucher_no, bank_serial_no,
            payee_account, payee_bank, payee_bank_account, handler, source,
            recognition_status, ocr_payload, field_confidence, confirmation_status,
            confirmed_by, confirmed_at, external_ref, note, created_at, updated_at
          )
          VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
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

/** The same domain rules run inside the Native or production owner's transaction. */
export async function saveFinanceFormInTransaction(
  kind: F3FormKind,
  draft: F3FormDraft,
  action: F3SaveAction,
  tx: FinanceDomainTx,
): Promise<{ id: string, logId: string | null }> {
  if (('clearanceVerificationEdit' in draft && draft.clearanceVerificationEdit) || ('clearanceAttachmentsOnly' in draft && draft.clearanceAttachmentsOnly))
    throw new FinanceAmountSourceError('此运行来源尚无可信旧清偿核定身份，请使用已认证正式工作区；原记录与原件保留。')
  if ('verificationEdit' in draft && draft.verificationEdit)
    throw new FinanceAmountSourceError('此运行来源尚无可信业务核验身份，请使用已认证中央付款申请核验；输入与原件继续保留。')
  if (action === 'confirm' && kind !== 'payment_record')
    throw new Error('只有支付记录支持确认动作')
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
  return result
}

function mapCommon(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    no: String(row.no ?? ''),
    status: String(row.status ?? ''),
    note: String(row.note ?? ''),
  }
}

async function loadReceipt(id: string, db: Pick<TransactionDb, 'select'>): Promise<FinanceFormRecordMap['receipt'] | null> {
  const [row] = await db.select<Record<string, unknown>>(`
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
  db: Pick<TransactionDb, 'select'>,
): Promise<FinanceFormRecordMap['invoice_application'] | null> {
  const [row] = await db.select<Record<string, unknown>>(`
    SELECT * FROM invoice_applications WHERE id = ? AND deleted_at IS NULL
  `, [id])
  if (!row)
    return null
  requireVerifiedFinanceNumbers('invoice_applications', row)
  const amount = verifiedFinanceNumber(row.amount)
  const taxAmount = verifiedFinanceNumber(row.tax_amount)
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
    taxRate: verifiedFinanceNumber(row.tax_rate),
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
  db: Pick<TransactionDb, 'select'>,
): Promise<FinanceFormRecordMap['current'] | null> {
  const [row] = await db.select<Record<string, unknown>>(`
    SELECT * FROM current_transactions WHERE id = ? AND deleted_at IS NULL
  `, [id])
  if (!row)
    return null
  requireVerifiedFinanceNumbers('current_transactions', row)
  return {
    ...mapCommon(row),
    direction: String(row.direction) as CurrentDirection,
    projectId: row.project_id == null ? null : String(row.project_id),
    counterparty: String(row.counterparty ?? ''),
    supplierId: nullableId(row.supplier_id),
    counterpartyNameSnapshot: nullableSnapshot(row.counterparty_name_snapshot),
    purpose: String(row.purpose ?? ''),
    amount: verifiedFinanceNumber(row.amount),
    paymentMethod: String(row.payment_method ?? ''),
    transactionDate: String(row.transaction_date ?? ''),
    bankSerialNo: String(row.bank_serial_no ?? ''),
    handler: String(row.handler ?? ''),
  }
}

async function loadReimbursement(
  id: string,
  db: Pick<TransactionDb, 'select'>,
): Promise<FinanceFormRecordMap['reimbursement'] | null> {
  const [row] = await db.select<Record<string, unknown>>(`
    SELECT * FROM expense_reimbursements WHERE id = ? AND deleted_at IS NULL
  `, [id])
  if (!row)
    return null
  requireVerifiedFinanceNumbers('expense_reimbursements', row)
  const lines = await db.select<Record<string, unknown>>(`
    SELECT * FROM expense_reimbursement_lines
    WHERE reimbursement_id = ? AND deleted_at IS NULL
    ORDER BY sort_order, created_at
  `, [id])
  lines.forEach(line => requireVerifiedFinanceNumbers('expense_reimbursement_lines', line))
  const mappedLines = lines.map(line => ({
    id: String(line.id),
    originalExpenseLineId: line.original_expense_line_id == null ? null : String(line.original_expense_line_id),
    counterpartySupplierId: nullableId(line.counterparty_supplier_id),
    counterpartyNameSnapshot: nullableSnapshot(line.counterparty_name_snapshot),
    expenseItem: String(line.expense_item ?? ''),
    expenseDate: String(line.expense_date ?? ''),
    amount: verifiedFinanceNumber(line.amount),
    note: String(line.note ?? ''),
  }))
  return {
    ...mapCommon(row),
    projectId: row.project_id == null ? null : String(row.project_id),
    applicant: String(row.applicant ?? ''),
    applicantWorkerId: nullableId(row.applicant_worker_id),
    applicantSupplierId: nullableId(row.applicant_supplier_id),
    applicantNameSnapshot: nullableSnapshot(row.applicant_name_snapshot),
    category: String(row.category ?? ''),
    reimbursementDate: String(row.reimbursement_date ?? ''),
    invoiceCount: verifiedFinanceNumber(row.invoice_count),
    reason: String(row.reason ?? ''),
    externalRef: String(row.external_ref ?? ''),
    lines: mappedLines,
    totalAmount: mappedLines.reduce((sum, line) => sum + line.amount, 0),
  }
}

export async function getPaymentApplicationSummary(
  id: string,
  db: Pick<TransactionDb, 'select'>,
): Promise<PaymentApplicationSummary> {
  const [row] = await db.select<{ apply_amount: unknown, invoice_state: unknown }>('SELECT apply_amount,invoice_state FROM payment_applications WHERE id=? AND deleted_at IS NULL', [id])
  if (!row)
    throw new Error('付款申请不存在或已删除')
  const applyAmount = verifiedFinanceSum([row.apply_amount])
  const sources = await db.select<{ kind: string, value: unknown }>(`
    SELECT 'settlement' AS kind,allocated_amount AS value FROM payment_application_settlement_allocations WHERE payment_application_id=? AND deleted_at IS NULL
    UNION ALL SELECT 'invoice',allocated_amount FROM payment_application_invoice_allocations WHERE payment_application_id=? AND deleted_at IS NULL
    UNION ALL SELECT 'paid',allocation.allocated_amount FROM payment_record_application_allocations allocation JOIN payment_records payment ON payment.id=allocation.payment_record_id
      WHERE allocation.payment_application_id=? AND allocation.deleted_at IS NULL AND payment.deleted_at IS NULL AND payment.confirmation_status='confirmed'
    UNION ALL SELECT 'cash',payment.amount FROM payment_record_application_allocations allocation JOIN payment_records payment ON payment.id=allocation.payment_record_id
      WHERE allocation.payment_application_id=? AND allocation.deleted_at IS NULL AND payment.deleted_at IS NULL AND payment.confirmation_status='confirmed'
  `, [id, id, id, id])
  sources.forEach(source => verifiedFinanceSum([source.value]))
  const sum = (kind: string) => verifiedFinanceSum(sources.filter(source => source.kind === kind).map(source => source.value))
  const settlementAllocated = sum('settlement')
  const invoiceAllocated = sum('invoice')
  return {
    settlementAllocated,
    settlementDifference: applyAmount - settlementAllocated,
    invoiceAllocated,
    invoiceDifference: applyAmount - invoiceAllocated,
    pendingInvoiceAmount: pendingInvoiceAmountForRead(row.invoice_state, applyAmount, invoiceAllocated),
    paidAmount: sum('paid'),
  }
}

async function loadPaymentApplication(
  id: string,
  db: Pick<TransactionDb, 'select'>,
): Promise<FinanceFormRecordMap['payment_application'] | null> {
  const [row] = await db.select<Record<string, unknown>>(`
    SELECT * FROM payment_applications WHERE id = ? AND deleted_at IS NULL
  `, [id])
  if (!row)
    return null
  requireVerifiedFinanceNumbers('payment_applications', row)
  const [settlements, invoices, summary] = await Promise.all([
    db.select<Record<string, unknown>>(`
      SELECT * FROM payment_application_settlement_allocations
      WHERE payment_application_id = ? AND deleted_at IS NULL
      ORDER BY created_at, id
    `, [id]),
    db.select<Record<string, unknown>>(`
      SELECT * FROM payment_application_invoice_allocations
      WHERE payment_application_id = ? AND deleted_at IS NULL
      ORDER BY created_at, id
    `, [id]),
    getPaymentApplicationSummary(id, db),
  ])
  settlements.forEach(line => requireVerifiedFinanceNumbers('payment_application_settlement_allocations', line))
  invoices.forEach(line => requireVerifiedFinanceNumbers('payment_application_invoice_allocations', line))
  const verificationRequired = await requiresPaymentVerification(db, id)
  return {
    paymentVerification: { required: verificationRequired, status: verificationRequired ? 'missing' : 'not-required', message: verificationRequired ? '历史未知批复的新支付需在可信财务来源核验；原实付与回单草稿保留。' : '', proof: null },
    ...mapCommon(row),
    name: String(row.name ?? ''),
    bizType: String(row.biz_type ?? ''),
    projectId: row.project_id == null ? null : String(row.project_id),
    supplierId: row.supplier_id == null ? null : String(row.supplier_id),
    workerId: nullableId(row.worker_id),
    payeeNameSnapshot: nullableSnapshot(row.payee_name_snapshot),
    contractId: row.contract_id == null ? null : String(row.contract_id),
    costName: String(row.cost_name ?? ''),
    applyAmount: verifiedFinanceNumber(row.apply_amount),
    applyDate: String(row.apply_date ?? ''),
    applicant: String(row.applicant ?? ''),
    invoiceState: String(row.invoice_state) as InvoiceState,
    payContent: String(row.pay_content ?? ''),
    prepayDeduct: verifiedFinanceNumber(row.prepay_deduct),
    prepayNote: String(row.prepay_note ?? ''),
    approvedAmount: row.approved_amount === null ? null : verifiedFinanceNumber(row.approved_amount),
    approvedAmountOrigin: row.approved_amount_origin as ApprovedAmountOrigin,
    approvalNote: String(row.approval_note ?? ''),
    externalRef: String(row.external_ref ?? ''),
    settlementAllocations: settlements.map(line => ({
      id: String(line.id),
      settlementId: String(line.settlement_id),
      allocatedAmount: verifiedFinanceNumber(line.allocated_amount),
      note: String(line.note ?? ''),
    })),
    invoiceAllocations: invoices.map(line => ({
      id: String(line.id),
      invoiceId: String(line.invoice_id),
      allocatedAmount: verifiedFinanceNumber(line.allocated_amount),
      note: String(line.note ?? ''),
    })),
    ...summary,
  }
}

async function loadPaymentRecord(
  id: string,
  db: Pick<TransactionDb, 'select'>,
): Promise<FinanceFormRecordMap['payment_record'] | null> {
  const [row] = await db.select<Record<string, unknown>>(`
    SELECT * FROM payment_records WHERE id = ? AND deleted_at IS NULL
  `, [id])
  if (!row)
    return null
  requireVerifiedFinanceNumbers('payment_records', row)
  const allocations = await db.select<Record<string, unknown>>(`
    SELECT * FROM payment_record_application_allocations
    WHERE payment_record_id = ? AND deleted_at IS NULL
    ORDER BY created_at, id
  `, [id])
  allocations.forEach(line => requireVerifiedFinanceNumbers('payment_record_application_allocations', line))
  return {
    id: String(row.id),
    no: String(row.no ?? ''),
    projectId: row.project_id == null ? null : String(row.project_id),
    supplierId: row.supplier_id == null ? null : String(row.supplier_id),
    workerId: nullableId(row.worker_id),
    payeeNameSnapshot: nullableSnapshot(row.payee_name_snapshot),
    payeeName: String(row.payee_name ?? ''),
    purpose: String(row.purpose ?? ''),
    paymentDate: String(row.payment_date ?? ''),
    amount: verifiedFinanceNumber(row.amount),
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
      allocatedAmount: verifiedFinanceNumber(line.allocated_amount),
      note: String(line.note ?? ''),
    })),
  }
}

export async function loadFinanceForm<K extends F3FormKind>(
  kind: K,
  id: string,
  db: Pick<TransactionDb, 'select'>,
): Promise<FinanceFormRecordMap[K] | null> {
  switch (kind) {
    case 'receipt':
      return await loadReceipt(id, db) as FinanceFormRecordMap[K] | null
    case 'invoice_application':
      return await loadInvoiceApplication(id, db) as FinanceFormRecordMap[K] | null
    case 'current':
      return await loadCurrent(id, db) as FinanceFormRecordMap[K] | null
    case 'reimbursement':
      return await loadReimbursement(id, db) as FinanceFormRecordMap[K] | null
    case 'payment_application':
      return await loadPaymentApplication(id, db) as FinanceFormRecordMap[K] | null
    case 'payment_record':
      return await loadPaymentRecord(id, db) as FinanceFormRecordMap[K] | null
  }
}

export async function unconfirmPaymentRecordInTransaction(id: string, tx: FinanceDomainTx): Promise<void> {
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
}
