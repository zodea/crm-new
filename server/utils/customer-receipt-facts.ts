import type { CustomerReceiptSourceRow } from '../../app/lib/customer/repository'
import { ownerFinalSettlementReceiptIsActive } from '../../app/lib/owner-document/central-repository'
import { ownerCommercialDocumentReadTestInstance } from './owner-commercial-document-read-test-instance'

/** 复用已有最终结算的中央收款事实；同一收款被多张结算引用时只投影一次。 */
export function customerReceiptFacts(sessionId?: string | null) {
  const source = ownerCommercialDocumentReadTestInstance.facts('final_settlement', sessionId)
  const rows = new Map<string, CustomerReceiptSourceRow>()
  for (const document of source.documents) {
    if (document.kind !== 'final_settlement' || document.dataOrigin !== 'real' || !document.customerId)
      continue
    for (const receipt of document.finalSettlementEvidence?.receipts ?? []) {
      if (!ownerFinalSettlementReceiptIsActive(receipt.status))
        continue
      rows.set(receipt.id, {
        dataOrigin: document.dataOrigin,
        id: receipt.id,
        no: receipt.no,
        customerId: document.customerId,
        projectId: document.projectId,
        contractId: document.contractId,
        payerAccount: '',
        amount: receipt.amount,
        paymentMethod: '',
        receiptDate: receipt.date,
        status: receipt.status,
      })
    }
  }
  return { rows: [...rows.values()], sourceVersion: source.sourceVersion, asOf: source.asOf }
}
