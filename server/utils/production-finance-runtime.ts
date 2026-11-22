import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { BusinessSession } from './business-session'
import { financeFailure, FinanceRepositoryProblem } from '../../app/lib/finance/central-contract'
import { CentralInvoiceProblem } from '../../app/lib/invoice/central-contract'
import { listWorkerReferences, readWorkerReference } from './production-crew-worker-references'
import { hasProductionSettlementRead } from './production-finance-references'
import { createProductionFinanceService } from './production-finance-service'
import { listProductionInvoiceReferences } from './production-invoice-service'
import { listProductionOtherSettlementReferences, readProductionOtherSettlementReference } from './production-other-settlement-service'
import { listProductionOwnerSettlementReferences, readProductionOwnerSettlementReference } from './production-owner-document-record'
import { productionRuntime } from './production-runtime'

const services = new WeakMap<object, ReturnType<typeof createProductionFinanceService>>()

/** The physical stable ID chooses its actual owner before any owner-specific content is exposed. */
export function productionFinanceSettlementOwners(tx: TransactionDb, actor: BusinessSession) {
  return {
    async expenditure_settlements(id: string) {
      if (!hasProductionSettlementRead(actor))
        return financeFailure('forbidden', '无正式结算来源读取权限')
      const [row] = await tx.select<{ document_owner: string }>('SELECT document_owner FROM expenditure_settlements WHERE id=?', [id])
      if (!row)
        return null
      const capability = row.document_owner === 'business' ? 'subcontract-document:read' : row.document_owner === 'other' ? 'other-settlement:read' : null
      if (!capability)
        return financeFailure('unavailable', '结算实际 owner 未获证明，不能切换成其他来源')
      if (!actor.capabilities.includes(capability))
        return financeFailure('forbidden', '无所选结算实际 owner 的读取权限')
      return row.document_owner === 'business' ? readProductionOwnerSettlementReference(tx, actor, id) : readProductionOtherSettlementReference(tx, actor, id)
    },
    async settlementCandidates() {
      const rows: Array<Record<string, unknown>> = []
      if (actor.capabilities.includes('other-settlement:read'))
        rows.push(...await listProductionOtherSettlementReferences(tx, actor))
      if (actor.capabilities.includes('subcontract-document:read'))
        rows.push(...await listProductionOwnerSettlementReferences(tx, actor))
      return rows
    },
  }
}

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
    ...productionFinanceSettlementOwners(tx, actor),
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
