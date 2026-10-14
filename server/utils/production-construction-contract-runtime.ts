import { createProductionConstructionMigration } from './production-construction-contract-migration'
import { createProductionConstructionContractService } from './production-construction-contract-service'
import { productionRuntime } from './production-runtime'

const owners = new WeakMap<object, ReturnType<typeof createProductionConstructionContractService>>()
export function productionConstructionContractRuntime() {
  const runtime = productionRuntime()
  if (!runtime)
    return null
  let contracts = owners.get(runtime.storage)
  if (!contracts) {
    contracts = createProductionConstructionContractService(runtime.storage)
    owners.set(runtime.storage, contracts)
  }
  return { storage: runtime.storage, contracts }
}

const migrations = new WeakMap<object, ReturnType<typeof createProductionConstructionMigration>>()
export function productionConstructionImportRuntime() {
  const runtime = productionRuntime()
  if (!runtime)
    return null
  let migration = migrations.get(runtime.storage)
  if (!migration) {
    migration = createProductionConstructionMigration(runtime.storage)
    migrations.set(runtime.storage, migration)
  }
  return { ...runtime, migration }
}
