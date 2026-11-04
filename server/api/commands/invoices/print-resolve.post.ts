import { CentralInvoiceProblem } from '../../../../app/lib/invoice/central-contract'
import { productionInvoiceSession, requireProductionInvoices, throwProductionInvoiceError } from '../../../utils/production-invoice-runtime'

export default defineEventHandler(async (event) => {
  try {
    const body: unknown = await readBody(event)
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !('commandId' in body) || typeof body.commandId !== 'string')
      throw new CentralInvoiceProblem('validation-failed', '原打印提交编号无效。')
    return await requireProductionInvoices().resolvePrinted(body.commandId, productionInvoiceSession(event))
  }
  catch (cause) { throwProductionInvoiceError(cause) }
})
