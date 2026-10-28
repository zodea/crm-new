import { productionRuntime } from './production-runtime'
import { createProductionSubcontractMigration } from './production-subcontract-contract-migration'
import { createProductionSubcontractContractService } from './production-subcontract-contract-service'

const services = new WeakMap<object, ReturnType<typeof createProductionSubcontractContractService>>()
const migrations = new WeakMap<object, ReturnType<typeof createProductionSubcontractMigration>>()
export function productionSubcontractContractRuntime() {
  const runtime = productionRuntime()
  if (!runtime)
    return null
  let contracts = services.get(runtime.storage)
  if (!contracts) {
    contracts = createProductionSubcontractContractService(runtime.storage)
    services.set(runtime.storage, contracts)
  }
  return { ...runtime, contracts }
}
export function productionSubcontractImportRuntime() {
  const runtime = productionRuntime()
  if (!runtime)
    return null
  let migration = migrations.get(runtime.storage)
  if (!migration) {
    migration = createProductionSubcontractMigration(runtime.storage)
    migrations.set(runtime.storage, migration)
  }
  return { ...runtime, migration }
}
