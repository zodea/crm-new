import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollContext, PayrollDetailRead, PayrollListRead, PayrollProjectOption, PayrollQuery, PayrollSourcesRead } from '../../app/lib/payroll/central-contract'
import type { BusinessSession } from './business-session'
import { createHash } from 'node:crypto'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { loadPayrollHistory } from '../../app/lib/payroll/central-history'
import { loadPayrollGraph, payrollEvidence, payrollListRows, payrollSources, readPayrollStatement } from '../../app/lib/payroll/central-read'
import { initializePayrollSchema, payrollRevision } from '../../app/lib/payroll/central-schema'

export interface PayrollIdentitySource {
  version: string
  projects: PayrollProjectOption[]
  crews: { id: string, name: string }[]
  workers: { id: string, name: string, crewId: string | null }[]
}
export interface PayrollServiceOptions {
  session: (sessionId?: string | null) => BusinessSession
  identities: (sessionId?: string | null) => PayrollIdentitySource | Promise<PayrollIdentitySource>
  transaction: <T>(work: (db: TransactionDb, context: BusinessSession) => Promise<T>, sessionId?: string | null) => Promise<T>
}
function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
function authorize(session: BusinessSession) {
  if (!session.capabilities.includes('payroll:read'))
    throw payrollProblem('forbidden', '当前身份没有工资读取权限')
}
async function synchronizeIdentities(db: TransactionDb, source: PayrollIdentitySource) {
  for (const [table, rows] of [['projects', source.projects], ['crews', source.crews], ['workers', source.workers]] as const) {
    const current = new Set(rows.map(row => row.id))
    for (const row of await db.select<{ id: string }>(`SELECT id FROM ${table}`)) {
      if (!current.has(row.id))
        await db.execute(`UPDATE ${table} SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ?`, [new Date().toISOString(), row.id])
    }
  }
  for (const row of source.projects)
    await db.execute('INSERT INTO projects(id,name,code) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,code=excluded.code,deleted_at=NULL', [row.id, row.name, row.code])
  for (const row of source.crews)
    await db.execute('INSERT INTO crews(id,name,trade) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,deleted_at=NULL', [row.id, row.name, ''])
  for (const row of source.workers)
    await db.execute('INSERT INTO workers(id,name,trade,crew_id) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,crew_id=excluded.crew_id,deleted_at=NULL', [row.id, row.name, '', row.crewId])
}
/** P0 只读域：会话、中央身份、工资事实与迁移候选共用工作区串行事务。 */
export function createPayrollService(options: PayrollServiceOptions) {
  async function run<T>(query: PayrollQuery, sessionId: string | null | undefined, read: (db: TransactionDb, context: PayrollContext, source: PayrollIdentitySource) => Promise<T>): Promise<T> {
    if (query.origin !== 'real')
      throw payrollProblem('forbidden', '演示工资只经授权后的隔离只读适配器读取')
    return options.transaction(async (db) => {
      const session = structuredClone(options.session(sessionId))
      authorize(session)
      const source = structuredClone(await options.identities(sessionId))
      await initializePayrollSchema(db)
      await synchronizeIdentities(db, source)
      if (query.projectId && !source.projects.some(project => project.id === query.projectId)) {
        const recorded = await db.select<{ project_id: string }>(`SELECT project_id FROM wage_statements UNION SELECT project_id FROM payroll_subject_configs
          UNION SELECT project_id FROM attendance_records UNION SELECT project_id FROM signed_daywork_records UNION SELECT project_id FROM payroll_migration_evidence`)
        if (!recorded.some(row => row.project_id === query.projectId))
          throw payrollProblem('not-found', '指定工资项目不存在，请从原来源重新核对')
      }
      const context: PayrollContext = { ...session, readonly: true, origin: 'real', sourceVersion: `payroll:${await payrollRevision(db)}+identities:${hash(source)}` }
      const result = await read(db, context, source)
      const latestSource = await options.identities(sessionId)
      if (hash(latestSource) !== hash(source))
        throw payrollProblem('stale-source', '工资所属身份资料已变化，请重新读取')
      const latest = options.session(sessionId)
      authorize(latest)
      if (latest.workspaceId !== session.workspaceId || latest.actorId !== session.actorId || hash([...latest.capabilities].sort()) !== hash([...session.capabilities].sort()))
        throw payrollProblem('forbidden', '读取期间工作区、身份或权限已变化')
      return result
    }, sessionId)
  }
  return {
    list(query: PayrollQuery, sessionId?: string | null): Promise<PayrollListRead> {
      return run(query, sessionId, async (db, context, source) => {
        const graph = await loadPayrollGraph(db)
        const projectIds = new Set([...graph.statements, ...graph.configs, ...graph.attendance, ...graph.daywork].map(row => row.project_id))
        graph.evidence.forEach(e => projectIds.add(e.projectId))
        return { context, rows: payrollListRows(graph, query), projects: source.projects.filter(project => projectIds.has(project.id)), diagnostics: graph.evidence.filter(e => !query.projectId || e.projectId === query.projectId).flatMap(e => e.diagnostics) }
      })
    },
    detail(query: PayrollQuery, id: string, sessionId?: string | null): Promise<PayrollDetailRead> {
      return run(query, sessionId, async (db, context) => {
        const graph = await loadPayrollGraph(db)
        const statement = await readPayrollStatement(db, id, graph)
        if ((query.projectId && statement.projectId !== query.projectId) || (query.month && statement.month !== query.month) || (query.crewId && statement.crewId !== query.crewId))
          throw payrollProblem('relationship-mismatch', '工资单与指定项目、月份或班组范围不一致')
        return { context, statement, history: await loadPayrollHistory(db, graph, statement.projectId, statement.id), evidence: payrollEvidence(graph, statement.projectId) }
      })
    },
    sources(query: PayrollQuery & { projectId: string }, sessionId?: string | null): Promise<PayrollSourcesRead> {
      return run(query, sessionId, async (db, context) => {
        const graph = await loadPayrollGraph(db)
        return { context, ...payrollSources(graph, query), history: await loadPayrollHistory(db, graph, query.projectId), evidence: payrollEvidence(graph, query.projectId) }
      })
    },
  }
}
