import type { SQLInputValue } from 'node:sqlite'
import { DatabaseSync } from 'node:sqlite'
import { createDbCoordinator } from '../../app/lib/db/coordinator'
import { OUR_SIGNATORY_SCHEMA } from '../../app/lib/our-signatory/schema'
import { resolveBusinessSession } from './business-session'
import { createProductionOurSignatoryService } from './production-our-signatory-service'
import { productionRuntime } from './production-runtime'

const productionServices = new WeakMap<object, ReturnType<typeof createProductionOurSignatoryService>>()
const developmentOwners = new Map<string, ReturnType<typeof createDbCoordinator>>()
/** Development uses an explicit ephemeral SQL owner; it has no production persistence claim. */
export function developmentOurSignatoryOwner(sessionId?: string | null) {
  const key = sessionId || 'default'
  let owner = developmentOwners.get(key)
  if (!owner) {
    owner = createDbCoordinator(async () => {
      const db = new DatabaseSync(':memory:')
      db.exec(`PRAGMA foreign_keys=ON;${OUR_SIGNATORY_SCHEMA}`)
      return {
        async execute(sql, params) {
          if (params?.length)
            db.prepare(sql).run(...params as SQLInputValue[])
          else
            db.exec(sql)
        },
        async select<T>(sql: string, params: unknown[] = []) { return db.prepare(sql).all(...params as SQLInputValue[]) as T[] },
        async close() { db.close() },
      }
    })
    developmentOwners.set(key, owner)
  }
  return owner
}
export function ourSignatoryRuntime(sessionId?: string | null) {
  const runtime = productionRuntime()
  if (runtime) {
    let service = productionServices.get(runtime.storage)
    if (!service) {
      service = createProductionOurSignatoryService(runtime.storage)
      productionServices.set(runtime.storage, service)
    }
    return { signatories: service, production: true }
  }
  const actor = resolveBusinessSession()
  const coordinator = developmentOurSignatoryOwner(sessionId)
  const signatories = createProductionOurSignatoryService({
    ...coordinator,
    identity: { workspaceId: actor.workspaceId, actorId: actor.actorId },
    assertBusinessWrite() { },
  })
  return { signatories, production: false }
}
