import type { CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type { QuantityBoqWorkspace } from '../../app/lib/quantity/central-boq'
import type { QuantityBatchReadQuery, QuantityCommand, QuantityContext, QuantityReadQuery, QuantityUnitReadQuery } from '../../app/lib/quantity/central-contract'
import type { QuantityMonthlyBoqFact, QuantityMonthlyReadQuery } from '../../app/lib/quantity/central-monthly'
import type { QuantityPersonSource } from '../../app/lib/quantity/central-people'
import type { QuantityPhotoIdentity } from '../../app/lib/quantity/central-photo'
import type { PreparedCoreMigration } from './core-migration-preparation'
import type { ImportedQuantityProject } from './quantity-migration'
import { createDbCoordinator } from '../../app/lib/db/coordinator'
import { createQuantityService } from '../../app/lib/quantity/central-service'
import { createQuantityDatabase } from './quantity-database'
import { applyQuantityMigration, planQuantityMigration } from './quantity-migration'

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

/** 可重置中央验证实例。SQL 状态位于服务端内存，不代表生产持久化已交付。 */
export function createQuantityTestInstance(options: Options) {
  interface State {
    sessionId: string
    database: ReturnType<typeof createDbCoordinator>
    driver: () => ReturnType<typeof createQuantityDatabase>
    service: ReturnType<typeof createQuantityService>
    pending: Promise<void>
    imports: Map<string, ImportedQuantityProject>
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
        const prepared = plan.affectedProjects.length
          ? await (await state.driver()).prepare(candidate => applyQuantityMigration(candidate, plan))
          : null
        let finished = false
        return {
          commit() {
            if (finished)
              return
            finished = true
            prepared?.commit()
            state.imports = plan.imports
            state.service.invalidateProjects(plan.affectedProjects)
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
