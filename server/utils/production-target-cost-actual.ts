import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CostCategory } from '../../app/lib/project/cost-control'
import type { BusinessSession } from './business-session'
import type { BudgetActualSource } from './target-cost-actual'
import { isEffectiveExpenditureContract } from '../../app/lib/contract/effective-status'
import { readProductionPayrollBudgetActual } from './payroll-actual-budget'
import { listOriginalExpenseReferences } from './production-finance-expense-references'
import { validateFinanceJournal } from './production-finance-journal'
import { readMaterialContractSupplierFacts } from './production-material-contract-service'
import { listProductionOtherSettlementReferences } from './production-other-settlement-service'
import { budgetDigest } from './production-target-cost-files'
import { aggregateTargetCostActual } from './target-cost-actual'

/** Only reads original formal owners inside the caller's transaction. Missing owners stay unknown. */
export async function loadProductionBudgetActual(tx: TransactionDb, projectId: string | null, actor: BusinessSession) {
  if (!projectId)
    return aggregateTargetCostActual(null, [])
  const sources: BudgetActualSource[] = []
  const source = (id: string, metric: BudgetActualSource['metric'], categories: CostCategory[]): BudgetActualSource => ({ id, metric, categories, status: 'complete', rows: [], version: '' })
  const material = source('正式材料采购合同', 'signedAmount', ['材料'])
  const materialIds = new Set<string>()
  try {
    const facts = await readMaterialContractSupplierFacts(tx, actor, undefined, new Date().toISOString())
    material.version = facts.source.sourceVersion ?? ''
    if (facts.records === null)
      material.status = 'forbidden'
    for (const row of facts.records ?? []) {
      if (row.draft.projectId !== projectId || row.migrationRetired || row.migrationEvidence?.deletedAt || row.draft.isSupplement)
        continue
      materialIds.add(row.id)
      if (!isEffectiveExpenditureContract(row.draft.status ?? 'draft'))
        continue
      const supplier = row.draft.supplierId ? (await tx.select('SELECT id FROM suppliers WHERE id=? AND deleted_at IS NULL', [row.draft.supplierId]))[0] : null
      material.rows.push({ identity: `contract:${row.id}`, projectId, category: '材料', amount: supplier ? row.draft.amount ?? null : null })
    }
  }
  catch (cause) { material.status = (cause as { problem?: { code: string } }).problem?.code === 'forbidden' ? 'forbidden' : 'unavailable' }
  sources.push(material)
  const costs = source('正式独立原费用（清偿及采用不重复计成本）', 'settledAmount', ['费用报销'])
  const payments = source('正式精确支付分摊', 'paidAmount', ['材料', '费用报销', '其他', '机械', '未分类'])
  try {
    if (!actor.capabilities.includes('finance-reimbursement:read')) {
      costs.status = 'forbidden'
    }
    else {
      await validateFinanceJournal(tx, actor)
      const expenses = await listOriginalExpenseReferences(tx, actor, projectId)
      costs.version = budgetDigest(expenses)
      costs.rows = expenses.map(row => ({ identity: `original-expense:${row.id}`, projectId, category: '费用报销', amount: row.amount }))
    }
    if (!actor.capabilities.includes('finance-payment-record:read') || !actor.capabilities.includes('finance-payment-application:read')) {
      payments.status = 'forbidden'
    }
    else {
      await validateFinanceJournal(tx, actor)
      const settlements = actor.capabilities.includes('other-settlement:read') ? await listProductionOtherSettlementReferences(tx, actor) : null
      const rows = await tx.select<Record<string, unknown>>(`SELECT pay.id AS payment_id,pay.amount AS payment_amount,alloc.id AS allocation_id,alloc.allocated_amount,
        app.id AS application_id,app.contract_id,app.project_id,app.status FROM payment_records pay
        LEFT JOIN payment_record_application_allocations alloc ON alloc.payment_record_id=pay.id AND alloc.deleted_at IS NULL
        LEFT JOIN payment_applications app ON app.id=alloc.payment_application_id AND app.deleted_at IS NULL
        WHERE pay.project_id=? AND pay.deleted_at IS NULL AND pay.confirmation_status='confirmed' ORDER BY pay.id,alloc.id`, [projectId])
      payments.version = budgetDigest(rows)
      for (const row of rows) {
        let category: CostCategory = '未分类'
        let qualified = Boolean(row.allocation_id && row.application_id && row.project_id === projectId && ['submitted', 'approved', 'paying', 'paid'].includes(String(row.status)))
        if (materialIds.has(String(row.contract_id))) {
          category = '材料'
        }
        else {
          const adopted = await tx.select<{ settlement_id: string }>('SELECT settlement_id FROM payment_application_settlement_allocations WHERE payment_application_id=? AND deleted_at IS NULL ORDER BY id', [row.application_id ?? ''])
          const matches = adopted.map(allocation => settlements?.find(settlement => settlement.id === allocation.settlement_id)).filter(row => row !== undefined)
          if (adopted.length && matches.length === adopted.length && matches.every(match => match.original_expense_line_ids.length > 0 && !match.deleted_at && match.status === 'confirmed' && match.project_id === projectId && !match.unavailable_reason))
            category = '费用报销'
          else
            qualified = false
        }
        payments.rows.push({ identity: row.allocation_id ? `payment:${row.payment_id}:${row.allocation_id}` : `payment-unknown:${row.payment_id}`, projectId, category, amount: qualified && typeof row.allocated_amount === 'number' ? row.allocated_amount : null })
      }
    }
  }
  catch (cause) {
    const status = (cause as { problem?: { code: string } }).problem?.code === 'forbidden' ? 'forbidden' : 'unavailable'
    costs.status = payments.status = status
  }
  sources.push(costs, payments)
  sources.push(...await readProductionPayrollBudgetActual(tx, projectId, actor))
  for (const metric of ['signedAmount', 'settledAmount', 'paidAmount'] as const) {
    const missing: CostCategory[] = metric === 'signedAmount' ? ['专业分包', '合同劳务', '机械', '其他'] : ['专业分包', '合同劳务', '机械', '其他', '工人工资', ...(metric === 'settledAmount' ? ['材料' as const] : [])]
    sources.push({ ...source('分包、其他合同及完整工资等正式来源待接管', metric, missing), status: 'pending' })
  }
  return aggregateTargetCostActual(projectId, sources)
}
