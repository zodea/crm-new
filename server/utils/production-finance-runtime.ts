import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { BusinessSession } from './business-session'
import { FinanceRepositoryProblem } from '../../app/lib/finance/central-contract'
import { CentralInvoiceProblem } from '../../app/lib/invoice/central-contract'
import { listWorkerReferences, readWorkerReference } from './production-crew-worker-references'
import { createProductionFinanceService } from './production-finance-service'
import { listProductionInvoiceReferences } from './production-invoice-service'
import { listProductionOtherSettlementReferences, readProductionOtherSettlementReference } from './production-other-settlement-service'
import { productionRuntime } from './production-runtime'

const services = new WeakMap<object, ReturnType<typeof createProductionFinanceService>>()
export function productionFinanceOwners(tx: TransactionDb, actor: BusinessSession) {
  async function invoices(id?: string) {
    try {
      return await listProductionInvoiceReferences(tx, actor, id)
    }
    catch (cause) {
      if (cause instanceof CentralInvoiceProblem)
        throw new FinanceRepositoryProblem(cause.problem)
      throw cause
    }
  }
  return {
    workers: (id: string) => readWorkerReference(tx, actor, id),
    workerCandidates: () => listWorkerReferences(tx, actor),
    expenditure_settlements: (id: string) => readProductionOtherSettlementReference(tx, actor, id),
    settlementCandidates: () => listProductionOtherSettlementReferences(tx, actor),
    invoices: async (id: string) => (await invoices(id))[0] ?? null,
    invoiceCandidates: () => invoices(),
  }
}
export function productionFinanceRuntime() {
  const runtime = productionRuntime()
  if (!runtime)
    return null
  let finance = services.get(runtime.storage)
  if (!finance) {
    finance = createProductionFinanceService(runtime.storage, { references: productionFinanceOwners })
    services.set(runtime.storage, finance)
  }
  return { storage: runtime.storage, finance }
}
