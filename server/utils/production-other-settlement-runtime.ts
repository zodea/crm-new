import { createProductionOtherSettlementMigration } from './production-other-settlement-migration'
import { createProductionOtherSettlementService } from './production-other-settlement-service'
import { productionRuntime } from './production-runtime'

const owners = new WeakMap<object, ReturnType<typeof createProductionOtherSettlementService> & ReturnType<typeof createProductionOtherSettlementMigration>>()
export function productionOtherSettlementRuntime() {
  const runtime = productionRuntime()
  if (!runtime)
    return null
  let owner = owners.get(runtime.storage)
  if (!owner) {
    owner = { ...createProductionOtherSettlementService(runtime.storage), ...createProductionOtherSettlementMigration(runtime.storage) }
    owners.set(runtime.storage, owner)
  }
  return { owner, storage: runtime.storage }
}
