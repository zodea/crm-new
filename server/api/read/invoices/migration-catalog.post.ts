import { CentralInvoiceProblem } from '../../../../app/lib/invoice/central-contract'
import { readInvoiceMigrationCatalog } from '../../../utils/production-invoice-migration-catalog'
import { productionInvoiceSession, throwProductionInvoiceError } from '../../../utils/production-invoice-runtime'
import { productionRuntime } from '../../../utils/production-runtime'

/** 目录路由在注册与完整恢复验证完成前不加入正式入口白名单。 */
export default defineEventHandler(async (event) => {
  try {
    const runtime = productionRuntime()
    if (!runtime)
      throw new CentralInvoiceProblem('unavailable', '发票中央存储尚未就绪。')
    const session = productionInvoiceSession(event)
    const actor = session()
    if (actor.workspaceId !== runtime.storage.identity.workspaceId || actor.actorId !== runtime.storage.identity.actorId
      || !actor.capabilities.includes('finance-invoice:read') || !actor.capabilities.includes('finance-invoice:import')) {
      throw new CentralInvoiceProblem('forbidden', '当前身份无发票迁入目录读取权限。')
    }
    const body: unknown = await readBody(event)
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).join(',') !== 'requested'
      || !('requested' in body) || !Array.isArray(body.requested)
      || body.requested.some(key => typeof key !== 'string' || !['projects', 'suppliers', 'construction', 'subcontract', 'material', 'auxiliary', 'company'].includes(key))
      || new Set(body.requested).size !== body.requested.length) {
      throw new CentralInvoiceProblem('validation-failed', '发票迁入目录请求无效。')
    }
    return await readInvoiceMigrationCatalog(runtime.storage, session, body.requested as Parameters<typeof readInvoiceMigrationCatalog>[2])
  }
  catch (cause) { throwProductionInvoiceError(cause) }
})
