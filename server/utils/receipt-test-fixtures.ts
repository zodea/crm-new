import type { CoreMigrationServerEntityDTO } from '../../app/lib/migration/core-contract'
import type { OwnerCommercialDocumentSource } from '../../app/lib/owner-document/central-repository'
import { CONSTRUCTION_CONTRACT_EXISTING_RECORD, constructionContractCommandTestInstance } from './construction-contract-command-test-instance'
import { OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS } from './owner-commercial-document-fixtures'
import { receiptCommandTestInstance } from './receipt-command-service'

/** 仅供显式测试重置：把历史结算样例已声明的收款装入当前唯一收款源。 */
export function prepareLegacyReceiptTestFixtures(sessionId?: string | null, documents: readonly OwnerCommercialDocumentSource[] = OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS) {
  if (!constructionContractCommandTestInstance.rows(sessionId).some(row => row.id === CONSTRUCTION_CONTRACT_EXISTING_RECORD.id))
    constructionContractCommandTestInstance.importExisting([CONSTRUCTION_CONTRACT_EXISTING_RECORD], sessionId)
  const batchId = 'receipt-test-fixture'
  const rows = new Map<string, CoreMigrationServerEntityDTO>()
  for (const document of documents) {
    if (document.dataOrigin !== 'real' || document.kind !== 'final_settlement')
      continue
    for (const receipt of document.finalSettlementEvidence?.receipts ?? []) {
      rows.set(receipt.id, {
        entityType: 'receipt_registrations',
        id: receipt.id,
        legacyId: receipt.id,
        batchId,
        name: receipt.no,
        references: { projectId: document.projectId, customerId: document.customerId, contractId: document.contractId },
        amount: receipt.amount === null ? null : receipt.amount.toFixed(2),
        quantity: null,
        deletedAt: null,
        attributes: { no: receipt.no, receiptDate: receipt.date, status: receipt.status },
      })
    }
  }
  receiptCommandTestInstance.prepareMigrationSnapshot({ authority: 'central', activeBatchId: batchId, entities: [...rows.values()] }, sessionId)()
}
