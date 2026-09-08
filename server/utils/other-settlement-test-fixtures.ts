import type { OtherSettlementContext } from '../../app/lib/other-settlement/contract'
import type { OtherSettlementStored } from './other-settlement-instance'
/** Synthetic records used only by the guarded development reset endpoint. */
export function otherSettlementTestRecords(context: OtherSettlementContext): OtherSettlementStored[] {
  const contract = context.contracts[0]
  if (!contract)
    throw new Error('测试需要先提交真实测试合同')
  return Array.from({ length: 12 }, (_, index) => {
    const id = `synthetic-settlement-${String(index).padStart(2, '0')}`
    const relation = { settlementId: id, projectId: contract.projectId, contractId: contract.id, supplierId: contract.supplierId, date: '2026-09-08', effective: true, attribution: 'exact' as const, parentId: null }
    return { id, version: 1, workspaceId: context.workspaceId, migrationBatchId: null, draft: { id, name: `合成事实结算 ${index + 1}`, no: `JS-SYN-${index + 1}`, projectId: contract.projectId, contractId: contract.id, supplierId: contract.supplierId, totalAmount: 1060, taxRate: 6, status: 'pending', settlementDate: '2026-09-08', settlementType: '过程结算' }, attachments: [], audit: { createdAt: null, updatedAt: null, createdBy: null, updatedBy: null, responsible: null, department: null }, facts: [
      { ...relation, id: 'synthetic-deduction', sourceId: 'synthetic-penalty', no: 'FK-SYN', name: '合成质量抵扣', kind: 'penalty', status: 'executed', amount: '60.00' },
      { ...relation, id: 'synthetic-application-allocation', sourceId: 'synthetic-application', no: 'SQ-SYN', name: '合成付款申请', kind: 'application', status: 'approved', amount: '800.00' },
      { ...relation, id: 'synthetic-payment-allocation', sourceId: 'synthetic-payment', parentId: 'synthetic-application', no: 'ZF-SYN', name: '合成已确认支付', kind: 'payment', status: 'confirmed', amount: '300.00' },
    ] }
  })
}
