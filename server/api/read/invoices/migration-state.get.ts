import { CentralInvoiceProblem } from '../../../../app/lib/invoice/central-contract'
import { createProductionInvoiceMigration } from '../../../utils/production-invoice-migration'
import { productionInvoiceSession, throwProductionInvoiceError } from '../../../utils/production-invoice-runtime'
import { productionRuntime } from '../../../utils/production-runtime'

export default defineEventHandler(async (event) => {
  try {
    const runtime = productionRuntime()
    if (!runtime)
      throw new CentralInvoiceProblem('unavailable', '发票中央存储尚未就绪。')
    return await createProductionInvoiceMigration(runtime.storage).state(productionInvoiceSession(event))
  }
  catch (cause) { throwProductionInvoiceError(cause) }
})
