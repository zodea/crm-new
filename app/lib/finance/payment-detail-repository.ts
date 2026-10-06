import type { PaymentApplicationDetailRead } from './payment-detail-contract'
import type { PaymentApplicationDetail } from './payment-detail-model'
import { isISODateTimeDTO } from '../../types/read-model'
import { isDecimalString } from '../read-model/decimal'
import { isApprovalReadState } from './approval-amount'
import { financeFailure } from './central-contract'
import { pendingInvoiceAmountForRead } from './domain'
import { PAYMENT_DETAIL_MONEY_FIELDS } from './payment-detail-contract'

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const id = (value: unknown) => typeof value === 'string' && /^[a-z0-9][\w-]{2,99}$/i.test(value)
const text = (value: unknown): value is string => typeof value === 'string'
const sourceStates = new Set(['readable', 'frozen', 'unavailable', 'forbidden'])
function broken(): never {
  return financeFailure('unavailable', '付款详情金额、采用身份或关联来源尚未核实，请保留原输入。')
}
export function decodePaymentApplicationDetail(value: unknown, target: string): PaymentApplicationDetailRead {
  if (!object(value) || !object(value.detail))
    return broken()
  const detail = value.detail
  const nullable = new Set(['contractAmount', 'contractSettledAmount', 'contractPaidAmount', 'approvedAmount', 'unpaidAmount', 'supplierOtherProjectPaidAmount', 'pendingInvoiceAmount'])
  const fields = ['no', 'name', 'bizType', 'projectName', 'supplierName', 'contractNo', 'contractName', 'costName', 'applyDate', 'applicant', 'invoiceState', 'payContent', 'prepayNote', 'approvalNote', 'status', 'note', 'externalRef']
  if (detail.id !== target || !fields.every(field => text(detail[field])) || !['projectId', 'supplierId', 'workerId', 'contractId'].every(field => detail[field] === null || id(detail[field])) || (detail.supplierId && detail.workerId)
    || !PAYMENT_DETAIL_MONEY_FIELDS.every(field => detail[field] === null ? nullable.has(field) : isDecimalString(detail[field]) && (field.endsWith('Difference') || Number(detail[field]) >= 0))
    || !isApprovalReadState(detail.approvedAmount === null ? null : Number(detail.approvedAmount), detail.approvedAmountState)
    || !(detail.supplierOtherProjectCount === null || (Number.isSafeInteger(detail.supplierOtherProjectCount) && Number(detail.supplierOtherProjectCount) >= 0))
    || typeof detail.canEdit !== 'boolean' || typeof detail.canRegisterPayment !== 'boolean'
    || !(detail.contractTarget === null || (detail.contractSourceState === 'readable' && detail.contractTarget === `/contract/${detail.contractId}?contractKind=material&origin=real`))
    || !isISODateTimeDTO(detail.createdAt) || !isISODateTimeDTO(detail.updatedAt)
    || !sourceStates.has(String(detail.contractSourceState)) || !['readable', 'forbidden'].includes(String(detail.paymentSourceState))
    || !object(detail.insight) || !Number.isSafeInteger(detail.insight.attentionCount) || !Array.isArray(detail.insight.checks)
    || detail.insight.checks.some(row => !object(row) || !['approval', 'settlement', 'invoice', 'payment'].includes(String(row.key)) || !['ok', 'info', 'warn', 'danger'].includes(String(row.level)) || !['title', 'summary', 'detail'].every(field => text(row[field])))) {
    return broken()
  }
  const expectedPending = pendingInvoiceAmountForRead(detail.invoiceState, Number(detail.applyAmount), Number(detail.invoiceAllocated))
  if (detail.pendingInvoiceAmount === null ? expectedPending !== null : Number(detail.pendingInvoiceAmount) !== expectedPending)
    return broken()
  for (const family of ['settlements', 'invoices', 'payments']) {
    const rows = detail[family]
    if (!Array.isArray(rows) || rows.some(row => !object(row) || !id(row.id) || !isDecimalString(row.allocatedAmount) || Number(row.allocatedAmount) <= 0) || new Set(rows.map(row => row.id)).size !== rows.length)
      return broken()
    if (rows.some((row) => {
      if (family === 'payments')
        return !isDecimalString(row.amount) || Number(row.amount) < 0 || !['no', 'payeeName', 'paymentDate', 'confirmationStatus', 'voucherNo'].every(field => text(row[field]))
      return !(row.totalAmount === null || isDecimalString(row.totalAmount)) || !text(row.note) || !sourceStates.has(String(row.sourceState))
        || !(family === 'settlements' ? ['no', 'name', 'settlementDate', 'status'] : ['invoiceNumber', 'invoiceDate']).every(field => text(row[field]))
    })) {
      return broken()
    }
  }
  if (detail.paymentSourceState === 'forbidden' && (detail.payments as unknown[]).length)
    return broken()
  return value as unknown as PaymentApplicationDetailRead
}
export function paymentApplicationDetailModel(read: PaymentApplicationDetailRead): PaymentApplicationDetail {
  const value = read.detail
  const nullableAmount = (amount: string | null) => amount === null ? null : Number(amount)
  const requiredAmount = (amount: string | null) => {
    if (amount === null)
      return broken()
    return Number(amount)
  }
  return {
    ...value,
    contractAmount: nullableAmount(value.contractAmount),
    contractSettledAmount: nullableAmount(value.contractSettledAmount),
    contractPaidAmount: nullableAmount(value.contractPaidAmount),
    applyAmount: requiredAmount(value.applyAmount),
    prepayDeduct: requiredAmount(value.prepayDeduct),
    approvedAmount: nullableAmount(value.approvedAmount),
    settlementAllocated: requiredAmount(value.settlementAllocated),
    settlementDifference: requiredAmount(value.settlementDifference),
    invoiceAllocated: requiredAmount(value.invoiceAllocated),
    invoiceDifference: requiredAmount(value.invoiceDifference),
    pendingInvoiceAmount: nullableAmount(value.pendingInvoiceAmount),
    paidAmount: requiredAmount(value.paidAmount),
    unpaidAmount: nullableAmount(value.unpaidAmount),
    registrationAmount: requiredAmount(value.registrationAmount),
    supplierOtherProjectPaidAmount: nullableAmount(value.supplierOtherProjectPaidAmount),
    settlements: value.settlements.map(row => ({ ...row, totalAmount: row.totalAmount === null ? null : Number(row.totalAmount), allocatedAmount: Number(row.allocatedAmount) })),
    invoices: value.invoices.map(row => ({ ...row, totalAmount: row.totalAmount === null ? null : Number(row.totalAmount), allocatedAmount: Number(row.allocatedAmount) })),
    payments: value.payments.map(row => ({ ...row, amount: Number(row.amount), allocatedAmount: Number(row.allocatedAmount) })),
  }
}
