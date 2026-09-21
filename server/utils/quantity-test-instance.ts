import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type { QuantityBoqWorkspace } from '../../app/lib/quantity/central-boq'
import type { QuantityBatchReadQuery, QuantityCommand, QuantityContext, QuantityReadQuery, QuantityUnitReadQuery } from '../../app/lib/quantity/central-contract'
import type { QuantityMonthlyBoqFact, QuantityMonthlyReadQuery } from '../../app/lib/quantity/central-monthly'
import type { QuantityPersonSource } from '../../app/lib/quantity/central-people'
import type { QuantityPhotoIdentity } from '../../app/lib/quantity/central-photo'
import type { PreparedCoreMigration } from './core-migration-preparation'
import type { ImportedPayrollProject } from './payroll-migration'
import type { ImportedQuantityProject } from './quantity-migration'
import type { ImportedBudgetVersion } from './target-cost-migration'
import type { ImportedWbsProject } from './wbs-migration'
import { createDbCoordinator } from '../../app/lib/db/coordinator'
import { createQuantityService } from '../../app/lib/quantity/central-service'
import { applyPayrollMigration, assertPayrollMigrationRemoval, planPayrollMigration } from './payroll-migration'
import { createQuantityDatabase } from './quantity-database'
import { assertQuantityHollowMigrationReferences } from './quantity-hollow-migration'
import { applyQuantityMigration, planQuantityMigration } from './quantity-migration'
import { applyBudgetMigration, planBudgetMigration } from './target-cost-migration'
import { applyWbsMigration, planWbsMigration, removeWbsMigration } from './wbs-migration'

interface QuantityProjectSource {
  id: string
  name: string
  code: string
  dataOrigin: 'real' | 'demo'
}

interface Options {
  session: (sessionId?: string | null) => QuantityContext
  projects: (sessionId?: string | null) => readonly QuantityProjectSource[] | Promise<readonly QuantityProjectSource[]>
  people?: (sessionId?: string | null) => readonly QuantityPersonSource[] | Promise<readonly QuantityPersonSource[]>
  boq?: (projectId: string, sessionId?: string | null) => (QuantityBoqWorkspace & { sourceVersion: string }) | Promise<QuantityBoqWorkspace & { sourceVersion: string }>
}

/** 共用事务队列的来源域将此错误翻译成自身的权限/身份问题。 */
export class WorkspaceTransactionSessionChanged extends Error {
  constructor() {
    super('工作区、经办身份或权限已变化，请重新核对')
    this.name = 'WorkspaceTransactionSessionChanged'
  }
}

function sameWorkspaceSession(expected: QuantityContext, actual: QuantityContext) {
  if (expected.workspaceId !== actual.workspaceId || expected.actorId !== actual.actorId
    || JSON.stringify([...expected.capabilities].sort()) !== JSON.stringify([...actual.capabilities].sort())) {
    throw new WorkspaceTransactionSessionChanged()
  }
}

/** 可重置中央验证实例。SQL 状态位于服务端内存，不代表生产持久化已交付。 */
export function createQuantityTestInstance(options: Options) {
  interface State {
    sessionId: string
    database: ReturnType<typeof createDbCoordinator>
    driver: () => ReturnType<typeof createQuantityDatabase>
    service: ReturnType<typeof createQuantityService>
    pending: Promise<void>
    imports: Map<string, ImportedQuantityProject>
    wbsImports: Map<string, ImportedWbsProject>
    budgetImports: Map<string, ImportedBudgetVersion>
    payrollImports: Map<string, ImportedPayrollProject>
    migrationPeople: { crews: Set<string>, workers: Set<string> }
    migrationProjectIds: Set<string>
    migrationLibraryIds: Set<string>
  }
  const states = new Map<string, State>()

  function stateFor(sessionId: string | null | undefined, context: QuantityContext): State {
    const id = sessionId || 'default'
    const key = JSON.stringify([id, context.workspaceId])
    let state = states.get(key)
    if (!state) {
      let loading: ReturnType<typeof createQuantityDatabase> | null = null
      const load = () => {
        loading ??= createQuantityDatabase().catch((cause) => {
          loading = null
          throw cause
        })
        return loading
      }
      const database = createDbCoordinator(load)
      state = {
        sessionId: id,
        database,
        driver: load,
        service: createQuantityService({
          workspaceId: context.workspaceId,
          database,
          project: async (projectId) => {
            const rows = await options.projects(sessionId)
            return rows.find(row => row.id === projectId && row.dataOrigin === 'real') ?? null
          },
          projects: async () => structuredClone((await options.projects(sessionId)).filter(row => row.dataOrigin === 'real')),
          people: options.people ? async () => structuredClone(await options.people!(sessionId)) : undefined,
          boq: options.boq ? async id => structuredClone(await options.boq!(id, sessionId)) : undefined,
        }),
        pending: Promise.resolve(),
        imports: new Map(),
        wbsImports: new Map(),
        budgetImports: new Map(),
        payrollImports: new Map(),
        migrationPeople: { crews: new Set(), workers: new Set() },
        migrationProjectIds: new Set(),
        migrationLibraryIds: new Set(),
      }
      states.set(key, state)
    }
    return state
  }

  function run<T>(sessionId: string | null | undefined, work: (service: State['service'], context: QuantityContext) => Promise<T>) {
    const context = options.session(sessionId)
    const state = stateFor(sessionId, context)
    const pending = state.pending.then(() => work(state.service, options.session(sessionId)))
    state.pending = pending.then(() => undefined, () => undefined)
    return pending
  }

  async function closeMatching(match: (state: State) => boolean) {
    const closing: State[] = []
    for (const [key, state] of states) {
      if (match(state)) {
        states.delete(key)
        closing.push(state)
      }
    }
    await Promise.all(closing.map(async (state) => {
      await state.pending
      await state.database.close()
    }))
  }

  return {
    /** 真实 SQLite 原件，沿同工作区队列读取；不得在事务回调内再次调用。 */
    exportSnapshotBytes(sessionId?: string | null): Promise<Uint8Array> {
      const scheduled = structuredClone(options.session(sessionId))
      const state = stateFor(sessionId, scheduled)
      const pending = state.pending.then(async () => {
        sameWorkspaceSession(scheduled, options.session(sessionId))
        const driver = await state.driver()
        sameWorkspaceSession(scheduled, options.session(sessionId))
        const bytes = driver.exportSnapshotBytes()
        sameWorkspaceSession(scheduled, options.session(sessionId))
        return bytes
      })
      state.pending = pending.then(() => undefined, () => undefined)
      return pending
    },
    /** 仅提供工作区互斥与 SQL 原子性。领域在回调内验证自身能力、来源和项目版本；不得嵌套调用同队列。 */
    withWorkspaceTransaction<T>(consume: (db: TransactionDb, context: QuantityContext) => Promise<T>, sessionId?: string | null): Promise<T> {
      const scheduled = structuredClone(options.session(sessionId))
      const state = stateFor(sessionId, scheduled)
      const pending = state.pending.then(async () => {
        const context = structuredClone(options.session(sessionId))
        sameWorkspaceSession(scheduled, context)
        return state.database.withTransaction(async (db) => {
          const result = await consume(db, context)
          sameWorkspaceSession(context, options.session(sessionId))
          return result
        })
      })
      state.pending = pending.then(() => undefined, () => undefined)
      return pending
    },
    async prepareMigrationSnapshot(snapshot: CoreMigrationSnapshotDTO, sessionId?: string | null): Promise<PreparedCoreMigration> {
      const scope = structuredClone(snapshot)
      const state = stateFor(sessionId, options.session(sessionId))
      const previous = state.pending
      let release!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      state.pending = previous.then(() => held)
      await previous
      try {
        const plan = planQuantityMigration(scope, state.imports)
        const wbs = planWbsMigration(scope, state.wbsImports)
        const budget = planBudgetMigration(scope, state.budgetImports)
        const payroll = planPayrollMigration(scope, state.payrollImports, [...plan.incoming.flatMap(row => row.identities.map(identity => ({ ...identity, projectId: row.project.id }))), ...[...plan.imports.values()].flatMap(row => row.identities.map(identity => ({ ...identity, projectId: row.projectId })))])
        const migrationPeople = {
          crews: new Set(scope.authority === 'central' ? scope.entities.filter(row => row.entityType === 'crews').map(row => row.id) : []),
          workers: new Set(scope.authority === 'central' ? scope.entities.filter(row => row.entityType === 'workers').map(row => row.id) : []),
        }
        const removedPeople = {
          crews: new Set([...state.migrationPeople.crews].filter(id => !migrationPeople.crews.has(id))),
          workers: new Set([...state.migrationPeople.workers].filter(id => !migrationPeople.workers.has(id))),
        }
        const migrationProjectIds = new Set(scope.authority === 'central' ? scope.entities.filter(row => row.entityType === 'projects').map(row => row.id) : [])
        const removedProjectIds = new Set([...state.migrationProjectIds].filter(id => !migrationProjectIds.has(id)))
        const migrationLibraryIds = new Set(scope.authority === 'central' ? scope.entities.filter(row => row.entityType === 'process_libraries').map(row => row.id) : [])
        const removedLibraryIds = new Set([...state.migrationLibraryIds].filter(id => !migrationLibraryIds.has(id)))
        const affectedProjects = [...new Set([...plan.affectedProjects, ...wbs.affectedProjects])]
        const prepared = affectedProjects.length || removedLibraryIds.size || budget.incoming.length || budget.removed.length || payroll.incoming.length || payroll.removed.length || removedProjectIds.size || removedPeople.crews.size || removedPeople.workers.size
          ? await (await state.driver()).prepare(async (candidate) => {
              await assertPayrollMigrationRemoval(candidate, payroll, { projects: removedProjectIds, ...removedPeople, quantity: plan.removed.flatMap(row => row.identities) })
              await assertQuantityHollowMigrationReferences(candidate, { entityIds: plan.removed.map(row => row.entityId), projects: [...removedProjectIds], crews: [...removedPeople.crews], workers: [...removedPeople.workers], quantity: plan.removed.flatMap(row => row.identities) })
              await applyBudgetMigration(candidate, budget, removedProjectIds)
              await removeWbsMigration(candidate, wbs, plan.removed, removedLibraryIds)
              await applyQuantityMigration(candidate, plan)
              await applyWbsMigration(candidate, wbs)
              await applyPayrollMigration(candidate, payroll)
              for (const projectId of affectedProjects)
                await candidate.execute('DELETE FROM schedule_command_receipts WHERE project_id = ?', [projectId])
            })
          : null
        let finished = false
        return {
          commit() {
            if (finished)
              return
            finished = true
            prepared?.commit()
            state.imports = plan.imports
            state.wbsImports = wbs.imports
            state.budgetImports = budget.imports
            state.payrollImports = payroll.imports
            state.migrationPeople = migrationPeople
            state.migrationProjectIds = migrationProjectIds
            state.migrationLibraryIds = migrationLibraryIds
            state.service.invalidateProjects(affectedProjects)
            release()
          },
          async abort() {
            if (finished)
              return
            finished = true
            try {
              await prepared?.abort()
            }
            finally { release() }
          },
        }
      }
      catch (cause) {
        release()
        throw cause
      }
    },
    withSchedule<T>(query: QuantityReadQuery, consume: (db: TransactionDb, context: QuantityContext, quantityVersion: string) => Promise<T>, sessionId?: string | null): Promise<T> {
      const request = structuredClone(query)
      return run(sessionId, (service, context) => service.withSchedule(request, context, (db, version) => consume(db, context, version)))
    },
    /** 来源域在 SQL 读取成功后同步发布，整个窗口仍持有量域/迁移互斥队列。 */
    withSourceCommit<T>(query: QuantityReadQuery, prepare: (db: TransactionDb, context: QuantityContext, quantityVersion: string) => Promise<(currentContext: QuantityContext) => T>, sessionId?: string | null): Promise<T> {
      const request = structuredClone(query)
      return run(sessionId, async (service, context) => {
        const commit = await service.withSchedule(request, context, (db, version) => prepare(db, context, version))
        return commit(options.session(sessionId))
      })
    },
    withMonthly<T>(query: QuantityMonthlyReadQuery, consume: (facts: readonly QuantityMonthlyBoqFact[]) => T, sessionId?: string | null): Promise<T> {
      const request = structuredClone(query)
      return run(sessionId, (service, context) => service.withMonthly(request, context, consume))
    },
    variance(query: QuantityReadQuery, sessionId?: string | null) {
      const request = structuredClone(query)
      return run(sessionId, (service, context) => service.variance(request, context))
    },
    boq(query: QuantityReadQuery, sessionId?: string | null) {
      const request = structuredClone(query)
      return run(sessionId, (service, context) => service.boq(request, context))
    },
    stages(query: QuantityReadQuery, sessionId?: string | null) {
      const request = structuredClone(query)
      return run(sessionId, (service, context) => service.stages(request, context))
    },
    workspace(query: QuantityReadQuery, sessionId?: string | null) {
      const request = structuredClone(query)
      return run(sessionId, (service, context) => service.workspace(request, context))
    },
    assignments(query: QuantityReadQuery, sessionId?: string | null) {
      const request = structuredClone(query)
      return run(sessionId, (service, context) => service.assignments(request, context))
    },
    completion(query: QuantityUnitReadQuery, sessionId?: string | null) {
      const request = structuredClone(query)
      return run(sessionId, (service, context) => service.completion(request, context))
    },
    batchPlan(query: QuantityBatchReadQuery, sessionId?: string | null) {
      const request = structuredClone(query)
      return run(sessionId, (service, context) => service.batchPlan(request, context))
    },
    photo(query: QuantityReadQuery & QuantityPhotoIdentity, sessionId?: string | null) {
      const request = structuredClone(query)
      return run(sessionId, (service, context) => service.photo(request, context))
    },
    region(query: QuantityReadQuery, sessionId?: string | null) {
      const request = structuredClone(query)
      return run(sessionId, (service, context) => service.region(request, context))
    },
    templates(query: QuantityReadQuery, sessionId?: string | null) {
      const request = structuredClone(query)
      return run(sessionId, (service, context) => service.templates(request, context))
    },
    execute(command: QuantityCommand, sessionId?: string | null) {
      const request = structuredClone(command)
      return run(sessionId, (service, context) => service.execute(request, context))
    },
    reset(sessionId?: string | null) {
      return closeMatching(state => state.sessionId === (sessionId || 'default'))
    },
    close() {
      return closeMatching(() => true)
    },
  }
}
