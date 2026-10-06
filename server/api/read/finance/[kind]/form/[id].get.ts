import { financeApi, financeRouteKind, throwFinanceError } from '../../../../../utils/finance-api'
import { financeId } from '../../../../../utils/production-finance-request'

export default defineEventHandler(async (event) => {
  try {
    const source = financeApi(event)
    return await source.finance.form(financeRouteKind(event), financeId(getRouterParam(event, 'id')), source.session)
  }
  catch (cause) { throwFinanceError(cause) }
})
