import { CentralInvoiceProblem } from '../../../../app/lib/invoice/central-contract'
import { productionInvoiceSession, requireProductionInvoiceCorrections, throwProductionInvoiceError } from '../../../utils/production-invoice-runtime'

export default defineEventHandler(async (event) => {
  try {
    const body: unknown = await readBody(event)
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).join(',') !== 'invoiceId' || !('invoiceId' in body) || typeof body.invoiceId !== 'string')
      throw new CentralInvoiceProblem('validation-failed', '原票身份无效。')
    return await requireProductionInvoiceCorrections().listRead(body.invoiceId, productionInvoiceSession(event))
  }
  catch (cause) { throwProductionInvoiceError(cause) }
})
