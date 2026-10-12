import type { PayrollContext, PayrollDetailRead, PayrollListRead, PayrollQuery, PayrollRepository, PayrollSourcesRead } from './central-contract'
import { getDb } from '../db/connection'
import { payrollProblem } from './central-contract'
import { loadPayrollHistory } from './central-history'
import { loadPayrollGraph, payrollEvidence, payrollListRows, payrollSources, readPayrollStatement } from './central-read'

export function requirePayrollNative() {
  throw payrollProblem('forbidden', '工资、考勤及签工当前已接中央只读，新增、核对和发放尚未开放')
}
async function localContext(repo: PayrollRepository, query: PayrollQuery): Promise<PayrollContext> {
  if (query.origin !== 'demo' || !query.includeDemo)
    throw payrollProblem('forbidden', '正式工资不能回退本地读取')
  const authorized = await repo.list(query)
  if (authorized.context.origin !== 'demo' || !authorized.context.capabilities.includes('demo:read') || !authorized.context.capabilities.includes('payroll:read'))
    throw payrollProblem('forbidden', '演示工资授权不足')
  return authorized.context
}
export async function loadPayrollListRead(repo: PayrollRepository, query: PayrollQuery): Promise<PayrollListRead> {
  if (query.origin === 'real')
    return repo.list(query)
  const context = await localContext(repo, query)
  const graph = await loadPayrollGraph(await getDb())
  const ids = new Set([...graph.statements, ...graph.configs, ...graph.attendance, ...graph.daywork].map(row => String(row.project_id)))
  return { context, rows: payrollListRows(graph, query), projects: [...graph.projects].filter(([id]) => ids.has(id)).map(([id, name]) => ({ id, name, code: '' })), diagnostics: [] }
}
export async function loadPayrollDetailRead(repo: PayrollRepository, query: PayrollQuery, id: string): Promise<PayrollDetailRead> {
  if (query.origin === 'real')
    return repo.detail(query, id)
  const context = await localContext(repo, query)
  const db = await getDb()
  const graph = await loadPayrollGraph(db)
  const statement = await readPayrollStatement(db, id, graph)
  if ((query.projectId && statement.projectId !== query.projectId) || (query.month && statement.month !== query.month) || (query.crewId && statement.crewId !== query.crewId))
    throw payrollProblem('relationship-mismatch', '演示工资与指定范围不一致')
  return { context, statement, history: await loadPayrollHistory(db, graph, statement.projectId, id), evidence: payrollEvidence(graph, statement.projectId) }
}
export async function loadPayrollSourcesRead(repo: PayrollRepository, query: PayrollQuery & { projectId: string }): Promise<PayrollSourcesRead> {
  if (query.origin === 'real')
    return repo.sources(query)
  const context = await localContext(repo, query)
  const db = await getDb()
  const graph = await loadPayrollGraph(db)
  if (!graph.projects.has(query.projectId))
    throw payrollProblem('not-found', '指定来源项目不存在')
  return { context, ...payrollSources(graph, query), history: await loadPayrollHistory(db, graph, query.projectId), evidence: payrollEvidence(graph, query.projectId) }
}
