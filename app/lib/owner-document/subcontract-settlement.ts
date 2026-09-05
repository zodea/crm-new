import type { MoneyDTO } from '../../types/read-model'
import { round2 } from '../util/number'

export interface SubcontractSettlementIdentity {
  id: string
  projectId: string | null
  supplierId?: string | null
  contractId: string | null
  amount: number
  status: string
}

export interface SubcontractSettlementEvidence {
  contractAmount: number | null
  settlements: SubcontractSettlementIdentity[]
  deductions: Array<{ id: string, settlementId: string, amount: number, active: boolean }> | null
  applications: Array<{
    id: string
    projectId: string | null
    supplierId: string | null
    contractId: string | null
    status: string
    allocations: Array<{ settlementId: string, amount: number }>
    payments: Array<{ id: string, amount: number, confirmed: boolean }> | null
  }> | null
}

export interface SubcontractSettlementAmounts {
  kind: 'sub_settlement'
  total: MoneyDTO
  contractAmount: MoneyDTO | null
  priorSettled: MoneyDTO | null
  cumulativeSettled: MoneyDTO | null
  deductions: MoneyDTO | null
  netSettlement: MoneyDTO | null
  cumulativeApplied: MoneyDTO | null
  remainingApplicable: MoneyDTO | null
  cumulativePaid: MoneyDTO | null
  remainingUnpaid: MoneyDTO | null
}

export function sameSettlementRelations(left: SubcontractSettlementIdentity, right: Pick<SubcontractSettlementIdentity, 'projectId' | 'supplierId' | 'contractId'>): boolean {
  return Boolean(left.projectId && left.supplierId && left.contractId)
    && left.projectId === right.projectId && left.supplierId === right.supplierId && left.contractId === right.contractId
}

export function subcontractSettlementAmounts(source: SubcontractSettlementIdentity, evidence?: SubcontractSettlementEvidence): SubcontractSettlementAmounts {
  const money = (value: number | null | undefined) => value == null ? null : round2(value).toFixed(2)
  const confirmed = !source.projectId || !source.supplierId || !source.contractId ? undefined : evidence?.settlements.filter(row => row.status === 'confirmed' && sameSettlementRelations(source, row))
  const cumulative = confirmed?.reduce((sum, row) => sum + row.amount, 0) ?? null
  const prior = confirmed?.filter(row => row.id !== source.id).reduce((sum, row) => sum + row.amount, 0) ?? null
  const deductions = evidence?.deductions?.filter(row => row.active && row.settlementId === source.id).reduce((sum, row) => sum + row.amount, 0) ?? null
  const applications = evidence?.applications?.filter(row => ['submitted', 'approved', 'paying', 'paid'].includes(row.status)
    && sameSettlementRelations(source, row) && row.allocations.some(item => item.settlementId === source.id)) ?? null
  const applied = applications?.reduce((sum, row) => sum + row.allocations.filter(item => item.settlementId === source.id).reduce((total, item) => total + item.amount, 0), 0) ?? null
  // 多结算申请的部分支付没有结算级分摊，不得按比例或金额猜归属。
  const paidByApplication = applications?.map(row => ({
    paid: row.payments?.filter(payment => payment.confirmed).reduce((sum, payment) => sum + payment.amount, 0) ?? null,
    settlementCount: new Set(row.allocations.map(item => item.settlementId)).size,
  })) ?? null
  const paid = paidByApplication == null || paidByApplication.some(row => row.paid == null || (row.paid > 0 && row.settlementCount !== 1))
    ? null
    : paidByApplication.reduce((sum, row) => sum + (row.paid ?? 0), 0)
  const net = deductions == null ? null : source.amount - deductions
  return {
    kind: 'sub_settlement',
    total: money(source.amount)!,
    contractAmount: money(evidence?.contractAmount),
    priorSettled: money(prior),
    cumulativeSettled: money(cumulative),
    deductions: money(deductions),
    netSettlement: money(net),
    cumulativeApplied: money(applied),
    remainingApplicable: money(net == null || applied == null ? null : net - applied),
    cumulativePaid: money(paid),
    remainingUnpaid: money(net == null || paid == null ? null : net - paid),
  }
}
