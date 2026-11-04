import { CentralInvoiceProblem } from '../../../../app/lib/invoice/central-contract'
import { productionInvoiceSession, requireProductionInvoices, throwProductionInvoiceError } from '../../../utils/production-invoice-runtime'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    if (Object.keys(query).some(key => key !== 'deleted') || (query.deleted !== undefined && (typeof query.deleted !== 'string' || !['true', 'false'].includes(query.deleted))))
      throw new CentralInvoiceProblem('validation-failed', '发票读取参数无效。')
    return await requireProductionInvoices().getRead(getRouterParam(event, 'id') ?? '', productionInvoiceSession(event), query.deleted === 'true')
  }
  catch (cause) { throwProductionInvoiceError(cause) }
})
