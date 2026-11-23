import { productionInvoiceSession, requireProductionInvoices, throwProductionInvoiceError } from '../../../../utils/production-invoice-runtime'

export default defineEventHandler(async (event) => {
  try {
    setHeader(event, 'Cache-Control', 'private, no-store')
    return await requireProductionInvoices().workbooksForInvoice(getRouterParam(event, 'id') ?? '', productionInvoiceSession(event))
  }
  catch (cause) { throwProductionInvoiceError(cause) }
})
