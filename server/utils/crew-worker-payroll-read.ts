import type { PayrollHostScope, PayrollHostSection } from '../../app/lib/crew-worker/payroll-read'
import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { BusinessSession } from './business-session'
import { buildPayrollHostSection, unavailablePayrollHostSection } from '../../app/lib/crew-worker/payroll-read'
import { payrollAAmount } from '../../app/lib/payroll/central-a-calculation'
import { payrollCanonical } from '../../app/lib/payroll/central-command-shared'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { resolveBusinessSession } from './business-session'
import { demoWorkspaceTestInstance } from './demo-workspace-test-instance'
import { loadPayrollActualFacts } from './payroll-actual-facts'

function allowed(scope: PayrollHostScope, session: BusinessSession) {
  return session.capabilities.includes('payroll:read') && session.capabilities.includes(`${scope.kind}:list:read`)
}

/** 只读已有事务与原工资关系；转组、离场、软删不改变原发放身份。 */
export async function loadPayrollHostSection(tx: TransactionDb, scope: PayrollHostScope, session: BusinessSession): Promise<PayrollHostSection> {
  if (!allowed(scope, session))
    return unavailablePayrollHostSection(scope, 'forbidden', '无工资收付或当前档案查看权限')
  const heads = await tx.select<{ id: string, project_id: string, crew_id: string | null }>('SELECT id,project_id,crew_id FROM wage_statements WHERE status=\'released\' AND format_family IN (\'A\',\'C1\',\'C2\') ORDER BY id')
  const members = scope.kind === 'worker' ? await tx.select<{ statement_id: string }>('SELECT statement_id FROM wage_statement_members WHERE worker_id=?', [scope.id]) : []
  const selected = heads.filter(head => scope.kind === 'project' ? head.project_id === scope.id : scope.kind === 'crew' ? head.crew_id === scope.id : members.some(member => member.statement_id === head.id))
  const facts = []
  for (const projectId of [...new Set(selected.map(row => row.project_id))])
    facts.push(await loadPayrollActualFacts(tx, { projectId, originalStatementIds: selected.filter(row => row.project_id === projectId).map(row => row.id) }))
  const reasons = [...new Set(facts.flatMap(value => value.netAmount.reasons))]
  return buildPayrollHostSection(scope, {
    sourceVersion: payrollCanonical(facts.map(value => value.sourceVersion)),
    status: facts.some(value => value.status !== 'complete') ? 'partial' : 'complete',
    rows: facts.flatMap(value => value.rows),
    netAmount: payrollAAmount(facts.map(value => value.netAmount.value), reasons),
    diagnostics: facts.flatMap(value => value.diagnostics),
  })
}

/** detail 专用异步接缝，不从同步 facts()/identities() 回调，也不进入工资公开 read 队列。 */
export async function readPayrollHostSection(scope: PayrollHostScope, sessionId?: string | null): Promise<PayrollHostSection> {
  const session = () => ({ ...resolveBusinessSession(), capabilities: [...demoWorkspaceTestInstance.capabilities(sessionId)] })
  const before = session()
  if (!allowed(scope, before))
    return unavailablePayrollHostSection(scope, 'forbidden', '无工资收付或当前档案查看权限')
  try {
    const { quantityTestInstance } = await import('./quantity-runtime')
    const result = await quantityTestInstance.withWorkspaceTransaction(tx => loadPayrollHostSection(tx, scope, before), sessionId)
    if (payrollCanonical(before) !== payrollCanonical(session()))
      throw payrollProblem('forbidden', '读取期间身份或工资收付权限已变化')
    return result
  }
  catch {
    return unavailablePayrollHostSection(scope, allowed(scope, session()) ? 'unavailable' : 'forbidden', '工资收付来源暂不可用，请重新读取')
  }
}
