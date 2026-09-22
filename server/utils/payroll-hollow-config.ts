import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollContext } from '../../app/lib/payroll/central-contract'
import type { PayrollHollowConfigQuery, PayrollHollowConfigRead, PayrollHollowPolicy } from '../../app/lib/payroll/central-hollow-deduction-contract'
import type { PayrollHollowProjectionProvider } from '../../app/lib/payroll/central-hollow-deduction-projection'
import type { PayrollIdentitySource } from './payroll-service'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { isPayrollHollowScope } from '../../app/lib/payroll/central-hollow-deduction-validation'
import { wireMonth } from '../../app/lib/payroll/central-payroll-wire'
import { loadPayrollAManagementBooks } from './payroll-a-fees-data'
import { effectivePayrollHollowPolicies, loadPayrollHollowPolicyRevisions, payrollHollowHash, samePayrollHollowScope } from './payroll-hollow-data'

export async function readPayrollHollowConfig(db: TransactionDb, base: PayrollContext, source: PayrollIdentitySource, query: PayrollHollowConfigQuery, provider?: PayrollHollowProjectionProvider): Promise<PayrollHollowConfigRead> {
  if (!isPayrollHollowScope(query.scope) || !wireMonth(query.month))
    throw payrollProblem('validation-failed', '空鼓配置缺少固定主体、项目与月份')
  const { scope, month } = query
  const reasons: string[] = []
  const leader = source.workers.find(worker => worker.id === scope.leaderWorkerId)
  if (!source.projects.some(project => project.id === scope.projectId) || !leader || (scope.crewId && (!source.crews.some(crew => crew.id === scope.crewId) || leader.crewId !== scope.crewId)))
    reasons.push('当前空鼓配置主体、项目或班组关系不可用')
  if (scope.formatFamily === 'A' && scope.book.bookPurpose === 'management') {
    const books = await loadPayrollAManagementBooks(db, scope.projectId)
    if (!books.some(book => book.id === scope.book.managementBookId && book.managerWorkerId === scope.leaderWorkerId))
      reasons.push('空鼓配置的原管理簿与负责人不匹配')
  }
  const revisions = (await loadPayrollHollowPolicyRevisions(db, scope.projectId, provider)).filter(revision => samePayrollHollowScope(revision.scope, scope))
  const effective = effectivePayrollHollowPolicies(revisions, scope, month)
  const items = await db.select<{ id: string, name: string | null }>('SELECT id,name FROM items WHERE project_id=? AND deleted_at IS NULL ORDER BY id', [scope.projectId])
  const policies: PayrollHollowPolicy[] = items.map((item) => {
    const revision = effective.find(revision => revision.itemId === item.id)
    return revision ? { itemId: item.id, itemName: item.name, enabled: revision.enabled, unitAmount: revision.unitAmount, source: 'configured', revisionId: revision.id, sourceVersion: payrollHollowHash(revision) } : { itemId: item.id, itemName: item.name, enabled: true, unitAmount: 30, source: 'default', revisionId: null, sourceVersion: 'hollow-default-30-v1' }
  })
  if ((await db.select(`SELECT w.id FROM wage_statements w LEFT JOIN payroll_a_statement_books b ON b.statement_id=w.id WHERE w.project_id=? AND w.leader_worker_id=? AND w.crew_id IS ? AND w.format_family=? AND w.status='released' AND w.month>=? AND (?<>'A' OR (COALESCE(b.book_purpose,'ordinary')=? AND b.management_book_id IS ?))`, [scope.projectId, scope.leaderWorkerId, scope.crewId, scope.formatFamily, month, scope.formatFamily, scope.book?.bookPurpose ?? null, scope.book?.managementBookId ?? null])).length)
    reasons.push('原主体已有该月或后续已发工资，配置修订请选择新的未发月份')
  if (!base.capabilities.includes('payroll:write'))
    reasons.push('当前身份只能阅读空鼓配置')
  const context = { ...base, readonly: !base.capabilities.includes('payroll:write'), sourceVersion: `${base.sourceVersion}+hollow-config:${payrollHollowHash({ query, policies, revisions, reasons })}` }
  return { context, query, policies, revisions, eligibility: { canSave: !reasons.length, reasons }, reasons }
}
