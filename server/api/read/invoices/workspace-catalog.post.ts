import { CentralInvoiceProblem } from '../../../../app/lib/invoice/central-contract'
import { readInvoiceWorkspaceCatalog } from '../../../utils/production-invoice-migration-catalog'
import { productionInvoiceSession, throwProductionInvoiceError } from '../../../utils/production-invoice-runtime'
import { productionRuntime } from '../../../utils/production-runtime'

export default defineEventHandler(async (event) => {
  try {
    const runtime = productionRuntime()
    if (!runtime)
      throw new CentralInvoiceProblem('unavailable', '发票中央存储尚未就绪。')
    const session = productionInvoiceSession(event)
    const body: unknown = await readBody(event)
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).join(',') !== 'requested'
      || !('requested' in body) || !Array.isArray(body.requested)
      || body.requested.some(key => typeof key !== 'string' || !['projects', 'suppliers', 'construction', 'subcontract', 'material', 'auxiliary', 'company'].includes(key))
      || new Set(body.requested).size !== body.requested.length) {
      throw new CentralInvoiceProblem('validation-failed', '发票工作台目录请求无效。')
    }
    return await readInvoiceWorkspaceCatalog(runtime.storage, session, body.requested as Parameters<typeof readInvoiceWorkspaceCatalog>[2])
  }
  catch (cause) { throwProductionInvoiceError(cause) }
})
