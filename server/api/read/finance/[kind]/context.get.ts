import { financeApi, financeRouteKind, throwFinanceError } from '../../../../utils/finance-api'

export default defineEventHandler(async (event) => {
  try {
    const source = financeApi(event)
    return await source.finance.context(financeRouteKind(event), source.session)
  }
  catch (cause) { throwFinanceError(cause) }
})
