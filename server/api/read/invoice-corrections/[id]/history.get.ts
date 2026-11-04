import { productionInvoiceSession, requireProductionInvoiceCorrections, throwProductionInvoiceError } from '../../../../utils/production-invoice-runtime'

export default defineEventHandler(async (event) => {
  try {
    return await requireProductionInvoiceCorrections().historyRead(getRouterParam(event, 'id') ?? '', productionInvoiceSession(event))
  }
  catch (cause) { throwProductionInvoiceError(cause) }
})
