import { CentralInvoiceProblem } from '../../../../app/lib/invoice/central-contract'
import { createProductionInvoiceMigration } from '../../../utils/production-invoice-migration'
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
      || !['finance-invoice:read', 'finance-invoice:write', 'finance-invoice:import'].every(capability => actor.capabilities.includes(capability))) {
      throw new CentralInvoiceProblem('forbidden', '当前身份无旧发票迁入恢复权限。')
    }
    return await createProductionInvoiceMigration(runtime.storage).retire(await readBody(event), session)
  }
  catch (cause) { throwProductionInvoiceError(cause) }
})
