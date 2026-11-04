import { CentralInvoiceProblem } from '../../../../app/lib/invoice/central-contract'
import { previewProtectedLegacyInvoices } from '../../../utils/production-invoice-migration-source'
import { productionInvoiceSession, throwProductionInvoiceError } from '../../../utils/production-invoice-runtime'
import { productionRuntime } from '../../../utils/production-runtime'

export default defineEventHandler(async (event) => {
  try {
    const runtime = productionRuntime()
    if (!runtime)
      throw new CentralInvoiceProblem('unavailable', '发票中央存储尚未就绪。')
    const session = productionInvoiceSession(event)
    const actor = session()
    if (actor.workspaceId !== runtime.storage.identity.workspaceId || actor.actorId !== runtime.storage.identity.actorId
      || !actor.capabilities.includes('finance-invoice:read') || !actor.capabilities.includes('finance-invoice:import')) {
      throw new CentralInvoiceProblem('forbidden', '当前身份无发票旧库预检权限。')
    }
    const source: unknown = await readBody(event)
    if (!source || typeof source !== 'object' || Array.isArray(source) || Object.keys(source).sort().join(',') !== 'payloadBase64,sha256'
      || !('sha256' in source) || typeof source.sha256 !== 'string' || !('payloadBase64' in source) || typeof source.payloadBase64 !== 'string') {
      throw new CentralInvoiceProblem('validation-failed', '预检须提供完整旧库快照及摘要。')
    }
    await runtime.storage.withTransaction(async (tx) => {
      const [row] = await tx.select<{ workspace_id: string, owner_id: string }>('SELECT workspace_id,owner_id FROM production_metadata WHERE singleton=1')
      if (!row || row.workspace_id !== runtime.storage.identity.workspaceId || row.owner_id !== runtime.storage.identity.actorId)
        throw new CentralInvoiceProblem('unavailable', '中央存储身份无法核验。')
    })
    return await previewProtectedLegacyInvoices({ sha256: source.sha256, payloadBase64: source.payloadBase64 }, runtime.storage.identity, session)
  }
  catch (cause) { throwProductionInvoiceError(cause) }
})
