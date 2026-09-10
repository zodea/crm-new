import type { InvoiceState } from './forms'
import { CONFIRMED_SETTLEMENT_SQL_VALUES } from '~/lib/contract/effective-status'
import { select } from '~/lib/db/connection'
import { hiddenCtesFor, visibleCond } from '~/lib/db/soft-delete'

const EPSILON = 0.0001

export type PaymentInsightLevel = 'ok' | 'info' | 'warn' | 'danger'

export interface PaymentApplicationInsightInput {
  status: string
  bizType: string
  invoiceState: InvoiceState | string
  applyAmount: number
  approvedAmount: number
  settlementAllocated: number
  invoiceAllocated: number
  paidAmount: number
}

export interface PaymentApplicationInsightCheck {
  key: 'approval' | 'settlement' | 'invoice' | 'payment'
  title: string
  level: PaymentInsightLevel
  summary: string
  detail: string
}

export interface PaymentApplicationInsight {
  attentionCount: number
  checks: PaymentApplicationInsightCheck[]
}

export interface PaymentApplicationSettlementDetail {
  id: string
  no: string
  name: string
  totalAmount: number
  settlementDate: string
  status: string
  allocatedAmount: number
  note: string
}

export interface PaymentApplicationInvoiceDetail {
  id: string
  invoiceNumber: string
  invoiceDate: string
  totalAmount: number
  allocatedAmount: number
  note: string
}

export interface PaymentApplicationPaymentDetail {
  id: string
  no: string
  payeeName: string
  paymentDate: string
  amount: number
  confirmationStatus: string
  allocatedAmount: number
  voucherNo: string
}

export interface PaymentApplicationDetail {
  id: string
  no: string
  name: string
  bizType: string
  projectId: string | null
  projectName: string
  supplierId: string | null
  supplierName: string
  contractId: string | null
  contractNo: string
  contractName: string
  contractAmount: number
  contractSettledAmount: number
  contractPaidAmount: number
  costName: string
  applyAmount: number
  applyDate: string
  applicant: string
  invoiceState: InvoiceState | string
  payContent: string
  prepayDeduct: number
  prepayNote: string
  approvedAmount: number
  approvalNote: string
  status: string
  note: string
  externalRef: string
  createdAt: string
  updatedAt: string
  settlementAllocated: number
  settlementDifference: number
  invoiceAllocated: number
  invoiceDifference: number
  pendingInvoiceAmount: number
  paidAmount: number
  unpaidAmount: number
  supplierOtherProjectCount: number
  supplierOtherProjectPaidAmount: number
  settlements: PaymentApplicationSettlementDetail[]
  invoices: PaymentApplicationInvoiceDetail[]
  payments: PaymentApplicationPaymentDetail[]
  insight: PaymentApplicationInsight
}

function amount(value: unknown): number {
  const normalized = Number(value)
  return Number.isFinite(normalized) ? normalized : 0
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function displayAmount(value: number): string {
  return `¥${value.toFixed(2)}`
}

function isContractPayment(bizType: string): boolean {
  return bizType.startsWith('有合同-')
}

function isSubmitted(status: string): boolean {
  return ['submitted', 'approved', '已提交', '已审批', '已批复'].includes(status)
}

export function buildPaymentApplicationInsight(
  input: PaymentApplicationInsightInput,
): PaymentApplicationInsight {
  const applyAmount = Math.max(amount(input.applyAmount), 0)
  const approvedAmount = Math.max(amount(input.approvedAmount), 0)
  const settlementAllocated = Math.max(amount(input.settlementAllocated), 0)
  const invoiceAllocated = Math.max(amount(input.invoiceAllocated), 0)
  const paidAmount = Math.max(amount(input.paidAmount), 0)
  const settlementDifference = Math.max(applyAmount - settlementAllocated, 0)
  const pendingInvoiceAmount = Math.max(applyAmount - invoiceAllocated, 0)
  const paymentCap = approvedAmount > EPSILON ? approvedAmount : applyAmount
  const unpaidAmount = Math.max(paymentCap - paidAmount, 0)

  const checks: PaymentApplicationInsightCheck[] = [
    {
      key: 'approval',
      title: '申请流程',
      level: isSubmitted(input.status) ? 'ok' : 'warn',
      summary: isSubmitted(input.status) ? '已提交' : '尚未提交',
      detail: isSubmitted(input.status)
        ? '当前记录已进入业务处理阶段。系统暂不伪造审批人和审批时间。'
        : '保存草稿不会进入后续付款处理，请先补齐必填项并保存并提交。',
    },
    {
      key: 'settlement',
      title: '结算勾稽',
      level: !isContractPayment(input.bizType) || settlementDifference <= EPSILON ? 'ok' : 'danger',
      summary: !isContractPayment(input.bizType)
        ? '该类型无需关联结算'
        : settlementDifference <= EPSILON
          ? '已完全匹配'
          : `差额 ${displayAmount(settlementDifference)}`,
      detail: !isContractPayment(input.bizType)
        ? '当前业务类型不以支出结算单作为提交前置条件。'
        : settlementDifference <= EPSILON
          ? `已关联 ${displayAmount(settlementAllocated)}，与申请金额一致。`
          : `已关联 ${displayAmount(settlementAllocated)}，还缺少 ${displayAmount(settlementDifference)}；提交前必须补齐真实结算分摊。`,
    },
    {
      key: 'invoice',
      title: '发票勾稽',
      level: input.invoiceState === '无需发票'
        ? invoiceAllocated <= EPSILON ? 'ok' : 'danger'
        : pendingInvoiceAmount <= EPSILON ? 'ok' : 'warn',
      summary: input.invoiceState === '无需发票'
        ? invoiceAllocated <= EPSILON ? '无需发票' : '误挂发票'
        : pendingInvoiceAmount <= EPSILON ? '已完全关联' : `待回票 ${displayAmount(pendingInvoiceAmount)}`,
      detail: input.invoiceState === '无需发票'
        ? invoiceAllocated <= EPSILON
          ? '当前申请明确无需发票，未发现有效发票分摊。'
          : '当前申请标记为无需发票，但仍存在有效发票分摊，请先解除关联。'
        : pendingInvoiceAmount <= EPSILON
          ? `已关联 ${displayAmount(invoiceAllocated)} 发票金额。`
          : `当前回票类型允许后补发票，仍有 ${displayAmount(pendingInvoiceAmount)} 未关联。`,
    },
    {
      key: 'payment',
      title: '支付结果',
      level: paidAmount > paymentCap + EPSILON
        ? 'danger'
        : unpaidAmount > EPSILON ? 'info' : 'ok',
      summary: paidAmount > paymentCap + EPSILON
        ? '已付超出可付金额'
        : unpaidAmount > EPSILON ? `待支付 ${displayAmount(unpaidAmount)}` : '已付清',
      detail: paidAmount > paymentCap + EPSILON
        ? `已确认支付 ${displayAmount(paidAmount)}，超过当前可付上限 ${displayAmount(paymentCap)}。`
        : unpaidAmount > EPSILON
          ? `已确认支付 ${displayAmount(paidAmount)}，当前可付上限为 ${displayAmount(paymentCap)}。`
          : `已确认支付 ${displayAmount(paidAmount)}，当前申请已完成支付。`,
    },
  ]

  return {
    attentionCount: checks.filter(check => check.level === 'warn' || check.level === 'danger').length,
    checks,
  }
}

interface PaymentApplicationHeaderRow extends Record<string, unknown> {
  id: string
  no: string
  name: string
  biz_type: string
  project_id: string | null
  project_name: string | null
  supplier_id: string | null
  supplier_name: string | null
  contract_id: string | null
  contract_no: string | null
  contract_name: string | null
  contract_amount: number | null
  contract_settled_amount: number | null
  contract_paid_amount: number | null
  cost_name: string
  apply_amount: number
  apply_date: string
  applicant: string
  invoice_state: string
  pay_content: string
  prepay_deduct: number
  prepay_note: string
  approved_amount: number
  approval_note: string
  status: string
  note: string
  external_ref: string
  created_at: string
  updated_at: string
  settlement_allocated: number
  invoice_allocated: number
  paid_amount: number
  supplier_other_project_count: number
  supplier_other_project_paid_amount: number
}

const DETAIL_TABLES = [
  'payment_applications',
  'projects',
  'suppliers',
  'contracts',
  'expenditure_settlements',
  'invoices',
  'payment_records',
  'payment_application_settlement_allocations',
  'payment_application_invoice_allocations',
  'payment_record_application_allocations',
]

export async function loadPaymentApplicationDetail(
  id: string,
): Promise<PaymentApplicationDetail | null> {
  const [header] = await select<PaymentApplicationHeaderRow>(`
    ${hiddenCtesFor(...DETAIL_TABLES)}
    SELECT
      application.id,
      application.no,
      application.name,
      application.biz_type,
      application.project_id,
      project.name AS project_name,
      application.supplier_id,
      supplier.name AS supplier_name,
      application.contract_id,
      contract.no AS contract_no,
      contract.name AS contract_name,
      contract.amount AS contract_amount,
      COALESCE((
        SELECT SUM(settlement.total_amount)
        FROM expenditure_settlements AS settlement
        WHERE settlement.contract_id = application.contract_id
          AND ${visibleCond('expenditure_settlements', 'settlement')}
          AND settlement.status IN (${CONFIRMED_SETTLEMENT_SQL_VALUES})
      ), 0) AS contract_settled_amount,
      COALESCE((
        SELECT SUM(recordAllocation.allocated_amount)
        FROM payment_record_application_allocations AS recordAllocation
        JOIN payment_records AS record ON record.id = recordAllocation.payment_record_id
        WHERE recordAllocation.payment_application_id = application.id
          AND ${visibleCond('payment_record_application_allocations', 'recordAllocation')}
          AND ${visibleCond('payment_records', 'record')}
          AND record.confirmation_status = 'confirmed'
      ), 0) AS contract_paid_amount,
      application.cost_name,
      application.apply_amount,
      application.apply_date,
      application.applicant,
      application.invoice_state,
      application.pay_content,
      application.prepay_deduct,
      application.prepay_note,
      application.approved_amount,
      application.approval_note,
      application.status,
      application.note,
      application.external_ref,
      application.created_at,
      application.updated_at,
      COALESCE((
        SELECT SUM(allocation.allocated_amount)
        FROM payment_application_settlement_allocations AS allocation
        WHERE allocation.payment_application_id = application.id
          AND ${visibleCond('payment_application_settlement_allocations', 'allocation')}
      ), 0) AS settlement_allocated,
      COALESCE((
        SELECT SUM(allocation.allocated_amount)
        FROM payment_application_invoice_allocations AS allocation
        WHERE allocation.payment_application_id = application.id
          AND ${visibleCond('payment_application_invoice_allocations', 'allocation')}
      ), 0) AS invoice_allocated,
      COALESCE((
        SELECT SUM(allocation.allocated_amount)
        FROM payment_record_application_allocations AS allocation
        JOIN payment_records AS record ON record.id = allocation.payment_record_id
        WHERE allocation.payment_application_id = application.id
          AND ${visibleCond('payment_record_application_allocations', 'allocation')}
          AND ${visibleCond('payment_records', 'record')}
          AND record.confirmation_status = 'confirmed'
      ), 0) AS paid_amount,
      COALESCE((
        SELECT COUNT(DISTINCT otherApplication.project_id)
        FROM payment_applications AS otherApplication
        WHERE otherApplication.supplier_id = application.supplier_id
          AND otherApplication.id <> application.id
          AND otherApplication.project_id IS NOT NULL
          AND ${visibleCond('payment_applications', 'otherApplication')}
          AND (application.project_id IS NULL OR otherApplication.project_id <> application.project_id)
      ), 0) AS supplier_other_project_count,
      COALESCE((
        SELECT SUM(recordAllocation.allocated_amount)
        FROM payment_applications AS otherApplication
        JOIN payment_record_application_allocations AS recordAllocation
          ON recordAllocation.payment_application_id = otherApplication.id
        JOIN payment_records AS record ON record.id = recordAllocation.payment_record_id
        WHERE otherApplication.supplier_id = application.supplier_id
          AND otherApplication.id <> application.id
          AND ${visibleCond('payment_applications', 'otherApplication')}
          AND ${visibleCond('payment_record_application_allocations', 'recordAllocation')}
          AND ${visibleCond('payment_records', 'record')}
          AND record.confirmation_status = 'confirmed'
          AND (application.project_id IS NULL OR otherApplication.project_id <> application.project_id)
      ), 0) AS supplier_other_project_paid_amount
    FROM payment_applications AS application
    LEFT JOIN projects AS project ON project.id = application.project_id
    LEFT JOIN suppliers AS supplier ON supplier.id = application.supplier_id
    LEFT JOIN contracts AS contract ON contract.id = application.contract_id
    WHERE ${visibleCond('payment_applications', 'application')}
      AND application.id = ?
  `, [id])

  if (!header)
    return null

  const [settlements, invoices, payments] = await Promise.all([
    select<Record<string, unknown>>(`
      ${hiddenCtesFor(...DETAIL_TABLES)}
      SELECT
        settlement.id,
        settlement.no,
        settlement.name,
        settlement.total_amount,
        settlement.settlement_date,
        settlement.status,
        allocation.allocated_amount,
        allocation.note
      FROM payment_application_settlement_allocations AS allocation
      JOIN expenditure_settlements AS settlement ON settlement.id = allocation.settlement_id
      WHERE allocation.payment_application_id = ?
        AND ${visibleCond('payment_application_settlement_allocations', 'allocation')}
        AND ${visibleCond('expenditure_settlements', 'settlement')}
      ORDER BY settlement.settlement_date DESC, settlement.created_at DESC
    `, [id]),
    select<Record<string, unknown>>(`
      ${hiddenCtesFor(...DETAIL_TABLES)}
      SELECT
        invoice.id,
        invoice.invoice_number,
        invoice.invoice_date,
        invoice.total_amount,
        allocation.allocated_amount,
        allocation.note
      FROM payment_application_invoice_allocations AS allocation
      JOIN invoices AS invoice ON invoice.id = allocation.invoice_id
      WHERE allocation.payment_application_id = ?
        AND ${visibleCond('payment_application_invoice_allocations', 'allocation')}
        AND ${visibleCond('invoices', 'invoice')}
      ORDER BY invoice.invoice_date DESC, invoice.created_at DESC
    `, [id]),
    select<Record<string, unknown>>(`
      ${hiddenCtesFor(...DETAIL_TABLES)}
      SELECT
        record.id,
        record.no,
        record.payee_name,
        record.payment_date,
        record.amount,
        record.confirmation_status,
        allocation.allocated_amount,
        record.voucher_no
      FROM payment_record_application_allocations AS allocation
      JOIN payment_records AS record ON record.id = allocation.payment_record_id
      WHERE allocation.payment_application_id = ?
        AND ${visibleCond('payment_record_application_allocations', 'allocation')}
        AND ${visibleCond('payment_records', 'record')}
      ORDER BY record.payment_date DESC, record.created_at DESC
    `, [id]),
  ])

  const applyAmount = amount(header.apply_amount)
  const approvedAmount = amount(header.approved_amount)
  const settlementAllocated = amount(header.settlement_allocated)
  const invoiceAllocated = amount(header.invoice_allocated)
  const paidAmount = amount(header.paid_amount)
  const settlementDifference = roundMoney(Math.max(applyAmount - settlementAllocated, 0))
  const invoiceDifference = roundMoney(Math.max(applyAmount - invoiceAllocated, 0))
  const pendingInvoiceAmount = header.invoice_state === '无需发票'
    ? 0
    : invoiceDifference
  const paymentCap = approvedAmount > EPSILON ? approvedAmount : applyAmount
  const unpaidAmount = roundMoney(Math.max(paymentCap - paidAmount, 0))
  const insight = buildPaymentApplicationInsight({
    status: String(header.status ?? ''),
    bizType: String(header.biz_type ?? ''),
    invoiceState: String(header.invoice_state ?? ''),
    applyAmount,
    approvedAmount,
    settlementAllocated,
    invoiceAllocated,
    paidAmount,
  })

  return {
    id: String(header.id),
    no: String(header.no ?? ''),
    name: String(header.name ?? ''),
    bizType: String(header.biz_type ?? ''),
    projectId: header.project_id ? String(header.project_id) : null,
    projectName: String(header.project_name ?? ''),
    supplierId: header.supplier_id ? String(header.supplier_id) : null,
    supplierName: String(header.supplier_name ?? ''),
    contractId: header.contract_id ? String(header.contract_id) : null,
    contractNo: String(header.contract_no ?? ''),
    contractName: String(header.contract_name ?? ''),
    contractAmount: amount(header.contract_amount),
    contractSettledAmount: amount(header.contract_settled_amount),
    contractPaidAmount: amount(header.contract_paid_amount),
    costName: String(header.cost_name ?? ''),
    applyAmount,
    applyDate: String(header.apply_date ?? ''),
    applicant: String(header.applicant ?? ''),
    invoiceState: String(header.invoice_state ?? ''),
    payContent: String(header.pay_content ?? ''),
    prepayDeduct: amount(header.prepay_deduct),
    prepayNote: String(header.prepay_note ?? ''),
    approvedAmount,
    approvalNote: String(header.approval_note ?? ''),
    status: String(header.status ?? ''),
    note: String(header.note ?? ''),
    externalRef: String(header.external_ref ?? ''),
    createdAt: String(header.created_at ?? ''),
    updatedAt: String(header.updated_at ?? ''),
    settlementAllocated,
    settlementDifference,
    invoiceAllocated,
    invoiceDifference,
    pendingInvoiceAmount,
    paidAmount,
    unpaidAmount,
    supplierOtherProjectCount: amount(header.supplier_other_project_count),
    supplierOtherProjectPaidAmount: amount(header.supplier_other_project_paid_amount),
    settlements: settlements.map(row => ({
      id: String(row.id),
      no: String(row.no ?? ''),
      name: String(row.name ?? ''),
      totalAmount: amount(row.total_amount),
      settlementDate: String(row.settlement_date ?? ''),
      status: String(row.status ?? ''),
      allocatedAmount: amount(row.allocated_amount),
      note: String(row.note ?? ''),
    })),
    invoices: invoices.map(row => ({
      id: String(row.id),
      invoiceNumber: String(row.invoice_number ?? ''),
      invoiceDate: String(row.invoice_date ?? ''),
      totalAmount: amount(row.total_amount),
      allocatedAmount: amount(row.allocated_amount),
      note: String(row.note ?? ''),
    })),
    payments: payments.map(row => ({
      id: String(row.id),
      no: String(row.no ?? ''),
      payeeName: String(row.payee_name ?? ''),
      paymentDate: String(row.payment_date ?? ''),
      amount: amount(row.amount),
      confirmationStatus: String(row.confirmation_status ?? ''),
      allocatedAmount: amount(row.allocated_amount),
      voucherNo: String(row.voucher_no ?? ''),
    })),
    insight,
  }
}
