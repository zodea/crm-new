import type { InvoiceLegacyMappings } from '../../../utils/production-invoice-migration-mapping'
import { CentralInvoiceProblem } from '../../../../app/lib/invoice/central-contract'
import { previewLegacyInvoiceMappings } from '../../../utils/production-invoice-migration-mapping'
import { productionInvoiceSession, throwProductionInvoiceError } from '../../../utils/production-invoice-runtime'
import { productionRuntime } from '../../../utils/production-runtime'

/** 尚未开放白名单；正式启用前须完成迁入与恢复闭环。 */
export default defineEventHandler(async (event) => {
  try {
    const runtime = productionRuntime()
    if (!runtime)
      throw new CentralInvoiceProblem('unavailable', '发票中央存储尚未就绪。')
    const session = productionInvoiceSession(event)
    const actor = session()
    if (actor.workspaceId !== runtime.storage.identity.workspaceId || actor.actorId !== runtime.storage.identity.actorId
      || !actor.capabilities.includes('finance-invoice:read') || !actor.capabilities.includes('finance-invoice:import')) {
      throw new CentralInvoiceProblem('forbidden', '当前身份无发票旧库映射预检权限。')
    }
    const body: unknown = await readBody(event)
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'mappings,source'
      || !('source' in body) || !body.source || typeof body.source !== 'object' || Array.isArray(body.source)
      || Object.keys(body.source).sort().join(',') !== 'payloadBase64,sha256' || !('sha256' in body.source) || typeof body.source.sha256 !== 'string'
      || !('payloadBase64' in body.source) || typeof body.source.payloadBase64 !== 'string' || !('mappings' in body) || !body.mappings || typeof body.mappings !== 'object' || Array.isArray(body.mappings)) {
      throw new CentralInvoiceProblem('validation-failed', '映射预检须提供完整旧库快照和明确映射。')
    }
    return await previewLegacyInvoiceMappings(runtime.storage, { source: { sha256: body.source.sha256, payloadBase64: body.source.payloadBase64 }, mappings: body.mappings as InvoiceLegacyMappings }, session)
  }
  catch (cause) { throwProductionInvoiceError(cause) }
})
