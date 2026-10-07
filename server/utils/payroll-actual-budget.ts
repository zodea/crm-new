import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { BusinessSession } from './business-session'
import type { BudgetActualSource } from './target-cost-actual'
import { loadPayrollActualFacts } from './payroll-actual-facts'

/** 内部受控投影；沿预算已有事务读取，不能调用会再次排队的工资公开服务。 */
export async function loadPayrollBudgetActual(db: TransactionDb, projectId: string, context: BusinessSession): Promise<BudgetActualSource[]> {
  const allowed = context.capabilities.includes('target-cost:read') && context.capabilities.includes('payroll:read')
  let status: BudgetActualSource['status'] = allowed ? 'unavailable' : 'forbidden'
  let version: string = status
  let rows: BudgetActualSource['rows'] = []
  if (allowed) {
    try {
      const facts = await loadPayrollActualFacts(db, { projectId })
      version = facts.sourceVersion
      // 缺个人分配不抹去可证的整单实额；未知总額不从已知部分冒充完整成本。
      status = facts.netAmount.state === 'known' ? 'complete' : facts.status === 'unavailable' || facts.status === 'forbidden' ? facts.status : 'pending'
      rows = facts.rows.map(fact => ({ identity: fact.identity, projectId: fact.projectId, category: '工人工资', amount: fact.signedAmount.value }))
    }
    catch { status = 'unavailable' }
  }
  return (['settledAmount', 'paidAmount'] as const).map(metric => ({ id: '工资实际收付', version, metric, categories: ['工人工资'], status, rows }))
}

/** The production budget consumes this same read-only signed actual fact set in its held transaction. */
export { loadPayrollBudgetActual as readProductionPayrollBudgetActual }
