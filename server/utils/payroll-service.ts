import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollAQuantityFacts, PayrollAQuantityQuery } from '../../app/lib/payroll/central-a-contract'
import type { PayrollAManagementScopeFacts, PayrollCrewFeeDefaults } from '../../app/lib/payroll/central-a-fees-contract'
import type { PayrollAdjustmentCommand } from '../../app/lib/payroll/central-adjustment-contract'
import type { PayrollAttendanceFacts, PayrollWorkerFact } from '../../app/lib/payroll/central-attendance-contract'
import type { PayrollC2ConfigFacts, PayrollC2ConfigScope } from '../../app/lib/payroll/central-c2-contract'
import type { PayrollContext, PayrollDetailRead, PayrollListRead, PayrollProjectOption, PayrollQuery, PayrollSourcesRead } from '../../app/lib/payroll/central-contract'
import type { PayrollDayworkFacts, PayrollDayworkRecordFacts } from '../../app/lib/payroll/central-daywork-contract'
import type { PayrollHollowProjectionProvider } from '../../app/lib/payroll/central-hollow-deduction-projection'
import type { PayrollReleaseAdjustmentPreview } from '../../app/lib/payroll/central-release-adjustment-contract'
import type { QuantityHollowFacts, QuantityHollowFactsQuery } from '../../app/lib/quantity/central-hollow-contract'
import type { BusinessSession } from './business-session'
import { createHash } from 'node:crypto'
import { initializePayrollAFeesSchema } from '../../app/lib/payroll/central-a-fees-schema'
import { initializePayrollARoundingSchema } from '../../app/lib/payroll/central-a-rounding-schema'
import { assertPayrollActualCommand } from '../../app/lib/payroll/central-actual-validation'
import { assertPayrollAdjustmentCommand } from '../../app/lib/payroll/central-adjustment-validation'
import { initializePayrollBatchSchema } from '../../app/lib/payroll/central-batch-schema'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { loadPayrollHistory } from '../../app/lib/payroll/central-history'
import { initializePayrollHollowDeductionSchema } from '../../app/lib/payroll/central-hollow-deduction-schema'
import { loadPayrollGraph, payrollEvidence, payrollListRows, payrollSources, readPayrollStatement } from '../../app/lib/payroll/central-read'
import { assertPayrollReversalCommand } from '../../app/lib/payroll/central-reversal-validation'
import { initializePayrollSchema, payrollRevision } from '../../app/lib/payroll/central-schema'
import { resolvePayrollABook } from './payroll-a-book'
import { createPayrollARoundingService } from './payroll-a-rounding-service'
import { createPayrollAService } from './payroll-a-service'
import { createPayrollActualService } from './payroll-actual-service'
import { createPayrollAdjustmentService } from './payroll-adjustment-service'
import { createPayrollAttendanceService } from './payroll-attendance-service'
import { createPayrollBatchService } from './payroll-batch-service'
import { createPayrollC1Service } from './payroll-c1-service'
import { createPayrollC2Service } from './payroll-c2-service'
import { createPayrollDayworkService } from './payroll-daywork-service'
import { createPayrollHollowService } from './payroll-hollow-service'
import { createPayrollNumberingService } from './payroll-numbering-service'
import { readPayrollReleaseAdjustments } from './payroll-release-adjustments'
import { createPayrollReversalService } from './payroll-reversal-service'

export interface PayrollIdentitySource {
  version: string
  projects: PayrollProjectOption[]
  crews: { id: string, name: string, defaultPayRatio?: number | null, ratioExplicitlyConfigured?: boolean, feeDefaults?: PayrollCrewFeeDefaults }[]
  workers: ({ id: string, name: string, crewId: string | null } & Partial<Omit<PayrollWorkerFact, 'workerId' | 'crewId'>>)[]
}
export interface PayrollServiceOptions {
  session: (sessionId?: string | null) => BusinessSession
  identities: (sessionId?: string | null) => PayrollIdentitySource | Promise<PayrollIdentitySource>
  transaction: <T>(work: (db: TransactionDb, context: BusinessSession) => Promise<T>, sessionId?: string | null, command?: object) => Promise<T>
  schemaInitialized?: boolean
  quantityFacts?: (db: TransactionDb, query: PayrollAQuantityQuery) => Promise<PayrollAQuantityFacts>
  hollowFacts?: (db: TransactionDb, query: QuantityHollowFactsQuery) => Promise<QuantityHollowFacts>
  hollowProjection?: PayrollHollowProjectionProvider
  managementScopeFacts?: (db: TransactionDb, query: { projectId: string }, context: PayrollContext) => Promise<PayrollAManagementScopeFacts>
  attendanceFacts?: (db: TransactionDb, query: { projectId: string, month: string }) => Promise<PayrollAttendanceFacts>
  dayworkFacts?: (db: TransactionDb, query: { projectId: string, month: string }) => Promise<PayrollDayworkFacts>
  dayworkRecord?: (db: TransactionDb, recordId: string) => Promise<PayrollDayworkRecordFacts>
  c2ConfigFacts?: (db: TransactionDb, scope: PayrollC2ConfigScope) => Promise<PayrollC2ConfigFacts>
}
export type PayrollRun = <T>(query: PayrollQuery, sessionId: string | null | undefined, read: (db: TransactionDb, context: PayrollContext, source: PayrollIdentitySource) => Promise<T>, write?: boolean, command?: object) => Promise<T>
function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
function authorize(session: BusinessSession, write = false) {
  if (!session.capabilities.includes('payroll:read'))
    throw payrollProblem('forbidden', '当前身份没有工资读取权限')
  if (write && !session.capabilities.includes('payroll:write'))
    throw payrollProblem('forbidden', '当前身份没有工资写入权限')
}
function publicPayrollResult<T>(result: T, actor: BusinessSession, enforceDirectory: boolean): T {
  const sensitive = actor.capabilities.includes('worker:sensitive:read')
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value))
      return value.map(visit)
    if (!value || typeof value !== 'object')
      return value
    const record = value as Record<string, unknown>
    const next = Object.fromEntries(Object.entries(record).map(([key, child]) => [key, visit(child)]))
    if (enforceDirectory && record.options && typeof record.options === 'object') {
      const options = next.options as Record<string, unknown>
      const availability: Record<string, string> = {}
      for (const [field, capability] of [['projects', 'project:list:read'], ['crews', 'crew:list:read'], ['workers', 'worker:list:read']]) {
        if (!Array.isArray(options[field!]))
          continue
        availability[field!] = actor.capabilities.includes(capability!) ? 'readable' : 'forbidden'
        if (!actor.capabilities.includes(capability!))
          options[field!] = []
      }
      options.availability = availability
      if (Array.isArray(record.workers) && Array.isArray(record.records) && !actor.capabilities.includes('worker:list:read')) {
        availability.workers = 'forbidden'
        const related = new Set((record.records as Array<{ workerId: string }>).map(row => row.workerId))
        next.workers = (next.workers as Array<Record<string, unknown>>).filter(worker => related.has(String(worker.id))).map(worker => ({ ...worker, name: null, eligible: false, historical: true, source: null, reasons: ['当前人员目录受限；原考勤事实和身份仍保留'] }))
        if (next.context && typeof next.context === 'object')
          (next.context as Record<string, unknown>).readonly = true
      }
    }
    if (!sensitive && record.entityId && record.source && typeof record.source === 'object') {
      const source = structuredClone(record.source) as Record<string, unknown>
      const publication = source.publication as { schemaVersion: unknown, tables?: Record<string, unknown>, origins?: unknown[] } | undefined
      if (publication) {
        source.publication = { schemaVersion: publication.schemaVersion, privateRosterState: 'forbidden', reason: '固定实名名册正文须从原版本入口另行核验工人私密资料权限', tables: Object.fromEntries(Object.entries(publication.tables ?? {}).map(([table, rows]) => [table, table.startsWith('worker_roster_') ? { state: 'forbidden' } : rows])), origins: publication.origins?.map((origin) => {
          const row = origin as Record<string, unknown>
          return row.tableName === 'worker_roster_archives' ? { tableName: row.tableName, recordId: row.recordId, proofHash: row.proofHash, state: 'forbidden' } : row
        }) }
      }
      const deductions = source.deductions as Record<string, unknown> | undefined
      if (deductions?.proof)
        deductions.proof = { state: 'forbidden', reason: '完整祖先来源包包含固定私密原资料，普通工资读取只消费服务器已核实的采用证明' }
      if (Array.isArray(source.logs)) {
        source.logs = source.logs.map((log) => {
          const row = log as Record<string, unknown>
          return String(row.table_name).startsWith('worker_roster_') ? { ...row, before_data: null, after_data: null, privateState: 'forbidden' } : row
        })
      }
      next.source = source
    }
    return next
  }
  return visit(result) as T
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
  for (const row of source.workers) {
    await db.execute('INSERT INTO workers(id,name,trade,crew_id) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,crew_id=excluded.crew_id,deleted_at=NULL', [row.id, row.name, '', row.crewId])
    if ('dailyWageState' in row || 'currentProjectId' in row)
      await db.execute('UPDATE workers SET daily_wage=?,current_project_id=? WHERE id=?', [row.dailyWageState === 'value' ? row.dailyWage ?? null : null, source.projects.some(p => p.id === row.currentProjectId) ? row.currentProjectId : null, row.id])
  }
}
/** P0 只读域：会话、中央身份、工资事实与迁移候选共用工作区串行事务。 */
export function createPayrollService(options: PayrollServiceOptions) {
  async function run<T>(query: PayrollQuery, sessionId: string | null | undefined, read: (db: TransactionDb, context: PayrollContext, source: PayrollIdentitySource) => Promise<T>, write = false, command?: object): Promise<T> {
    if (query.origin !== 'real')
      throw payrollProblem('forbidden', '演示工资只经授权后的隔离只读适配器读取')
    return options.transaction(async (db) => {
      const session = structuredClone(options.session(sessionId))
      authorize(session, write)
      const source = structuredClone(await options.identities(sessionId))
      if (!options.schemaInitialized) {
        await initializePayrollSchema(db)
        await initializePayrollAFeesSchema(db)
        await initializePayrollARoundingSchema(db)
        await initializePayrollBatchSchema(db)
        if (options.hollowFacts)
          await initializePayrollHollowDeductionSchema(db)
        await synchronizeIdentities(db, source)
      }
      if (query.projectId && !source.projects.some(project => project.id === query.projectId)) {
        const recorded = await db.select<{ project_id: string }>(`SELECT project_id FROM wage_statements UNION SELECT project_id FROM payroll_subject_configs
          UNION SELECT project_id FROM attendance_records UNION SELECT project_id FROM signed_daywork_records UNION SELECT project_id FROM payroll_migration_evidence`)
        if (!recorded.some(row => row.project_id === query.projectId))
          throw payrollProblem('not-found', '指定工资项目不存在，请从原来源重新核对')
      }
      const context: PayrollContext = { ...session, readonly: true, origin: 'real', sourceVersion: options.schemaInitialized ? 'payroll-consumption-v1' : `payroll:${await payrollRevision(db)}+identities:${hash(source)}` }
      const result = await read(db, context, source)
      const latestSource = await options.identities(sessionId)
      if (hash(latestSource) !== hash(source))
        throw payrollProblem('stale-source', '工资所属身份资料已变化，请重新读取')
      const latest = options.session(sessionId)
      authorize(latest, write)
      if (latest.workspaceId !== session.workspaceId || latest.actorId !== session.actorId || hash([...latest.capabilities].sort()) !== hash([...session.capabilities].sort()))
        throw payrollProblem('forbidden', '读取期间工作区、身份或权限已变化')
      return publicPayrollResult(result, session, options.schemaInitialized === true)
    }, sessionId, command)
  }
  const adjustments = createPayrollAdjustmentService(run)
  const { aFormInTransaction, ...aService } = createPayrollAService(run, options)
  const { c1FormInTransaction, ...c1Service } = createPayrollC1Service(run, options)
  const { c2FormInTransaction, ...c2Service } = createPayrollC2Service(run, options)
  const { executeActual, ...actualReads } = createPayrollActualService(run)
  const { executeReversal, ...reversalReads } = createPayrollReversalService(run)
  const { aRoundingInTransaction, ...aRoundingService } = createPayrollARoundingService(run)
  const batchService = createPayrollBatchService(
    run,
    { A: aFormInTransaction, C1: c1FormInTransaction, C2: c2FormInTransaction, rounding: aRoundingInTransaction },
    { A: aService.execute, C1: c1Service.executeC1, C2: c2Service.executeC2 },
  )
  return {
    ...createPayrollNumberingService(run),
    ...aService,
    ...aRoundingService,
    ...batchService,
    ...createPayrollHollowService(run, {
      A: async (db, context, source, statementId) => (await aFormInTransaction(db, context, source, { statementId })).hollow,
      C1: async (db, context, source, statementId) => (await c1FormInTransaction(db, context, source, { statementId })).hollow,
      C2: async (db, context, source, statementId) => (await c2FormInTransaction(db, context, source, { statementId })).hollow,
    }, options.hollowProjection),
    ...adjustments,
    ...actualReads,
    ...reversalReads,
    releaseAdjustmentPreview(query: PayrollQuery, input: { statementId: string }, sessionId?: string | null): Promise<PayrollReleaseAdjustmentPreview> {
      return run(query, sessionId, async (db, context, source) => {
        const [head] = await db.select<{ format_family: string }>('SELECT format_family FROM wage_statements WHERE id=?', [input.statementId])
        const a = head?.format_family === 'A' ? await aFormInTransaction(db, context, source, { statementId: input.statementId }) : null
        const preview = await readPayrollReleaseAdjustments(db, input.statementId, a?.adjustmentReconciliation, a?.hollow)
        if (query.projectId && query.projectId !== preview.statement.project_id)
          throw payrollProblem('relationship-mismatch', '后续工资不属于指定项目')
        return { context: { ...context, readonly: !context.capabilities.includes('payroll:write'), sourceVersion: `${context.sourceVersion}+release-adjustments:${hash(preview)}` }, statementId: input.statementId, candidates: preview.candidates, reasons: preview.reasons }
      })
    },
    executeAdjustment(command: PayrollAdjustmentCommand, sessionId?: string | null) {
      if (command.action?.kind === 'confirm-recording-reversal') {
        assertPayrollReversalCommand(command)
        return executeReversal(command, sessionId)
      }
      if (command.action?.kind === 'confirm-actual-payment') {
        assertPayrollActualCommand(command)
        return executeActual(command, sessionId)
      }
      assertPayrollAdjustmentCommand(command)
      return adjustments.executeAdjustment(command, sessionId)
    },
    ...createPayrollAttendanceService(run, options),
    ...c1Service,
    ...c2Service,
    ...createPayrollDayworkService(run, options),
    list(query: PayrollQuery, sessionId?: string | null): Promise<PayrollListRead> {
      return run(query, sessionId, async (db, context, source) => {
        const graph = await loadPayrollGraph(db)
        const projectIds = new Set([...graph.statements, ...graph.configs, ...graph.attendance, ...graph.daywork].map(row => row.project_id))
        graph.evidence.forEach(e => projectIds.add(e.projectId))
        const rows = payrollListRows(graph, query)
        const explicitBooks = new Set((await db.select<{ statement_id: string }>('SELECT statement_id FROM payroll_a_statement_books')).map(b => b.statement_id))
        for (const row of rows) {
          if (!explicitBooks.has(row.id))
            continue
          const proof = await resolvePayrollABook(db, row.id)
          if (proof.state === 'proven')
            row.book = proof.book
        }
        return { context, rows, projects: source.projects.filter(project => projectIds.has(project.id)), diagnostics: graph.evidence.filter(e => !query.projectId || e.projectId === query.projectId).flatMap(e => e.diagnostics) }
      })
    },
    detail(query: PayrollQuery, id: string, sessionId?: string | null): Promise<PayrollDetailRead> {
      return run(query, sessionId, async (db, context) => {
        const graph = await loadPayrollGraph(db)
        const statement = await readPayrollStatement(db, id, graph)
        if ((await db.select('SELECT statement_id FROM payroll_a_statement_books WHERE statement_id=?', [id])).length) {
          const proof = await resolvePayrollABook(db, id)
          if (proof.state === 'proven')
            statement.book = proof.book
        }
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
