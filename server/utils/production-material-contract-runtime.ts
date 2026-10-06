import { createProductionMaterialContractService } from './production-material-contract-service'
import { productionRuntime } from './production-runtime'

const services = new WeakMap<object, ReturnType<typeof createProductionMaterialContractService>>()
export function productionMaterialContractRuntime() {
  const runtime = productionRuntime()
  if (!runtime)
    return null
  let contracts = services.get(runtime.storage)
  if (!contracts) {
    contracts = createProductionMaterialContractService(runtime.storage)
    services.set(runtime.storage, contracts)
  }
  return { storage: runtime.storage, contracts }
}
