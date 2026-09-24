import type { CustomerReceiptSourceRow } from '../../app/lib/customer/repository'
import { receiptReadTestInstance } from './receipt-read-test-instance'

/** 客户读取普通收款的中央事实；最终结算引用不拥有或复制这份事实。 */
export function customerReceiptFacts(sessionId?: string | null) {
  const source = receiptReadTestInstance.facts(sessionId)
  const rows: CustomerReceiptSourceRow[] = source.capabilities.includes('customer:list:read')
    ? source.rows.filter(row => row.draft.customerId).map(({ id, dataOrigin, draft }) => ({
        dataOrigin,
        id,
        no: draft.no,
        customerId: draft.customerId!,
        projectId: source.capabilities.includes('project:list:read') ? draft.projectId : null,
        projectPermission: source.capabilities.includes('project:list:read') ? 'allowed' : 'forbidden',
        contractId: source.capabilities.includes('construction-contract:read') ? draft.contractId : null,
        contractPermission: source.capabilities.includes('construction-contract:read') ? 'allowed' : 'forbidden',
        payerAccount: draft.payerAccount,
        amount: draft.amount === null ? null : Number(draft.amount),
        paymentMethod: draft.paymentMethod,
        receiptDate: draft.receiptDate || null,
        status: draft.status,
      }))
    : []
  return { rows, sourceVersion: source.sourceVersion, asOf: source.asOf }
}
