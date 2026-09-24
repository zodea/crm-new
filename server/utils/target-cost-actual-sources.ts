import type { CostCategory } from '../../app/lib/project/cost-control'
import type { BudgetActualMetric, BudgetActualSource, TargetCostActualReadContext } from './target-cost-actual'
import { isEffectiveExpenditureContract } from '../../app/lib/contract/effective-status'
import { isEffectiveSettlementFact } from '../../app/lib/other-settlement/facts'
import { sameSettlementRelations, subcontractSettlementAmounts } from '../../app/lib/owner-document/subcontract-settlement'
import { costCategoryFromContract } from '../../app/lib/project/cost-control'
import { auxiliaryContractInstance, auxiliaryContractSession } from './auxiliary-contract-runtime'
import { materialContractCommandTestInstance } from './material-contract-command-test-instance'
import { materialContractReadTestInstance } from './material-contract-read-test-instance'
import { otherSettlementInstance, otherSettlementSession } from './other-settlement-runtime'
import { ownerCommercialDocumentReadTestInstance } from './owner-commercial-document-read-test-instance'
import { loadPayrollBudgetActual } from './payroll-actual-budget'
import { subcontractContractCommandTestInstance } from './subcontract-contract-command-test-instance'
import { subcontractContractReadTestInstance } from './subcontract-contract-read-test-instance'
import { aggregateTargetCostActual } from './target-cost-actual'

const SUB: CostCategory[] = ['专业分包', '合同劳务', '未分类']
const OTHER: CostCategory[] = ['机械', '其他', '未分类']
function failureStatus(cause: unknown): BudgetActualSource['status'] {
  return (cause as {
    problem?: {
      code?: string
    }
  })?.problem?.code === 'forbidden'
    ? 'forbidden'
    : 'unavailable'
}
function source(id: string, metric: BudgetActualMetric, categories: CostCategory[]): BudgetActualSource {
  return { id, metric, categories, status: 'complete', version: '', rows: [] }
}
function money(value: string | null): number | null {
  return value == null ? null : Number(value)
}
/** 只读取已接管事实；工资沿同一事务读取，报销及材采缺源保留未接状态。 */
export async function loadTargetCostActual(projectId: string | null, sessionId?: string | null, read?: TargetCostActualReadContext) {
  if (!projectId)
    return aggregateTargetCostActual(null, [])
  const sources: BudgetActualSource[] = []
  const subSigned = source('分包合同', 'signedAmount', SUB)
  const categories = new Map<string, CostCategory>()
  const contractSuppliers = new Map<string, string>()
  try {
    const authorized = subcontractContractReadTestInstance.list({ origin: 'real', projectId, page: '1', pageSize: '10' }, sessionId)
    subSigned.version = authorized.sourceVersion ?? ''
    for (const row of subcontractContractCommandTestInstance.budgetRows(sessionId).filter(row => row.dataOrigin === 'real' && row.projectId === projectId)) {
      const category = costCategoryFromContract({ kind: '分包', sub_kind: row.subKind })
      categories.set(row.id, category)
      if (row.projectResolved && row.supplierResolved && row.supplierId)
        contractSuppliers.set(row.id, row.supplierId)
      if (isEffectiveExpenditureContract(row.status))
        subSigned.rows.push({ identity: `contract:${row.id}`, projectId, category, amount: row.projectResolved && row.supplierResolved ? row.amount : null })
    }
  }
  catch (cause) {
    subSigned.status = failureStatus(cause)
  }
  sources.push(subSigned)
  const material = source('材料采购合同', 'signedAmount', ['材料'])
  try {
    const authorized = materialContractReadTestInstance.list({ origin: 'real', projectId, page: '1', pageSize: '10' }, sessionId)
    material.version = authorized.sourceVersion ?? ''
    material.rows = materialContractCommandTestInstance.budgetRows(sessionId).filter(row => row.dataOrigin === 'real' && row.projectId === projectId && isEffectiveExpenditureContract(row.status)).map(row => ({ identity: `contract:${row.id}`, projectId, category: '材料', amount: row.projectReferenceState === 'resolved' && row.supplierReferenceState === 'resolved' ? row.amount : null }))
  }
  catch (cause) {
    material.status = failureStatus(cause)
  }
  sources.push(material)
  const auxiliary = source('其他支出合同', 'signedAmount', OTHER)
  try {
    const session = auxiliaryContractSession(sessionId)
    // context 执行当前读取权限和当前中央身份校验，内部全量事实本身不构成授权。
    const instance = auxiliaryContractInstance(sessionId)
    instance.otherSettlementContext(session)
    const facts = instance.supplierReadSource(session.workspaceId)
    auxiliary.version = facts.sourceVersion
    for (const row of facts.rows.filter(row => row.dataOrigin === 'real' && row.draft.projectId === projectId)) {
      const category = costCategoryFromContract({ kind: '其他支出', other_expense_kind: row.draft.category })
      categories.set(row.id, category)
      if (row.project?.state === 'resolved' && row.supplier?.state === 'resolved')
        contractSuppliers.set(row.id, row.supplier.id)
      if (isEffectiveExpenditureContract(row.draft.status ?? 'draft'))
        auxiliary.rows.push({ identity: `contract:${row.id}`, projectId, category, amount: row.project?.state === 'resolved' && row.supplier?.state === 'resolved' ? money(row.amounts.contract) : null })
    }
  }
  catch (cause) {
    auxiliary.status = failureStatus(cause)
  }
  sources.push(auxiliary)
  const settled = source('分包已确认结算', 'settledAmount', SUB)
  const paid = source('分包结算实付款', 'paidAmount', SUB)
  try {
    const facts = ownerCommercialDocumentReadTestInstance.facts('sub_settlement', sessionId)
    settled.version = paid.version = facts.sourceVersion
    for (const row of facts.documents.filter(row => row.dataOrigin === 'real' && row.kind === 'sub_settlement' && row.projectId === projectId && row.status === 'confirmed')) {
      const category = categories.get(row.contractId ?? '') ?? '未分类'
      const qualified = Boolean(row.contractId && row.supplierId && contractSuppliers.get(row.contractId) === row.supplierId)
      settled.rows.push({ identity: `settlement:${row.id}`, projectId, category, amount: qualified ? row.amount : null })
      const evidence = row.subcontractSettlementEvidence
      if (!qualified || evidence?.applications == null) {
        paid.rows.push({ identity: `settlement-unknown:${row.id}`, projectId, category, amount: null })
        continue
      }
      const applications = evidence?.applications?.filter(application => ['submitted', 'approved', 'paying', 'paid'].includes(application.status) && sameSettlementRelations(row, application) && application.allocations.some(allocation => allocation.settlementId === row.id)) ?? []
      for (const application of applications) {
        if (subcontractSettlementAmounts(row, { ...evidence, applications: [application] }).cumulativePaid == null) {
          paid.rows.push({ identity: `application-unknown:${application.id}`, projectId, category, amount: null })
          continue
        }
        for (const payment of application.payments?.filter(payment => payment.confirmed) ?? [])
          paid.rows.push({ identity: `payment:${payment.id}`, projectId, category, amount: payment.amount })
      }
    }
    if (subSigned.status !== 'complete') {
      settled.status = 'pending'
      paid.status = 'pending'
    }
  }
  catch (cause) {
    settled.status = paid.status = failureStatus(cause)
  }
  sources.push(settled, paid)
  const otherSettled = source('其他支出已确认结算', 'settledAmount', OTHER)
  const otherPaid = source('其他支出结算实付款', 'paidAmount', OTHER)
  try {
    const session = otherSettlementSession(sessionId)
    const instance = otherSettlementInstance(sessionId)
    instance.list({ origin: 'real', projectId }, session)
    const facts = instance.supplierReadSource(session.workspaceId)
    otherSettled.version = otherPaid.version = facts.sourceVersion
    for (const row of facts.rows.filter(row => row.dataOrigin === 'real' && row.draft.projectId === projectId && row.draft.status === 'confirmed')) {
      const category = categories.get(row.draft.contractId ?? '') ?? '未分类'
      const qualified = Boolean(row.draft.contractId && row.draft.supplierId && contractSuppliers.get(row.draft.contractId) === row.draft.supplierId && row.project.state === 'resolved' && row.supplier.state === 'resolved' && row.contract.state === 'resolved')
      otherSettled.rows.push({ identity: `settlement:${row.id}`, projectId, category, amount: qualified ? money(row.amounts.total) : null })
      const unknown = () => otherPaid.rows.push({ identity: `settlement-unknown:${row.id}`, projectId, category, amount: null })
      if (!qualified) {
        unknown()
        continue
      }
      try {
        const detail = instance.detail(row.id, { origin: 'real' }, session)
        if (detail.facts == null) {
          unknown()
          continue
        }
        for (const fact of detail.facts.filter(fact => fact.kind === 'payment' && isEffectiveSettlementFact(fact)))
          otherPaid.rows.push({ identity: `payment:${fact.sourceId}:${fact.allocationId ?? fact.id}`, projectId, category, amount: fact.attribution === 'exact' ? money(fact.amount) : null })
        if (row.amounts.paid == null && !detail.facts.some(fact => fact.kind === 'payment'))
          unknown()
      }
      catch { unknown() }
    }
    if (auxiliary.status !== 'complete') {
      otherSettled.status = 'pending'
      otherPaid.status = 'pending'
    }
  }
  catch (cause) {
    otherSettled.status = otherPaid.status = failureStatus(cause)
  }
  sources.push(otherSettled, otherPaid)
  if (read)
    sources.push(...await loadPayrollBudgetActual(read.db, projectId, read.context))
  for (const metric of ['settledAmount', 'paidAmount'] as const) {
    if (!read)
      sources.push({ ...source('工资实际来源事务不可用', metric, ['工人工资']), status: 'unavailable' })
    sources.push({ ...source('材料结算/实付、已确认报销尚未接管', metric, ['材料', '费用报销']), status: 'pending' })
  }
  return aggregateTargetCostActual(projectId, sources)
}
