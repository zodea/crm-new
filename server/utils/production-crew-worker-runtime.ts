import { createProductionCrewWorkerImport } from './production-crew-worker-import'
import { createProductionCrewWorkerService } from './production-crew-worker-service'
import { productionRuntime } from './production-runtime'

const services = new WeakMap<object, ReturnType<typeof createProductionCrewWorkerService>>()
const imports = new WeakMap<object, ReturnType<typeof createProductionCrewWorkerImport>>()
export function productionCrewWorkerRuntime() {
  const runtime = productionRuntime()
  if (!runtime)
    return null
  let crews = services.get(runtime.storage)
  if (!crews) {
    crews = createProductionCrewWorkerService(runtime.storage)
    services.set(runtime.storage, crews)
  }
  let migration = imports.get(runtime.storage)
  if (!migration) {
    migration = createProductionCrewWorkerImport(runtime.storage)
    imports.set(runtime.storage, migration)
  }
  return { storage: runtime.storage, crews, migration }
}
