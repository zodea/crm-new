import { productionRuntime } from './production-runtime'
import { createProductionSupplierService } from './production-supplier-service'

const services = new WeakMap<object, ReturnType<typeof createProductionSupplierService>>()
export function productionSupplierRuntime() {
  const runtime = productionRuntime()
  if (!runtime)
    return null
  let suppliers = services.get(runtime.storage)
  if (!suppliers) {
    suppliers = createProductionSupplierService(runtime.storage)
    services.set(runtime.storage, suppliers)
  }
  return { storage: runtime.storage, suppliers }
}
