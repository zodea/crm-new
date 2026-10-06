import { financeApi, throwFinanceError } from '../../../utils/finance-api'
import { financeId, financeKind } from '../../../utils/production-finance-request'

export default defineEventHandler(async (event) => {
  try {
    const source = financeApi(event)
    const body = await readBody(event)
    return await source.finance.resolve(financeKind(body.kind), financeId(body.commandId), source.session)
  }
  catch (cause) { throwFinanceError(cause) }
})
