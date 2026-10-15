import type { ApprovedAmountOrigin, ApprovedAmountState } from '~/lib/finance/approval-amount'
import { defineStore } from 'pinia'
import { computed, readonly, shallowRef, watch } from 'vue'
import { withTransaction } from '~/lib/db/connection'
import { hiddenCtesFor, visibleCond } from '~/lib/db/soft-delete'
import { approvalPaymentCap, readApprovalAmount } from '~/lib/finance/approval-amount'
import { financeFailure } from '~/lib/finance/central-contract'
import { pendingInvoiceAmountForRead } from '~/lib/finance/domain'
import { verifiedFinanceSum } from '~/lib/finance/persistent-rows'
import { bindReadAuthority } from '~/lib/read-model/authority'
import { useDataVisibilityStore } from '~/stores/data-visibility'
import { useFinanceStore } from '~/stores/finance'

export type PaymentExecutionStatus
  = '待支付'
    | '部分支付'
    | '已付清'
    | '超额支付'
    | '批复为 0'
    | '历史批复待核验'

export type PaymentInvoiceStatus
  = '待回票'
    | '部分回票'
    | '已回票'
    | '无需发票'
    | '待关联发票'
    | '部分关联'
    | '已关联'
    | '回票类型待核实'

export interface PaymentManagementRow {
  id: string
  no: string
  name: string
  bizType: string
  projectId: string | null
  projectName: string
  supplierId: string | null
  workerId: string | null
  supplierName: string
  approvedAmount: number | null
  approvedAmountState: ApprovedAmountState
  paidAmount: number
  dueAmount: number | null
  paymentStatus: PaymentExecutionStatus
  invoiceState: string
  invoiceStatus: PaymentInvoiceStatus
  pendingInvoiceAmount: number | null
  applyDate: string
  canRegisterPayment: boolean
}

export interface PaymentManagementSummary {
  applicationCount: number
  approvedAmount: number | null
  paidAmount: number | null
  dueAmount: number | null
  dueCount: number | null
}

interface PaymentManagementDbRow {
  id: string
  no: string
  name: string
  biz_type: string
  project_id: string | null
  project_name: string | null
  supplier_id: string | null
  worker_id: string | null
  supplier_name: string | null
  apply_amount: number
  approved_amount: number | null
  approved_amount_origin: ApprovedAmountOrigin
  paid_amount: number
  invoice_state: string | null
  invoice_allocated_amount: number
  apply_date: string
}

function money(value: unknown): number {
  return verifiedFinanceSum([value])
}

function executionStatus(
  approvedAmount: number,
  paidAmount: number,
): PaymentExecutionStatus {
  if (paidAmount > approvedAmount)
    return '超额支付'
  if (approvedAmount <= 0)
    return '批复为 0'
  if (paidAmount <= 0)
    return '待支付'
  if (paidAmount < approvedAmount)
    return '部分支付'
  return '已付清'
}

function invoiceStatus(
  invoiceState: string | null,
  applyAmount: number,
  invoiceAllocatedAmount: number,
): PaymentInvoiceStatus {
  const pending = pendingInvoiceAmountForRead(invoiceState, applyAmount, invoiceAllocatedAmount)
  if (pending === null)
    return '回票类型待核实'
  if (invoiceState === '无需发票')
    return '无需发票'
  if (invoiceState === '先票后款') {
    if (invoiceAllocatedAmount <= 0)
      return applyAmount <= 0 ? '已关联' : '待关联发票'
    return invoiceAllocatedAmount + 0.0001 < applyAmount ? '部分关联' : '已关联'
  }
  if (invoiceAllocatedAmount <= 0)
    return '待回票'
  if (invoiceAllocatedAmount + 0.0001 < applyAmount)
    return '部分回票'
  return '已回票'
}

function mapRow(row: PaymentManagementDbRow): PaymentManagementRow {
  const applyAmount = money(row.apply_amount)
  const approval = readApprovalAmount(row.approved_amount, row.approved_amount_origin)
  const cap = approvalPaymentCap(applyAmount, row.approved_amount, row.approved_amount_origin)
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
    workerId: row.worker_id ?? null,
    supplierName: row.supplier_name || '未指定收款单位',
    approvedAmount: approval.amount,
    approvedAmountState: approval.state,
    paidAmount,
    dueAmount: cap === null ? null : money(Math.max(cap - paidAmount, 0)),
    paymentStatus: cap === null ? '历史批复待核验' : executionStatus(cap, paidAmount),
    invoiceState: row.invoice_state ?? '',
    invoiceStatus: invoiceStatus(
      row.invoice_state,
      applyAmount,
      invoiceAllocatedAmount,
    ),
    pendingInvoiceAmount: pendingInvoiceAmountForRead(row.invoice_state, applyAmount, invoiceAllocatedAmount),
    applyDate: row.apply_date,
    canRegisterPayment: true,
  }
}

export function summarizePayments(rows: readonly PaymentManagementRow[]): PaymentManagementSummary {
  function sum(values: readonly unknown[]): number | null {
    try {
      return verifiedFinanceSum(values)
    }
    catch { return null }
  }
  const dueAmount = sum(rows.map(row => row.dueAmount))
  return {
    applicationCount: rows.length,
    approvedAmount: sum(rows.map(row => row.approvedAmount)),
    paidAmount: sum(rows.map(row => row.paidAmount)),
    dueAmount,
    dueCount: dueAmount === null ? null : rows.filter(row => row.dueAmount !== null && row.dueAmount > 0).length,
  }
}

export const usePaymentManagementStore = defineStore('payment-management', () => {
  const rows = shallowRef<PaymentManagementRow[]>([])
  const loading = shallowRef(false)
  const hasSnapshot = shallowRef(false)
  const currentRead = shallowRef(false)
  const snapshotOrigin = shallowRef<'native' | 'demo' | 'central' | null>(null)
  const visibility = useDataVisibilityStore()
  let generation = 0
  let activeLoad: Promise<PaymentManagementRow[]> | null = null
  function withdraw() {
    ++generation
    rows.value = []
    hasSnapshot.value = false
    currentRead.value = false
    snapshotOrigin.value = null
    activeLoad = null
    loading.value = false
  }
  bindReadAuthority(withdraw)
  watch(() => visibility.includeDemo, withdraw, { flush: 'sync' })

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
  const summary = computed(() => summarizePayments(rows.value))

  async function load(): Promise<PaymentManagementRow[]> {
    if (activeLoad)
      return activeLoad

    loading.value = true
    currentRead.value = false
    const token = generation
    const origin = 'window' in globalThis && !visibility.includeDemo ? 'central' : visibility.includeDemo ? 'demo' : 'native'
    async function readNative() {
      return withTransaction(async ({ select }) => {
        const source = await select<PaymentManagementDbRow>(`
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
             application.worker_id,
             COALESCE(NULLIF(application.payee_name_snapshot,''),supplier.name,worker.name) AS supplier_name,
             application.apply_amount,
             application.approved_amount,
             application.approved_amount_origin,
             application.invoice_state,
             application.apply_date
      FROM payment_applications AS application
      LEFT JOIN projects AS project
        ON project.id = application.project_id
       AND project.deleted_at IS NULL
      LEFT JOIN suppliers AS supplier
        ON supplier.id = application.supplier_id
       AND supplier.deleted_at IS NULL
      LEFT JOIN workers AS worker ON worker.id=application.worker_id AND worker.deleted_at IS NULL
      WHERE ${visibleCond('payment_applications', 'application')}
        AND application.status IN ('approved', '已审批', '已批复')
      ORDER BY application.apply_date DESC, application.created_at DESC
    `)
        const result: PaymentManagementRow[] = []
        for (const row of source) {
          const paid = await select<{ allocated_amount: unknown, amount: unknown }>(`${hiddenCtesFor('payment_record_application_allocations', 'payment_records')} SELECT allocation.allocated_amount,payment.amount FROM payment_record_application_allocations allocation JOIN payment_records payment ON payment.id=allocation.payment_record_id WHERE allocation.payment_application_id=? AND ${visibleCond('payment_record_application_allocations', 'allocation')} AND ${visibleCond('payment_records', 'payment')} AND payment.confirmation_status='confirmed'`, [row.id])
          paid.forEach(cash => verifiedFinanceSum([cash.amount]))
          const invoiced = await select<{ allocated_amount: unknown }>(`${hiddenCtesFor('payment_application_invoice_allocations')} SELECT allocation.allocated_amount FROM payment_application_invoice_allocations allocation WHERE allocation.payment_application_id=? AND ${visibleCond('payment_application_invoice_allocations', 'allocation')}`, [row.id])
          result.push(mapRow({ ...row, paid_amount: verifiedFinanceSum(paid.map(cash => cash.allocated_amount)), invoice_allocated_amount: verifiedFinanceSum(invoiced.map(allocation => allocation.allocated_amount)) }))
        }
        return result
      })
    }
    const pending = (origin === 'central'
      ? useFinanceStore().paymentManagementDetails().then(details => details.map(detail => ({
          id: detail.id,
          no: detail.no,
          name: detail.name,
          bizType: detail.bizType,
          projectId: detail.projectId,
          projectName: detail.projectName,
          supplierId: detail.supplierId,
          workerId: detail.workerId ?? null,
          supplierName: detail.supplierName,
          approvedAmount: detail.approvedAmount,
          approvedAmountState: detail.approvedAmountState,
          paidAmount: detail.paidAmount,
          dueAmount: detail.unpaidAmount,
          paymentStatus: detail.unpaidAmount === null ? '历史批复待核验' : executionStatus(detail.approvedAmount ?? detail.applyAmount, detail.paidAmount),
          invoiceState: detail.invoiceState,
          invoiceStatus: invoiceStatus(detail.invoiceState, detail.applyAmount, detail.invoiceAllocated),
          pendingInvoiceAmount: detail.pendingInvoiceAmount,
          applyDate: detail.applyDate,
          canRegisterPayment: detail.canRegisterPayment === true,
        } satisfies PaymentManagementRow)))
      : readNative()).then((result) => {
      if (token !== generation)
        financeFailure('unavailable', '付款管理读取期间权限或来源已变化，请按当前身份重新读取。')
      rows.value = origin === 'demo' ? result.map(row => ({ ...row, canRegisterPayment: false })) : result
      hasSnapshot.value = true
      currentRead.value = true
      snapshotOrigin.value = origin
      return rows.value
    }).catch((cause) => {
      if (token === generation && origin === 'central') {
        rows.value = []
        hasSnapshot.value = false
        snapshotOrigin.value = null
      }
      throw cause
    }).finally(() => {
      if (activeLoad === pending) {
        loading.value = false
        activeLoad = null
      }
    })
    activeLoad = pending
    return activeLoad
  }

  return {
    rows: readonly(rows),
    loading: readonly(loading),
    hasSnapshot: readonly(hasSnapshot),
    currentRead: readonly(currentRead),
    snapshotOrigin: readonly(snapshotOrigin),
    projectOptions,
    summary,
    load,
  }
})
