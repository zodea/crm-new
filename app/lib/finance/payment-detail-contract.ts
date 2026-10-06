import type { MoneyDTO } from '../../types/read-model'
import type { FinanceContext } from './central-contract'
import type { PaymentApplicationDetail, PaymentApplicationInvoiceDetail, PaymentApplicationPaymentDetail, PaymentApplicationSettlementDetail } from './payment-detail-model'

export const PAYMENT_DETAIL_MONEY_FIELDS = ['contractAmount', 'contractSettledAmount', 'contractPaidAmount', 'applyAmount', 'prepayDeduct', 'approvedAmount', 'settlementAllocated', 'settlementDifference', 'invoiceAllocated', 'invoiceDifference', 'pendingInvoiceAmount', 'paidAmount', 'unpaidAmount', 'registrationAmount', 'supplierOtherProjectPaidAmount'] as const
export type PaymentDetailMoneyField = typeof PAYMENT_DETAIL_MONEY_FIELDS[number]
export type PaymentApplicationDetailDTO = Omit<PaymentApplicationDetail, PaymentDetailMoneyField | 'settlements' | 'invoices' | 'payments'> & {
  [K in PaymentDetailMoneyField]: MoneyDTO | null
} & {
  settlements: Array<Omit<PaymentApplicationSettlementDetail, 'totalAmount' | 'allocatedAmount'> & { totalAmount: MoneyDTO | null, allocatedAmount: MoneyDTO, sourceState: 'readable' | 'frozen' | 'unavailable' | 'forbidden' }>
  invoices: Array<Omit<PaymentApplicationInvoiceDetail, 'totalAmount' | 'allocatedAmount'> & { totalAmount: MoneyDTO | null, allocatedAmount: MoneyDTO, sourceState: 'readable' | 'frozen' | 'unavailable' | 'forbidden' }>
  payments: Array<Omit<PaymentApplicationPaymentDetail, 'amount' | 'allocatedAmount'> & { amount: MoneyDTO, allocatedAmount: MoneyDTO }>
}
export interface PaymentApplicationDetailRead extends FinanceContext { detail: PaymentApplicationDetailDTO }
