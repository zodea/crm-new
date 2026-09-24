import type { ReceiptRecord, ReceiptReferenceFacts } from '../../app/lib/receipt/contract'
import contracts from '../../app/lib/db/seed/contracts.json'
import customers from '../../app/lib/db/seed/customers.json'
import projects from '../../app/lib/db/seed/projects.json'
import receipts from '../../app/lib/db/seed/receipt_registrations.json'
import { emptyReceiptDraft } from '../../app/lib/receipt/contract'

/** 演示源单独适配；旧样本没有合同 ID 时不按名称或项目补造。 */
export function receiptDemoRecords(): ReceiptRecord[] {
  return receipts.map(row => ({
    id: row.id,
    dataOrigin: 'demo',
    version: 'demo-receipt-v1',
    attachments: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: '',
    updatedBy: '',
    draft: { ...emptyReceiptDraft(), no: row.no, projectId: row.project_id, customerId: row.customer_id, receiptDate: row.receipt_date, amount: row.amount.toFixed(2), paymentMethod: row.payment_method, payerAccount: row.payer_account, status: row.status },
  }))
}

export function receiptDemoReferences(): ReceiptReferenceFacts {
  return {
    projects: projects.map(row => ({ id: row.id, name: row.name, customerId: row.customer_id ?? null })),
    customers: customers.map(row => ({ id: row.id, name: row.name })),
    contracts: contracts.filter(row => row.kind === '施工').map(row => ({ id: row.id, no: row.no, name: row.name, projectId: row.project_id, customerId: null, amount: row.amount.toFixed(2), status: row.status })),
  }
}
