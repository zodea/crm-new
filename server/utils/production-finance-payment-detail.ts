import type { FinanceFormData } from '../../app/lib/finance/central-contract'
import type { PaymentApplicationDetailDTO } from '../../app/lib/finance/payment-detail-contract'
import type { FinanceDomainTx } from '../../app/lib/finance/reference'
import type { BusinessSession } from './business-session'
import { approvalPaymentCap, paymentConfirmationCap, readApprovalAmount } from '../../app/lib/finance/approval-amount'
import { financeFailure, financeProblemFromUnknown } from '../../app/lib/finance/central-contract'
import { buildPaymentApplicationInsight, roundPaymentDetailMoney } from '../../app/lib/finance/payment-detail-model'
import { verifiedFinanceSum } from '../../app/lib/finance/persistent-rows'
import { decimalNumber } from '../../app/lib/read-model/decimal'

type Row = Record<string, unknown>
const money = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? decimalNumber(value) : null
export function financePersistedDateTime(value: unknown): string {
  if (typeof value !== 'string')
    return financeFailure('unavailable', '财务原时间尚未可靠读取。')
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value
  if (!Number.isFinite(Date.parse(normalized)))
    return financeFailure('unavailable', '财务原时间尚未可靠读取。')
  return new Date(normalized).toISOString()
}
async function frozenReference(tx: FinanceDomainTx, table: string, id: string): Promise<Row | null> {
  const rows = await tx.select<{ evidence_json: string }>('SELECT evidence_json FROM finance_imports')
  for (const row of rows) {
    const evidence = JSON.parse(row.evidence_json)
    const reference = evidence.retainedReferences?.find((item: Row) => item.entityType === table && item.id === id)
    if (reference?.row)
      return reference.row
  }
  return null
}
/** One same-transaction view: own amounts are actual, unavailable outer owners remain unknown. */
export async function productionPaymentApplicationDetail(tx: FinanceDomainTx, actor: BusinessSession, read: FinanceFormData<'payment_application'>): Promise<PaymentApplicationDetailDTO> {
  const draft = read.draft
  const head = (await tx.select<Row>('SELECT * FROM payment_applications WHERE id=?', [draft.id]))[0]!
  const approval = readApprovalAmount(draft.approvedAmount, draft.approvedAmountOrigin)
  const cap = approvalPaymentCap(draft.applyAmount, draft.approvedAmount, draft.approvedAmountOrigin)
  const unpaid = cap === null ? null : roundPaymentDetailMoney(Math.max(cap - draft.paidAmount, 0))
  const registration = roundPaymentDetailMoney(Math.max(paymentConfirmationCap(draft.applyAmount, draft.approvedAmount, draft.approvedAmountOrigin) - draft.paidAmount, 0))
  const project = draft.projectId && actor.capabilities.includes('project:list:read') ? await tx.references!.read<{ name: string }>('projects', draft.projectId) : null
  let contract: Row | null = null
  let contractSourceState: 'readable' | 'frozen' | 'unavailable' | 'forbidden' = 'unavailable'
  if (draft.contractId) {
    try {
      contract = await tx.references!.read<Row>('contracts', draft.contractId)
      contractSourceState = contract ? 'readable' : 'unavailable'
    }
    catch (cause) {
      if (financeProblemFromUnknown(cause).problem.code === 'forbidden')
        contractSourceState = 'forbidden'
    }
    if (!contract && contractSourceState !== 'forbidden') {
      const frozen = await frozenReference(tx, 'contracts', draft.contractId)
      const cap = frozen?.kind === '施工' ? 'construction-contract:read' : frozen?.kind === '分包' ? 'subcontract-contract:read' : frozen?.kind === '材采' ? 'material-contract:read' : 'auxiliary-contract:read'
      if (frozen && actor.capabilities.includes(cap)) {
        contract = frozen
        contractSourceState = 'frozen'
      }
      else if (frozen) {
        contractSourceState = 'forbidden'
      }
    }
  }
  const settlements: PaymentApplicationDetailDTO['settlements'] = []
  for (const allocation of draft.settlementAllocations) {
    let row: Row | null = null
    let sourceState: 'readable' | 'frozen' | 'unavailable' | 'forbidden' = actor.capabilities.includes('other-settlement:read') ? 'unavailable' : 'forbidden'
    if (sourceState !== 'forbidden') {
      try {
        row = await tx.references!.read<Row>('expenditure_settlements', allocation.settlementId)
        sourceState = row ? 'readable' : 'unavailable'
      }
      catch (cause) {
        row = null
        if (financeProblemFromUnknown(cause).problem.code === 'forbidden')
          sourceState = 'forbidden'
      }
      if (!row && sourceState !== 'forbidden') {
        row = await frozenReference(tx, 'expenditure_settlements', allocation.settlementId)
        if (row)
          sourceState = 'frozen'
      }
    }
    settlements.push({ id: allocation.settlementId, no: String(row?.no ?? ''), name: String(row?.name ?? ''), totalAmount: sourceState === 'readable' ? money(row?.total_amount) : null, settlementDate: String(row?.settlement_date ?? ''), status: String(row?.status ?? ''), allocatedAmount: decimalNumber(allocation.allocatedAmount), note: allocation.note, sourceState })
  }
  const invoices: PaymentApplicationDetailDTO['invoices'] = []
  for (const allocation of draft.invoiceAllocations) {
    const row = actor.capabilities.includes('finance-invoice:read') ? await frozenReference(tx, 'invoices', allocation.invoiceId) : null
    invoices.push({ id: allocation.invoiceId, invoiceNumber: String(row?.invoice_number ?? ''), invoiceDate: String(row?.invoice_date ?? ''), totalAmount: money(row?.total_amount), allocatedAmount: decimalNumber(allocation.allocatedAmount), note: allocation.note, sourceState: row ? 'frozen' : actor.capabilities.includes('finance-invoice:read') ? 'unavailable' : 'forbidden' })
  }
  const cash = actor.capabilities.includes('finance-payment-record:read')
    ? await tx.select<{ id: string, no: string, payee_name: string, payment_date: string, amount: number, confirmation_status: string, allocated_amount: number, voucher_no: string }>(`SELECT record.id,record.no,record.payee_name,record.payment_date,record.amount,record.confirmation_status,line.allocated_amount,record.voucher_no FROM payment_record_application_allocations line JOIN payment_records record ON record.id=line.payment_record_id WHERE line.payment_application_id=? AND line.deleted_at IS NULL AND record.deleted_at IS NULL ORDER BY record.created_at,record.id`, [draft.id])
    : []
  if (cash.some(row => typeof row.amount !== 'number' || !Number.isFinite(row.amount) || typeof row.allocated_amount !== 'number' || !Number.isFinite(row.allocated_amount)))
    return financeFailure('unavailable', '实际支付明细金额损坏，不能读取为零。')
  let elsewhere: { count: number, paid: number | null } | null = null
  if (draft.supplierId || draft.workerId) {
    const scope = [draft.id, draft.supplierId, draft.workerId, draft.projectId]
    const projects = await tx.select<{ project_id: string | null }>(`SELECT DISTINCT application.project_id FROM payment_applications application WHERE application.id<>? AND application.deleted_at IS NULL AND application.supplier_id IS ? AND application.worker_id IS ? AND application.project_id IS NOT ?`, scope)
    let paid: number | null = null
    if (actor.capabilities.includes('finance-payment-record:read')) {
      const allocations = await tx.select<{ allocated_amount: unknown, amount: unknown }>(`SELECT line.allocated_amount,cash.amount FROM payment_applications application JOIN payment_record_application_allocations line ON line.payment_application_id=application.id JOIN payment_records cash ON cash.id=line.payment_record_id WHERE application.id<>? AND application.deleted_at IS NULL AND application.supplier_id IS ? AND application.worker_id IS ? AND application.project_id IS NOT ? AND line.deleted_at IS NULL AND cash.deleted_at IS NULL AND cash.confirmation_status='confirmed'`, scope)
      allocations.forEach(row => verifiedFinanceSum([row.amount]))
      paid = verifiedFinanceSum(allocations.map(row => row.allocated_amount))
    }
    elsewhere = { count: projects.filter(row => row.project_id !== null).length, paid }
  }
  return {
    id: draft.id,
    no: draft.no,
    name: draft.name,
    bizType: draft.bizType,
    projectId: draft.projectId,
    projectName: project?.name ?? (draft.projectId ? '项目来源待核验' : '公司付款'),
    supplierId: draft.supplierId,
    workerId: draft.workerId ?? null,
    canEdit: actor.capabilities.includes('finance-payment-application:write'),
    canRegisterPayment: actor.capabilities.includes('finance-payment-record:write'),
    supplierName: draft.payeeNameSnapshot ?? '旧收款姓名待核验',
    contractId: draft.contractId,
    contractNo: String(contract?.no ?? ''),
    contractName: String(contract?.name ?? ''),
    contractAmount: money(contract?.amount),
    contractSettledAmount: null,
    contractPaidAmount: null,
    contractSourceState,
    contractTarget: contractSourceState === 'readable' && contract?.kind === '材采' ? `/contract/${draft.contractId}?contractKind=material&origin=real` : null,
    costName: draft.costName,
    applyAmount: decimalNumber(draft.applyAmount),
    applyDate: draft.applyDate,
    applicant: draft.applicant,
    invoiceState: draft.invoiceState,
    payContent: draft.payContent,
    prepayDeduct: decimalNumber(draft.prepayDeduct),
    prepayNote: draft.prepayNote,
    approvedAmount: money(approval.amount),
    approvedAmountState: approval.state,
    approvalNote: draft.approvalNote,
    status: draft.status,
    note: draft.note,
    externalRef: draft.externalRef,
    createdAt: financePersistedDateTime(head.created_at),
    updatedAt: read.updatedAt,
    settlementAllocated: decimalNumber(draft.settlementAllocated),
    settlementDifference: decimalNumber(draft.settlementDifference),
    invoiceAllocated: decimalNumber(draft.invoiceAllocated),
    invoiceDifference: decimalNumber(draft.invoiceDifference),
    pendingInvoiceAmount: money(draft.pendingInvoiceAmount),
    paidAmount: decimalNumber(draft.paidAmount),
    unpaidAmount: money(unpaid),
    registrationAmount: decimalNumber(registration),
    supplierOtherProjectCount: elsewhere?.count ?? null,
    supplierOtherProjectPaidAmount: elsewhere?.paid == null ? null : decimalNumber(elsewhere.paid),
    settlements,
    invoices,
    payments: cash.map(row => ({ id: row.id, no: row.no, payeeName: row.payee_name, paymentDate: row.payment_date, amount: decimalNumber(row.amount), confirmationStatus: row.confirmation_status, allocatedAmount: decimalNumber(row.allocated_amount), voucherNo: row.voucher_no })),
    paymentSourceState: actor.capabilities.includes('finance-payment-record:read') ? 'readable' : 'forbidden',
    insight: buildPaymentApplicationInsight({ status: draft.status, bizType: draft.bizType, workerId: draft.workerId, hasSettlementAllocations: settlements.length > 0, invoiceState: draft.invoiceState, applyAmount: draft.applyAmount, approvedAmount: draft.approvedAmount, approvedAmountOrigin: draft.approvedAmountOrigin, settlementAllocated: draft.settlementAllocated, invoiceAllocated: draft.invoiceAllocated, paidAmount: draft.paidAmount }),
  }
}
