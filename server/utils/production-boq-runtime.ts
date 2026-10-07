import type { H3Event } from 'h3'
import { createProductionBoqMigration } from './production-boq-migration'
import { createProductionBoqService } from './production-boq-service'
import { productionRuntime, productionSession } from './production-runtime'

const owners = new WeakMap<object, ReturnType<typeof createProductionBoqService>>()
export function productionBoqRuntime(event: H3Event) {
  const runtime = productionRuntime()
  if (!runtime)
    return null
  let owner = owners.get(runtime.storage)
  if (!owner) {
    owner = createProductionBoqService(runtime.storage)
    owners.set(runtime.storage, owner)
  }
  const session = productionSession(event)
  return { file: (scope: Parameters<typeof owner.file>[0]) => owner!.file(scope, session), catalog: () => owner!.catalog(session), read: (scope: Parameters<typeof owner.read>[0]) => owner!.read(scope, session), building: (scope: Parameters<typeof owner.building>[0]) => owner!.building(scope, session), correctBuilding: (command: unknown) => owner!.correctBuilding(command, session), items: (scope: Parameters<typeof owner.items>[0]) => owner!.items(scope, session), execute: (command: unknown) => owner!.execute(command, session), resolve: (descriptor: Parameters<typeof owner.resolve>[0]) => owner!.resolve(descriptor, session) }
}

const importOwners = new WeakMap<object, ReturnType<typeof createProductionBoqMigration>>()
export function productionBoqImportRuntime(event: H3Event) {
  const runtime = productionRuntime()
  if (!runtime)
    return null
  let owner = importOwners.get(runtime.storage)
  if (!owner) {
    owner = createProductionBoqMigration(runtime.storage)
    importOwners.set(runtime.storage, owner)
  }
  const session = productionSession(event)
  return { state: () => owner!.state(session), preflight: (command: unknown) => owner!.preflight(command, session), adopt: (command: unknown) => owner!.adopt(command, session), restore: (command: unknown) => owner!.restore(command, session), resolve: (descriptor: unknown) => owner!.resolve(descriptor, session) }
}
