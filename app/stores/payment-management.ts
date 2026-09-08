import { defineStore } from 'pinia'
import { computed, readonly, shallowRef } from 'vue'
import { select } from '~/lib/db/connection'
import { hiddenCtesFor, visibleCond } from '~/lib/db/soft-delete'

export type PaymentExecutionStatus
  = '待支付'
    | '部分支付'
    | '已付清'
    | '超额支付'
    | '批复为 0'

export type PaymentInvoiceStatus
  = '待回票'
    | '部分回票'
    | '已回票'
    | '无需发票'

export interface PaymentManagementRow {
  id: string
  no: string
  name: string
  bizType: string
  projectId: string | null
  projectName: string
  supplierId: string | null
  supplierName: string
  approvedAmount: number
  paidAmount: number
  dueAmount: number
  paymentStatus: PaymentExecutionStatus
  invoiceState: string
  invoiceStatus: PaymentInvoiceStatus
  pendingInvoiceAmount: number
  applyDate: string
}

export interface PaymentManagementSummary {
  applicationCount: number
  approvedAmount: number
  paidAmount: number
  dueAmount: number
  dueCount: number
}

interface PaymentManagementDbRow {
  id: string
  no: string
  name: string
  biz_type: string
  project_id: string | null
  project_name: string | null
  supplier_id: string | null
  supplier_name: string | null
  apply_amount: number
  approved_amount: number
  paid_amount: number
  invoice_state: string
  invoice_allocated_amount: number
  apply_date: string
}

function money(value: unknown): number {
  return Math.round((Number(value) || 0) * 100) / 100
}

function executionStatus(
  approvedAmount: number,
  paidAmount: number,
): PaymentExecutionStatus {
  if (approvedAmount <= 0)
    return '批复为 0'
  if (paidAmount <= 0)
    return '待支付'
  if (paidAmount < approvedAmount)
    return '部分支付'
  if (paidAmount > approvedAmount)
    return '超额支付'
  return '已付清'
}

function invoiceStatus(
  invoiceState: string,
  applyAmount: number,
  invoiceAllocatedAmount: number,
): PaymentInvoiceStatus {
  if (invoiceState === '无需发票')
    return '无需发票'
  if (invoiceAllocatedAmount <= 0)
    return '待回票'
  if (invoiceAllocatedAmount + 0.0001 < applyAmount)
    return '部分回票'
  return '已回票'
}

function mapRow(row: PaymentManagementDbRow): PaymentManagementRow {
  const applyAmount = money(row.apply_amount)
  const approvedAmount = money(row.approved_amount)
  const paidAmount = money(row.paid_amount)
  const invoiceAllocatedAmount = money(row.invoice_allocated_amount)

  return {
    id: row.id,
    no: row.no,
    name: row.name,
    bizType: row.biz_type,
    projectId: row.project_id,
    projectName: row.project_name || '公司付款',
    supplierId: row.supplier_id,
    supplierName: row.supplier_name || '未指定收款单位',
    approvedAmount,
    paidAmount,
    dueAmount: money(Math.max(approvedAmount - paidAmount, 0)),
    paymentStatus: executionStatus(approvedAmount, paidAmount),
    invoiceState: row.invoice_state,
    invoiceStatus: invoiceStatus(
      row.invoice_state,
      applyAmount,
      invoiceAllocatedAmount,
    ),
    pendingInvoiceAmount: row.invoice_state === '无需发票'
      ? 0
      : money(Math.max(applyAmount - invoiceAllocatedAmount, 0)),
    applyDate: row.apply_date,
  }
}

function summarize(rows: readonly PaymentManagementRow[]): PaymentManagementSummary {
  return rows.reduce<PaymentManagementSummary>((summary, row) => ({
    applicationCount: summary.applicationCount + 1,
    approvedAmount: money(summary.approvedAmount + row.approvedAmount),
    paidAmount: money(summary.paidAmount + row.paidAmount),
    dueAmount: money(summary.dueAmount + row.dueAmount),
    dueCount: summary.dueCount + Number(row.dueAmount > 0),
  }), {
    applicationCount: 0,
    approvedAmount: 0,
    paidAmount: 0,
    dueAmount: 0,
    dueCount: 0,
  })
}

export const usePaymentManagementStore = defineStore('payment-management', () => {
  const rows = shallowRef<PaymentManagementRow[]>([])
  const loading = shallowRef(false)
  const hasSnapshot = shallowRef(false)
  let activeLoad: Promise<PaymentManagementRow[]> | null = null

  const projectOptions = computed(() => {
    const options = new Map<string, string>()
    for (const row of rows.value) {
      if (row.projectId)
        options.set(row.projectId, row.projectName)
    }
    return [
      { key: 'all', label: '全部项目' },
      ...[...options]
        .sort((left, right) => left[1].localeCompare(right[1], 'zh-CN'))
        .map(([key, label]) => ({ key, label })),
    ]
  })
  const summary = computed(() => summarize(rows.value))

  async function load(): Promise<PaymentManagementRow[]> {
    if (activeLoad)
      return activeLoad

    loading.value = true
    activeLoad = select<PaymentManagementDbRow>(`
      ${hiddenCtesFor(
        'payment_applications',
        'payment_record_application_allocations',
        'payment_records',
        'payment_application_invoice_allocations',
      )}
      SELECT application.id,
             application.no,
             application.name,
             application.biz_type,
             application.project_id,
             project.name AS project_name,
             application.supplier_id,
             supplier.name AS supplier_name,
             application.apply_amount,
             application.approved_amount,
             application.invoice_state,
             application.apply_date,
             COALESCE((
               SELECT SUM(allocation.allocated_amount)
               FROM payment_record_application_allocations AS allocation
               JOIN payment_records AS payment
                 ON payment.id = allocation.payment_record_id
               WHERE allocation.payment_application_id = application.id
                 AND ${visibleCond('payment_record_application_allocations', 'allocation')}
                 AND ${visibleCond('payment_records', 'payment')}
                 AND payment.confirmation_status = 'confirmed'
             ), 0) AS paid_amount,
             COALESCE((
               SELECT SUM(invoice_allocation.allocated_amount)
               FROM payment_application_invoice_allocations AS invoice_allocation
               WHERE invoice_allocation.payment_application_id = application.id
                 AND ${visibleCond('payment_application_invoice_allocations', 'invoice_allocation')}
             ), 0) AS invoice_allocated_amount
      FROM payment_applications AS application
      LEFT JOIN projects AS project
        ON project.id = application.project_id
       AND project.deleted_at IS NULL
      LEFT JOIN suppliers AS supplier
        ON supplier.id = application.supplier_id
       AND supplier.deleted_at IS NULL
      WHERE ${visibleCond('payment_applications', 'application')}
        AND application.status IN ('approved', '已审批', '已批复')
      ORDER BY application.apply_date DESC, application.created_at DESC
    `).then((source) => {
      rows.value = source.map(mapRow)
      hasSnapshot.value = true
      return rows.value
    }).finally(() => {
      loading.value = false
      activeLoad = null
    })

    return activeLoad
  }

  return {
    rows: readonly(rows),
    loading: readonly(loading),
    hasSnapshot: readonly(hasSnapshot),
    projectOptions,
    summary,
    load,
  }
})
