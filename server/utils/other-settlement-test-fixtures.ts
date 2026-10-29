import type { OtherSettlementContext, OtherSettlementSourceDocument } from '../../app/lib/other-settlement/contract'
import type { OtherSettlementStored } from './other-settlement-instance'
/** Synthetic records used only by the guarded development reset endpoint. */
export function otherSettlementTestRecords(context: OtherSettlementContext): OtherSettlementStored[] {
  const contract = context.contracts[0]
  if (!contract)
    throw new Error('测试需要先提交真实测试合同')
  return Array.from({ length: 12 }, (_, index) => {
    const id = `synthetic-settlement-${String(index).padStart(2, '0')}`
    const relation = { settlementId: id, projectId: contract.projectId, contractId: contract.id, supplierId: contract.supplierId, date: '2026-09-08', effective: true, attribution: 'exact' as const, parentId: null }
    return { id, version: 1, workspaceId: context.workspaceId, migrationBatchId: null, draft: { id, name: `合成事实结算 ${index + 1}`, no: `JS-SYN-${index + 1}`, projectId: contract.projectId, contractId: contract.id, supplierId: contract.supplierId, totalAmount: 1060, taxRate: 6, status: 'pending', settlementDate: '2026-09-08', settlementType: '过程结算' }, attachments: [], audit: { createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z', createdBy: null, updatedBy: null, responsible: null, department: null }, facts: [
      { ...relation, id: `${id}-deduction`, sourceId: `${id}-penalty`, no: 'FK-SYN', name: '合成质量抵扣', kind: 'penalty', status: 'executed', amount: '60.00' },
      { ...relation, id: `${id}-application-allocation`, sourceId: `${id}-application`, no: 'SQ-SYN', name: '合成付款申请', kind: 'application', status: 'approved', amount: '800.00' },
      { ...relation, id: `${id}-payment-allocation`, sourceId: `${id}-payment`, parentId: `${id}-application`, no: 'ZF-SYN', name: '合成已确认支付', kind: 'payment', status: 'confirmed', amount: '300.00' },
    ] }
  })
}
export function otherSettlementTestSources(records: OtherSettlementStored[]): OtherSettlementSourceDocument[] {
  return records.flatMap(row => (row.facts ?? []).map(f => ({
    id: f.sourceId,
    kind: f.kind,
    no: f.no,
    name: f.name,
    status: f.kind === 'penalty' ? 'deducted' : f.status,
    date: f.date,
    amount: f.kind === 'application' ? '1000.00' : f.amount,
    projectId: f.projectId,
    contractId: f.contractId,
    supplierId: f.supplierId,
    fields: [{ label: f.kind === 'payment' ? '凭证号' : f.kind === 'penalty' ? '整改说明' : '批复说明', value: '仅用于 AX05 验收的合成源单资料' }],
    allocations: [{ id: f.id, targetId: f.parentId ?? row.id, kind: f.kind === 'payment' ? 'application' : 'settlement', amount: f.amount, effective: true, unavailableReason: null }],
    files: [],
  })))
}
