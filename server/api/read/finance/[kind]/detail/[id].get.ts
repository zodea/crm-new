import { financeFailure } from '../../../../../../app/lib/finance/central-contract'
import { financeApi, financeRouteKind, throwFinanceError } from '../../../../../utils/finance-api'

export default defineEventHandler(async (event) => {
  try {
    const kind = financeRouteKind(event)
    if (kind !== 'payment_application')
      financeFailure('invalid-query', '此财务类型不提供付款申请详情。')
    const source = financeApi(event)
    return await source.finance.paymentDetail(String(event.context.params?.id), source.session)
  }
  catch (cause) { throwFinanceError(cause) }
})
