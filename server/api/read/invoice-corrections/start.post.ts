import { CentralInvoiceProblem } from '../../../../app/lib/invoice/central-contract'
import { productionInvoiceSession, requireProductionInvoiceCorrections, throwProductionInvoiceError } from '../../../utils/production-invoice-runtime'

export default defineEventHandler(async (event) => {
  try {
    const body: unknown = await readBody(event)
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'baseInvoiceVersion,invoiceId' || !('invoiceId' in body) || typeof body.invoiceId !== 'string' || !('baseInvoiceVersion' in body) || typeof body.baseInvoiceVersion !== 'string')
      throw new CentralInvoiceProblem('validation-failed', '原票身份或版本无效。')
    return await requireProductionInvoiceCorrections().startRead(body.invoiceId, body.baseInvoiceVersion, productionInvoiceSession(event))
  }
  catch (cause) { throwProductionInvoiceError(cause) }
})
