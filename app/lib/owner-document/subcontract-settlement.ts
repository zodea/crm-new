import type { DataOriginDTO, MoneyDTO, NavigationIntentDTO } from '../../types/read-model'
import type { ApprovedAmountState } from '../finance/approval-amount'
import { isEffectiveExpenditureContract } from '../contract/effective-status'
import { round2 } from '../util/number'

export interface SubcontractSettlementIdentity {
  id: string
  projectId: string | null
  supplierId?: string | null
  contractId: string | null
  amount: number | null
  status: string
  no?: string
  name?: string
  date?: string | null
}

export interface SubcontractSettlementSourceFact {
  id: string
  no: string
  name: string
  amount: number | null
  date: string | null
  status: string
}

export interface SubcontractSettlementEvidence {
  contractAmount: number | null
  supplements?: SubcontractSettlementSourceFact[] | null
  changes?: SubcontractSettlementSourceFact[] | null
  penalties?: Array<SubcontractSettlementSourceFact & { deductionAmount: number, deductionId: string }> | null
  settlements: SubcontractSettlementIdentity[]
  deductions: Array<{ id: string, settlementId: string, amount: number, active: boolean }> | null
  applications: Array<{
    id: string
    projectId: string | null
    supplierId: string | null
    contractId: string | null
    status: string
    no?: string
    name?: string
    date?: string | null
    applyAmount?: number
    approvedAmount?: number | null
    approvedAmountState?: ApprovedAmountState
    allocations: Array<{ settlementId: string, amount: number }>
    payments: Array<{ id: string, amount: number, confirmed: boolean, no?: string, name?: string, date?: string | null, totalAmount?: number }> | null
  }> | null
  /** Actual allocations survive an unavailable current claim; this is a projection, not another cash record. */
  cashApplications?: SubcontractSettlementEvidence['applications']
}

export type SubcontractSettlementSourceSection = 'supplements' | 'changes' | 'settlements' | 'penalties' | 'applications' | 'payments'
export interface SubcontractSettlementSourceRead {
  id: string
  no: string
  name: string
  date: string | null
  status: string
  amount: MoneyDTO | null
  /** Amount adopted by this settlement, independent from the original document amount. */
  allocatedAmount: MoneyDTO | null
  approvedAmount: MoneyDTO | null
  approvedAmountState: ApprovedAmountState | null
  note: string
  navigation: NavigationIntentDTO
}
export interface SubcontractSettlementEvidenceRead {
  originalContractAmount: MoneyDTO | null
  effectiveContractAmount: MoneyDTO | null
  sections: Record<SubcontractSettlementSourceSection, SubcontractSettlementSourceRead[] | null>
}

/** A same-owner projection: these rows never create another contract, cost or cash fact. */
export function buildSubcontractSettlementEvidenceRead(source: SubcontractSettlementIdentity & { dataOrigin: DataOriginDTO }, evidence?: SubcontractSettlementEvidence): SubcontractSettlementEvidenceRead {
  const money = (value: number | null | undefined) => value == null ? null : round2(value).toFixed(2)
  const navigate = (entity: 'subcontract-document' | 'payment-application' | 'payment-record', fact: { id: string, name?: string, no?: string }, variant: string): NavigationIntentDTO => ({ kind: 'entity-detail', subject: { state: 'resolved', entity, id: fact.id, label: fact.name || fact.no || fact.id, no: fact.no || null }, variant, view: null, filters: { dataOrigin: source.dataOrigin } })
  const row = (fact: Partial<SubcontractSettlementSourceFact> & { id: string }, navigation: NavigationIntentDTO, allocatedAmount: number | null = null, note = ''): SubcontractSettlementSourceRead => ({ id: fact.id, no: fact.no ?? '', name: fact.name ?? '', date: fact.date ?? null, status: fact.status ?? '', amount: money(fact.amount), allocatedAmount: money(allocatedAmount), approvedAmount: null, approvedAmountState: null, note, navigation })
  const supplements = evidence?.supplements?.filter(fact => isEffectiveExpenditureContract(fact.status)) ?? null
  const supplementalAmount = supplements == null || supplements.some(fact => fact.amount === null) ? null : supplements.reduce((sum, fact) => sum + fact.amount!, 0)
  const applications = evidence?.applications ?? null
  const cash = evidence?.cashApplications === undefined ? applications : evidence.cashApplications
  const paymentRows = cash == null || cash.some(application => application.payments === null)
    ? null
    : cash.flatMap((application) => {
        const singleSettlement = new Set(application.allocations.map(allocation => allocation.settlementId)).size === 1
        return (application.payments ?? []).map(payment => ({ ...row({ ...payment, amount: payment.totalAmount ?? payment.amount, status: payment.confirmed ? '已确认' : '未确认' }, navigate('payment-application', application, 'detail'), singleSettlement ? payment.amount : null, singleSettlement ? `申请 ${application.no || application.id} 的实际分摊；从原申请查看支付` : `申请 ${application.no || application.id} 关联多张结算，本单现金归属未知`), id: `${application.id}:${payment.id}` }))
      })
  return {
    originalContractAmount: money(evidence?.contractAmount),
    effectiveContractAmount: money(evidence?.contractAmount == null || supplementalAmount === null ? null : evidence.contractAmount + supplementalAmount),
    sections: {
      supplements: supplements?.map(fact => row(fact, source.contractId ? { kind: 'entity-subview', subject: { state: 'resolved', entity: 'contract', id: source.contractId, label: '分包合同', no: null }, variant: 'supplement', view: fact.id, filters: { dataOrigin: source.dataOrigin, contractKind: '分包' } } : { kind: 'unavailable', reason: 'missing-id' })) ?? null,
      changes: evidence?.changes?.map(fact => row(fact, navigate('subcontract-document', fact, 'change'))) ?? null,
      settlements: evidence?.settlements.filter(fact => sameSettlementRelations(source, fact)).map(fact => row(fact, navigate('subcontract-document', fact, 'settlement'), null, fact.id === source.id ? '本期结算；保留原结算额' : fact.status === 'confirmed' ? '往期已确认结算' : '往期未确认；不计入累计')) ?? null,
      penalties: evidence?.penalties?.map(fact => ({ ...row(fact, navigate('subcontract-document', fact, 'penalty'), fact.deductionAmount, '独立抵扣；保留罚扣与结算原额'), id: fact.deductionId })) ?? null,
      applications: applications?.map(fact => ({ ...row({ ...fact, amount: fact.applyAmount ?? null }, navigate('payment-application', fact, 'detail'), fact.allocations.filter(allocation => allocation.settlementId === source.id).reduce((sum, allocation) => sum + allocation.amount, 0), '申请原额与本单采用分摊分别展示'), approvedAmount: money(fact.approvedAmount), approvedAmountState: fact.approvedAmountState ?? null })) ?? null,
      payments: paymentRows,
    },
  }
}

export interface SubcontractSettlementAmounts {
  kind: 'sub_settlement'
  total: MoneyDTO | null
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
  const sum = (rows: SubcontractSettlementIdentity[] | undefined) => rows === undefined || rows.some(row => row.amount === null) ? null : rows.reduce((total, row) => total + row.amount!, 0)
  const cumulative = sum(confirmed)
  const prior = sum(confirmed?.filter(row => row.id !== source.id))
  const deductions = evidence?.deductions?.filter(row => row.active && row.settlementId === source.id).reduce((sum, row) => sum + row.amount, 0) ?? null
  const applications = evidence?.applications?.filter(row => ['submitted', 'approved', 'paying', 'paid'].includes(row.status)
    && sameSettlementRelations(source, row) && row.allocations.some(item => item.settlementId === source.id)) ?? null
  const applied = applications?.reduce((sum, row) => sum + row.allocations.filter(item => item.settlementId === source.id).reduce((total, item) => total + item.amount, 0), 0) ?? null
  // 多结算申请的部分支付没有结算级分摊，不得按比例或金额猜归属。
  const cashApplications = evidence?.cashApplications === undefined ? applications : evidence.cashApplications
  const paidByApplication = cashApplications?.filter(row => sameSettlementRelations(source, row) && row.allocations.some(item => item.settlementId === source.id)).map(row => ({
    paid: row.payments?.filter(payment => payment.confirmed).reduce((sum, payment) => sum + payment.amount, 0) ?? null,
    settlementCount: new Set(row.allocations.map(item => item.settlementId)).size,
  })) ?? null
  const paid = paidByApplication == null || paidByApplication.some(row => row.paid == null || (row.paid > 0 && row.settlementCount !== 1))
    ? null
    : paidByApplication.reduce((sum, row) => sum + (row.paid ?? 0), 0)
  const net = deductions == null || source.amount == null ? null : source.amount - deductions
  return {
    kind: 'sub_settlement',
    total: money(source.amount),
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
