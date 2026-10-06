import type { ApprovedAmountOrigin } from './approval-amount'
import type { PaymentApplicationDetail } from './payment-detail-model'
import { CONFIRMED_SETTLEMENT_SQL_VALUES } from '~/lib/contract/effective-status'
import { withTransaction } from '~/lib/db/connection'
import { hiddenCtesFor, visibleCond } from '~/lib/db/soft-delete'
import { approvalPaymentCap, paymentConfirmationCap, readApprovalAmount } from './approval-amount'
import { pendingInvoiceAmountForRead } from './domain'
import { verifiedPaymentDetailAmount as amount, buildPaymentApplicationInsight, roundPaymentDetailMoney as roundMoney } from './payment-detail-model'
import { verifiedFinanceSum } from './persistent-rows'

export * from './payment-detail-model'

interface PaymentApplicationHeaderRow extends Record<string, unknown> {
  id: string
  no: string
  name: string
  biz_type: string
  project_id: string | null
  project_name: string | null
  supplier_id: string | null
  worker_id: string | null
  supplier_name: string | null
  contract_id: string | null
  contract_no: string | null
  contract_name: string | null
  contract_amount: number | null
  cost_name: string
  apply_amount: number
  apply_date: string
  applicant: string
  invoice_state: string
  pay_content: string
  prepay_deduct: number
  prepay_note: string
  approved_amount: number | null
  approved_amount_origin: ApprovedAmountOrigin
  approval_note: string
  status: string
  note: string
  external_ref: string
  created_at: string
  updated_at: string
  supplier_other_project_count: number
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
  return withTransaction(async ({ select }) => {
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
      application.worker_id,
      COALESCE(NULLIF(application.payee_name_snapshot,''),supplier.name,worker.name) AS supplier_name,
      application.contract_id,
      contract.no AS contract_no,
      contract.name AS contract_name,
      contract.amount AS contract_amount,
      application.cost_name,
      application.apply_amount,
      application.apply_date,
      application.applicant,
      application.invoice_state,
      application.pay_content,
      application.prepay_deduct,
      application.prepay_note,
      application.approved_amount,
      application.approved_amount_origin,
      application.approval_note,
      application.status,
      application.note,
      application.external_ref,
      application.created_at,
      application.updated_at,
      COALESCE((
        SELECT COUNT(DISTINCT otherApplication.project_id)
        FROM payment_applications AS otherApplication
        WHERE otherApplication.supplier_id IS application.supplier_id
          AND otherApplication.worker_id IS application.worker_id
          AND (application.supplier_id IS NOT NULL OR application.worker_id IS NOT NULL)
          AND otherApplication.id <> application.id
          AND otherApplication.project_id IS NOT NULL
          AND ${visibleCond('payment_applications', 'otherApplication')}
          AND (application.project_id IS NULL OR otherApplication.project_id <> application.project_id)
      ), 0) AS supplier_other_project_count
    FROM payment_applications AS application
    LEFT JOIN projects AS project ON project.id = application.project_id
    LEFT JOIN suppliers AS supplier ON supplier.id = application.supplier_id
    LEFT JOIN workers AS worker ON worker.id=application.worker_id
    LEFT JOIN contracts AS contract ON contract.id = application.contract_id
    WHERE ${visibleCond('payment_applications', 'application')}
      AND application.id = ?
  `, [id])

    if (!header)
      return null

    const sources = await select<{ source: string, value: unknown, payment_amount: unknown }>(`
    ${hiddenCtesFor(...DETAIL_TABLES)}
    SELECT 'contract-settled' AS source,settlement.total_amount AS value,NULL AS payment_amount
      FROM expenditure_settlements AS settlement
      WHERE settlement.contract_id=? AND ${visibleCond('expenditure_settlements', 'settlement')}
        AND settlement.status IN (${CONFIRMED_SETTLEMENT_SQL_VALUES})
    UNION ALL SELECT 'settlement',allocation.allocated_amount,NULL FROM payment_application_settlement_allocations AS allocation
      WHERE allocation.payment_application_id=? AND ${visibleCond('payment_application_settlement_allocations', 'allocation')}
    UNION ALL SELECT 'invoice',allocation.allocated_amount,NULL FROM payment_application_invoice_allocations AS allocation
      WHERE allocation.payment_application_id=? AND ${visibleCond('payment_application_invoice_allocations', 'allocation')}
    UNION ALL SELECT 'paid',allocation.allocated_amount,record.amount FROM payment_record_application_allocations AS allocation
      JOIN payment_records AS record ON record.id=allocation.payment_record_id
      WHERE allocation.payment_application_id=? AND ${visibleCond('payment_record_application_allocations', 'allocation')}
        AND ${visibleCond('payment_records', 'record')} AND record.confirmation_status='confirmed'
    UNION ALL SELECT 'other-paid',recordAllocation.allocated_amount,record.amount FROM payment_applications AS otherApplication
      JOIN payment_record_application_allocations AS recordAllocation ON recordAllocation.payment_application_id=otherApplication.id
      JOIN payment_records AS record ON record.id=recordAllocation.payment_record_id
      WHERE otherApplication.supplier_id IS ? AND otherApplication.worker_id IS ? AND otherApplication.id<>?
        AND (otherApplication.supplier_id IS NOT NULL OR otherApplication.worker_id IS NOT NULL)
        AND ${visibleCond('payment_applications', 'otherApplication')}
        AND ${visibleCond('payment_record_application_allocations', 'recordAllocation')}
        AND ${visibleCond('payment_records', 'record')} AND record.confirmation_status='confirmed'
        AND (? IS NULL OR otherApplication.project_id<>?)
  `, [header.contract_id, id, id, id, header.supplier_id, header.worker_id, id, header.project_id, header.project_id])
    sources.forEach(row => verifiedFinanceSum([row.value]))
    sources.filter(row => row.source === 'paid' || row.source === 'other-paid').forEach(row => verifiedFinanceSum([row.payment_amount]))
    const sum = (source: string) => verifiedFinanceSum(sources.filter(row => row.source === source).map(row => row.value))

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
    const approval = readApprovalAmount(header.approved_amount, header.approved_amount_origin)
    const settlementAllocated = sum('settlement')
    const invoiceAllocated = sum('invoice')
    const paidAmount = sum('paid')
    const settlementDifference = roundMoney(Math.max(applyAmount - settlementAllocated, 0))
    const invoiceDifference = roundMoney(Math.max(applyAmount - invoiceAllocated, 0))
    const pendingInvoiceAmount = pendingInvoiceAmountForRead(header.invoice_state, applyAmount, invoiceAllocated)
    const paymentCap = approvalPaymentCap(applyAmount, header.approved_amount, header.approved_amount_origin)
    const unpaidAmount = paymentCap === null ? null : roundMoney(Math.max(paymentCap - paidAmount, 0))
    const insight = buildPaymentApplicationInsight({
      status: String(header.status ?? ''),
      bizType: String(header.biz_type ?? ''),
      workerId: header.worker_id,
      hasSettlementAllocations: settlements.length > 0,
      invoiceState: String(header.invoice_state ?? ''),
      applyAmount,
      approvedAmount: header.approved_amount,
      approvedAmountOrigin: header.approved_amount_origin,
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
      workerId: header.worker_id,
      supplierName: String(header.supplier_name ?? ''),
      contractId: header.contract_id ? String(header.contract_id) : null,
      contractNo: String(header.contract_no ?? ''),
      contractName: String(header.contract_name ?? ''),
      contractAmount: header.contract_amount === null ? null : amount(header.contract_amount),
      contractSettledAmount: sum('contract-settled'),
      contractPaidAmount: paidAmount,
      costName: String(header.cost_name ?? ''),
      applyAmount,
      applyDate: String(header.apply_date ?? ''),
      applicant: String(header.applicant ?? ''),
      invoiceState: String(header.invoice_state ?? ''),
      payContent: String(header.pay_content ?? ''),
      prepayDeduct: amount(header.prepay_deduct),
      prepayNote: String(header.prepay_note ?? ''),
      approvedAmount: approval.amount,
      approvedAmountState: approval.state,
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
      registrationAmount: roundMoney(Math.max(paymentConfirmationCap(applyAmount, header.approved_amount, header.approved_amount_origin) - paidAmount, 0)),
      supplierOtherProjectCount: header.supplier_id || header.worker_id ? amount(header.supplier_other_project_count) : null,
      supplierOtherProjectPaidAmount: header.supplier_id || header.worker_id ? sum('other-paid') : null,
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
  })
}
