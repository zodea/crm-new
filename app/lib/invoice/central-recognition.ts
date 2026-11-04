import type { CentralInvoiceFields, CentralInvoiceItem } from './central-contract'
import type { LocalInvoiceCandidate } from './recognize'

/** 提取可持久的票面候选；项目提示和勾稽推断不能被当成已确认事实。 */
export function invoiceCandidateForCommand(candidate: LocalInvoiceCandidate): {
  fields: CentralInvoiceFields
  items: CentralInvoiceItem[]
  source: 'local' | 'cloud'
  textPages: string[]
  unrecognizedPageIndexes: number[]
} {
  const source = candidate.fields
  return {
    fields: {
      invoiceNumber: source.invoiceNumber,
      invoiceDate: source.invoiceDate,
      invoiceType: source.invoiceType,
      buyer: source.buyer,
      buyerTaxNo: source.buyerTaxNo,
      seller: source.seller,
      sellerTaxNo: source.sellerTaxNo,
      amount: source.amount,
      taxAmount: source.taxAmount,
      totalAmount: source.totalAmount,
      taxRate: source.taxRate,
      remark: source.remark,
    },
    items: source.items.map(item => ({
      name: item.name,
      spec: item.spec,
      unit: item.unit,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: item.amount,
      taxRate: item.taxRate,
      taxAmount: item.taxAmount,
    })),
    source: candidate.source,
    textPages: [...candidate.textPages],
    unrecognizedPageIndexes: [...candidate.unrecognizedPageIndexes],
  }
}
