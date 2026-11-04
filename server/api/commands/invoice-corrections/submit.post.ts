import { productionInvoiceSession, requireProductionInvoiceCorrections, throwProductionInvoiceError } from '../../../utils/production-invoice-runtime'

export default defineEventHandler(async (event) => {
  try {
    return await requireProductionInvoiceCorrections().submit(await readBody(event), productionInvoiceSession(event))
  }
  catch (cause) { throwProductionInvoiceError(cause) }
})
