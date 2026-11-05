import type { CentralInvoiceFields, CentralInvoiceItem } from './central-contract'

/** 仅在当前页面内存保留用户可见原始输入，不作为持久化发票事实。 */
export interface CentralInvoiceFormSnapshot {
  invoiceId: string
  baseVersion: string
  fields: CentralInvoiceFields
  money: { amount: string, taxAmount: string, totalAmount: string }
  items: Array<Omit<CentralInvoiceItem, 'quantity' | 'unitPrice' | 'amount' | 'taxAmount'> & { quantity: string, unitPrice: string, amount: string, taxAmount: string }>
  dirty: boolean
}
