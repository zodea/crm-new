import type { ReceiptReferenceFacts } from '../../app/lib/receipt/contract'
import { constructionContractCommandTestInstance } from './construction-contract-command-test-instance'
import { customerCommandTestInstance } from './customer-command-test-instance'
import { projectCommandTestInstance } from './project-command-test-instance'
import { createReceiptCommandTestInstance } from './receipt-command-test-instance'
import { receiptDemoRecords, receiptDemoReferences } from './receipt-demo'
import { createReceiptReadService } from './receipt-read-service'

export function receiptReferenceFacts(sessionId?: string | null): ReceiptReferenceFacts {
  return {
    projects: projectCommandTestInstance.rows(sessionId).filter(row => row.dataOrigin === 'real').map(row => ({ id: row.id, name: row.name, customerId: row.customerId ?? null })),
    customers: customerCommandTestInstance.rows(sessionId).filter(row => row.dataOrigin === 'real').map(row => ({ id: row.id, name: row.name })),
    contracts: constructionContractCommandTestInstance.rows(sessionId).filter(row => row.dataOrigin === 'real').map(row => ({ id: row.id, no: row.no, name: row.name, projectId: row.projectId, customerId: row.customerId, amount: row.amount !== null && Number.isFinite(row.amount) ? row.amount.toFixed(2) : null, status: row.status })),
  }
}

/** 可重置的浏览器中央实例；生产持久化由 ADR 0020 的后置工作承接。 */
export const receiptCommandTestInstance = createReceiptCommandTestInstance({ references: receiptReferenceFacts })
export const receiptReadService = createReceiptReadService({ commands: receiptCommandTestInstance, references: receiptReferenceFacts, demoRecords: receiptDemoRecords, demoReferences: receiptDemoReferences })
