import { productionInvoiceSession, requireProductionInvoices, throwProductionInvoiceError } from '../../utils/production-invoice-runtime'

export default defineEventHandler(async (event) => {
  try {
    return await requireProductionInvoices().execute(await readBody(event), productionInvoiceSession(event))
  }
  catch (cause) { throwProductionInvoiceError(cause) }
})
