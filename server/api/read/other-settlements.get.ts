import { throwOtherSettlementHttpError } from '../../utils/other-settlement-http-error'
import { otherSettlementDevelopmentRead, otherSettlementInstance, otherSettlementSession } from '../../utils/other-settlement-runtime'
import { productionOtherSettlementRuntime } from '../../utils/production-other-settlement-runtime'
import { productionSession } from '../../utils/production-runtime'

export default defineEventHandler(async (event) => {
  const key = getHeader(event, 'x-ruihang-test-session')
  try {
    const production = productionOtherSettlementRuntime()
    if (production)
      return await production.owner.list(getQuery(event), productionSession(event))
    const instance = otherSettlementInstance(key)
    const session = otherSettlementSession(key)
    const query = getQuery(event)
    return otherSettlementDevelopmentRead(instance.list(query, session), session, instance.snapshot(), 'list', query)
  }
  catch (cause) {
    throwOtherSettlementHttpError(cause)
  }
})
