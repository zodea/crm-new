import { normalizeFinanceLookup } from '../../../../../app/lib/finance/central-contract'
import { financeApi, financeRouteKind, throwFinanceError } from '../../../../utils/finance-api'

export default defineEventHandler(async (event) => {
  try {
    const source = financeApi(event, true)
    const query = getQuery(event)
    return await source.finance.lookup(financeRouteKind(event), normalizeFinanceLookup(query), source.session)
  }
  catch (cause) { throwFinanceError(cause) }
})
