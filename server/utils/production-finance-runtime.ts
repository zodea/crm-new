import { listWorkerReferences, readWorkerReference } from './production-crew-worker-references'
import { createProductionFinanceService } from './production-finance-service'
import { listProductionOtherSettlementReferences, readProductionOtherSettlementReference } from './production-other-settlement-service'
import { productionRuntime } from './production-runtime'

const services = new WeakMap<object, ReturnType<typeof createProductionFinanceService>>()
export function productionFinanceRuntime() {
  const runtime = productionRuntime()
  if (!runtime)
    return null
  let finance = services.get(runtime.storage)
  if (!finance) {
    finance = createProductionFinanceService(runtime.storage, { references: (tx, actor) => ({
      workers: id => readWorkerReference(tx, actor, id),
      workerCandidates: () => listWorkerReferences(tx, actor),
      expenditure_settlements: id => readProductionOtherSettlementReference(tx, actor, id),
      settlementCandidates: () => listProductionOtherSettlementReferences(tx, actor),
    }) })
    services.set(runtime.storage, finance)
  }
  return { storage: runtime.storage, finance }
}
