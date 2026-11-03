import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { WorkerRosterScope } from '../../app/lib/worker-roster/contract'
import type { BusinessSession } from './business-session'
import type { ProjectRow } from './production-project-record'
import type { ProductionStorage } from './production-storage'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { buildCrewDetailRead, buildCrewListPage, buildWorkerDetailRead, buildWorkerListPage, parseCrewDetailQuery, parseCrewListQuery, parseWorkerDetailQuery, parseWorkerListQuery } from '../../app/lib/crew-worker/read-page'
import { parseCrewExcelImport, parseCrewExcelPreview } from './crew-excel-import-request'
import { parseCrewCommandRequest, parseWorkerCommandRequest } from './crew-worker-command-request'
import { createCrewWorkerCommandService } from './crew-worker-command-service'
import { loadPayrollHostSection } from './crew-worker-payroll-read'
import { productionCrewWorkerFailure as fail, loadProductionCrewWorkers, saveProductionCrewWorkers } from './production-crew-worker-record'
import { productionPayrollStatements } from './production-payroll-service'
import { projectDraft } from './production-project-record'
import { productionWorkerOriginals } from './production-worker-originals'
import { createReadMeta, readQueryScope, readSourceVersion, withOriginReadMeta, withReadMeta } from './read-meta'
import { parseWorkerExcelImport, parseWorkerExcelPreview } from './worker-excel-import-request'
import { createWorkerRosterService } from './worker-roster-service'

type Session = () => BusinessSession
type Domain = ReturnType<typeof createCrewWorkerCommandService>
export function createProductionCrewWorkerService(storage: ProductionStorage, options: { now?: () => string } = {}) {
  const now = options.now ?? (() => new Date().toISOString())
  function authorize(session: Session, write = false, capability?: string) {
    const actor = session()
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId || !actor.capabilities.includes('crew:list:read') || !actor.capabilities.includes('worker:list:read') || (write && capability && !actor.capabilities.includes(capability)))
      fail('forbidden', '当前身份无此正式工作区的班组工人权限。')
    return structuredClone(actor)
  }
  async function run<T>(session: Session, write: boolean, capability: string | undefined, work: (tx: TransactionDb, domain: Domain, actor: BusinessSession, timestamp: string) => Promise<T> | T): Promise<T> {
    const actor = authorize(session, write, capability)
    if (write)
      storage.assertBusinessWrite()
    return storage.withTransaction(async (tx) => {
      const initial = await loadProductionCrewWorkers(tx, actor)
      const timestamp = now()
      const projects = actor.capabilities.includes('project:list:read') ? await tx.select<{ id: string, name: string, version: number }>('SELECT id,name,version FROM projects WHERE deleted_at IS NULL') : []
      const domain = createCrewWorkerCommandService({ initialState: initial, now: () => timestamp, projectIds: () => projects.map(row => row.id), projectReferences: () => projects.map(row => ({ id: row.id, name: row.name, version: String(row.version) })) })
      const result = await work(tx, domain, actor, timestamp)
      const after = domain.snapshot()
      if (!isDeepStrictEqual(initial, after)) {
        if (!write)
          fail('unavailable', '只读目录投影意外改变了持久事实。')
        storage.assertBusinessWrite()
        await saveProductionCrewWorkers(tx, after, initial, actor, timestamp)
      }
      if (!isDeepStrictEqual(authorize(session, write, capability), actor))
        fail('forbidden', '操作期间身份、工作区或权限变化，本次操作已撤回。')
      return result
    })
  }
  async function context(tx: TransactionDb, domain: Domain, actor: BusinessSession) {
    const available = actor.capabilities.includes('project:list:read')
    const physical = available ? await tx.select<ProjectRow>('SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY id') : []
    const workers = domain.workerRows()
    const projects = available ? physical.map(row => ({ id: row.id, name: row.name, code: row.code, status: projectDraft(row).status ?? '', version: String(row.version), dataOrigin: 'real' as const, permission: 'allowed' as const })) : [...new Set(workers.flatMap(row => row.currentProjectId ? [row.currentProjectId] : []))].map(id => ({ id, name: '', code: '', status: '', dataOrigin: 'real' as const, permission: 'forbidden' as const }))
    return { crews: domain.crewRows(), workers, projects, assignments: [], wages: [], penalties: [], sourceVersion: `${domain.sourceVersion()}:${readSourceVersion('production-worker-projects', projects)}`, capabilities: [...actor.capabilities] }
  }
  function metadata(actor: BusinessSession, domain: Domain, timestamp: string, operation: string, origin: 'real' | 'demo', query: object, projectVersion: string) {
    const coverage = origin === 'demo' || operation === 'crew:list' || operation === 'worker:list' ? 'complete' : 'unknown'
    return createReadMeta({ session: actor, schemaVersion: 'crew-worker-read-v2', operation, dataOrigin: origin, asOf: timestamp, coverage, scope: readQueryScope(query), sources: [
      ...['crews', 'workers'].map(key => ({ key, state: origin === 'real' ? 'readable' as const : 'not-requested' as const, sourceVersion: origin === 'real' ? domain.sourceVersion() : null, asOf: origin === 'real' ? timestamp : null })),
      { key: 'projects', state: origin === 'demo' ? 'not-requested' : actor.capabilities.includes('project:list:read') ? 'readable' : 'forbidden', sourceVersion: origin === 'real' && actor.capabilities.includes('project:list:read') ? projectVersion : null, asOf: origin === 'real' && actor.capabilities.includes('project:list:read') ? timestamp : null },
      ...['assignments', 'wages', 'penalties'].map(key => ({ key, state: 'unavailable' as const, sourceVersion: null, asOf: null })),
    ] })
  }
  function real(query: { includeDemo: boolean, origin?: string }) {
    if (query.includeDemo || (query.origin && query.origin !== 'real'))
      fail('forbidden', '正式全局目录不接纳开发或演示来源。')
  }
  function request(kind: 'crew' | 'worker', raw: unknown, id?: string) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !['id', 'workspaceId', 'actorId', 'requiredCapability', 'commandId', 'baseVersion', 'action', 'draft', 'attachments'].includes(key)))
      fail('validation-failed', '正式目录命令包含无效或未知字段。')
    return kind === 'crew' ? parseCrewCommandRequest(raw, id) : parseWorkerCommandRequest(raw, id)
  }
  function roster(tx: TransactionDb, domain: Domain, actor: BusinessSession, session: Session, timestamp: string) {
    return createWorkerRosterService({
      session,
      now: () => timestamp,
      schemaInitialized: true,
      originals: productionWorkerOriginals,
      source: async () => {
        const current = createCrewWorkerCommandService({ initialState: await loadProductionCrewWorkers(tx, actor) })
        return { workers: current.workerRows(), projects: actor.capabilities.includes('project:list:read') ? await tx.select<{ id: string, name: string }>('SELECT id,name FROM projects WHERE deleted_at IS NULL ORDER BY id') : [] }
      },
      transaction: work => work(tx),
      statements: (db: TransactionDb, scope: WorkerRosterScope) => productionPayrollStatements(db, scope),
      audit: async (db, input) => {
        const entityId = input.result.workerId ?? input.result.archiveId!
        const [profile] = input.result.workerId ? await db.select<{ values_json: string }>('SELECT values_json FROM worker_roster_profile_versions WHERE worker_id=? AND revision=?', [input.result.workerId, input.result.revision]) : []
        const after = { action: input.command.action, originalSourceVersion: input.command.sourceVersion, result: input.result, profileValues: profile ? JSON.parse(profile.values_json) : null, originals: input.result.workerId ? await productionWorkerOriginals.assets(db, input.result.workerId) : [] }
        await db.execute('INSERT INTO crew_worker_audits(id,kind,entity_id,actor_id,command_id,before_json,after_json,created_at) VALUES (?,\'worker\',?,?,?,NULL,?,?)', [`roster-audit-${randomUUID()}`, entityId, input.actor.actorId, input.command.commandId, JSON.stringify(after), input.timestamp])
      },
    })
  }
  return {
    previewCrewExcel(raw: unknown, session: Session) {
      const drafts = parseCrewExcelPreview(raw)
      return run(session, false, undefined, (_tx, domain, actor) => ({ workspaceId: actor.workspaceId, actorId: actor.actorId, capabilities: [...actor.capabilities], previews: domain.previewCrewExcel(drafts, actor) }))
    },
    importCrewExcel(raw: unknown, session: Session) {
      const command = parseCrewExcelImport(raw)
      return run(session, true, 'crew:write', (_tx, domain, actor) => domain.importCrewExcel(command, actor))
    },
    previewWorkerExcel(raw: unknown, session: Session) {
      const drafts = parseWorkerExcelPreview(raw)
      return run(session, false, undefined, (_tx, domain, actor) => ({ workspaceId: actor.workspaceId, actorId: actor.actorId, capabilities: [...actor.capabilities], previews: domain.previewWorkerExcel(drafts, actor) }))
    },
    importWorkerExcel(raw: unknown, session: Session) {
      const command = parseWorkerExcelImport(raw)
      return run(session, true, 'worker:write', (_tx, domain, actor) => domain.importWorkerExcel(command, actor))
    },
    executeCrew(raw: unknown, session: Session, id?: string) {
      const command = request('crew', raw, id) as ReturnType<typeof parseCrewCommandRequest>
      return run(session, true, 'crew:write', (_tx, domain, actor) => domain.executeCrew(command, actor))
    },
    executeWorker(raw: unknown, session: Session, id?: string) {
      const command = request('worker', raw, id) as ReturnType<typeof parseWorkerCommandRequest>
      return run(session, true, 'worker:write', (_tx, domain, actor) => domain.executeWorker(command, actor))
    },
    resolve(kind: 'crew' | 'worker', commandId: string, session: Session) { return run(session, true, `${kind}:write`, (_tx, domain, actor) => domain.resolve(kind, commandId, actor)) },
    crewForm(id: string, session: Session) { return run(session, false, undefined, (_tx, domain, actor) => domain.crewForm(id, actor)) },
    workerForm(id: string, session: Session) { return run(session, false, undefined, (_tx, domain, actor) => domain.workerForm(id, actor)) },
    listCrews(input: Record<string, unknown>, session: Session) {
      const query = parseCrewListQuery(input)
      real(query)
      return run(session, false, undefined, async (tx, domain, actor, timestamp) => {
        const source = await context(tx, domain, actor)
        const projection = buildCrewListPage({ ...source, query, asOf: timestamp })
        projection.items = projection.items.map(item => ({ ...item, projectCount: null }))
        return withOriginReadMeta(projection, { real: metadata(actor, domain, timestamp, 'crew:list', 'real', query, readSourceVersion('projects', source.projects)), demo: metadata(actor, domain, timestamp, 'crew:list', 'demo', query, readSourceVersion('projects', source.projects)) })
      })
    },
    listWorkers(input: Record<string, unknown>, session: Session) {
      const query = parseWorkerListQuery(input)
      real(query)
      return run(session, false, undefined, async (tx, domain, actor, timestamp) => {
        const source = await context(tx, domain, actor)
        const projection = buildWorkerListPage({ ...source, query, asOf: timestamp })
        return withOriginReadMeta(projection, { real: metadata(actor, domain, timestamp, 'worker:list', 'real', query, readSourceVersion('projects', source.projects)), demo: metadata(actor, domain, timestamp, 'worker:list', 'demo', query, readSourceVersion('projects', source.projects)) })
      })
    },
    crewDetail(id: string, input: Record<string, unknown>, session: Session) {
      const query = parseCrewDetailQuery(id, input)
      real(query)
      return run(session, false, undefined, async (tx, domain, actor, timestamp) => {
        const source = await context(tx, domain, actor)
        const projection = buildCrewDetailRead({ ...source, query, asOf: timestamp })
        projection.summary = { ...projection.summary, projectCount: null, assignedUnitCount: null, completedStageCount: null, wageStatementCount: null, releasedWageAmount: null, penaltyAmount: null }
        projection.projects = projection.projects.map(project => ({ ...project, assignmentCount: null, assignedUnitCount: null, completedStageCount: null, wageStatementCount: null, wageGrossAmount: null, releasedWageAmount: null }))
        return withReadMeta({ ...projection, payrollActual: await loadPayrollHostSection(tx, { kind: 'crew', id }, actor) }, metadata(actor, domain, timestamp, 'crew:detail', 'real', query, readSourceVersion('projects', source.projects)))
      })
    },
    workerDetail(id: string, input: Record<string, unknown>, session: Session) {
      const query = parseWorkerDetailQuery(id, input)
      real(query)
      return run(session, false, undefined, async (tx, domain, actor, timestamp) => {
        const source = await context(tx, domain, actor)
        const projection = buildWorkerDetailRead({ ...source, query, asOf: timestamp })
        projection.summary = Object.fromEntries(Object.keys(projection.summary).map(key => [key, null])) as typeof projection.summary
        return withReadMeta({ ...projection, payrollActual: await loadPayrollHostSection(tx, { kind: 'worker', id }, actor) }, metadata(actor, domain, timestamp, 'worker:detail', 'real', query, readSourceVersion('projects', source.projects)))
      })
    },
    relationFact() { return fail('unavailable', '正式工程量、工资或扣罚关系 owner 尚未接通。') },
    profile(workerId: string, session: Session) { return run(session, false, undefined, (tx, domain, actor, timestamp) => roster(tx, domain, actor, session, timestamp).profile(workerId)) },
    rosterFile(input: Parameters<ReturnType<typeof createWorkerRosterService>['file']>[0], session: Session) { return run(session, false, undefined, (tx, domain, actor, timestamp) => roster(tx, domain, actor, session, timestamp).file(input)) },
    rosterArchives(projectId: string, session: Session) { return run(session, false, undefined, (tx, domain, actor, timestamp) => roster(tx, domain, actor, session, timestamp).archives(projectId)) },
    rosterArchive(projectId: string, id: string, session: Session) { return run(session, false, undefined, (tx, domain, actor, timestamp) => roster(tx, domain, actor, session, timestamp).archive(projectId, id)) },
    rosterPreview(scope: WorkerRosterScope, session: Session) { return run(session, false, undefined, (tx, domain, actor, timestamp) => roster(tx, domain, actor, session, timestamp).preview(scope)) },
    executeRoster(raw: unknown, session: Session) { return run(session, true, 'worker:write', (tx, domain, actor, timestamp) => roster(tx, domain, actor, session, timestamp).execute(raw)) },
    resolveRoster(id: string, action: 'save-profile' | 'archive', session: Session) { return run(session, true, 'worker:write', (tx, domain, actor, timestamp) => roster(tx, domain, actor, session, timestamp).resolve(id, action)) },
  }
}
