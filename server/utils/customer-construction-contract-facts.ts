import type { CustomerContractSourceRow } from '../../app/lib/customer/repository'
import { constructionContractSupplementAmount } from '../../app/lib/construction-contract/repository'
import { constructionContractReadTestInstance } from './construction-contract-read-test-instance'

/** 客户投影复用施工合同主读源的权限、版本与完整事实，不维护第二份合同。 */
export function customerConstructionContractFacts(sessionId?: string | null) {
  const source = constructionContractReadTestInstance.facts(sessionId)
  const rows: CustomerContractSourceRow[] = source.contracts
    .filter(row => row.kind === '施工' && (row.dataOrigin === 'real' || source.capabilities.includes('demo:read')))
    .map(row => ({
      dataOrigin: row.dataOrigin,
      id: row.id,
      no: row.no,
      name: row.name,
      customerId: row.customerPermission === 'allowed' ? row.customerId : null,
      projectId: row.projectId,
      projectPermission: row.projectPermission,
      amount: row.amount,
      supplementAmount: constructionContractSupplementAmount(row, source.facts),
      receiptAmount: row.receivedAmount,
      signDate: row.signDate,
      status: row.status,
    }))
  return { rows, sourceVersion: source.sourceVersion, asOf: source.asOf }
}
