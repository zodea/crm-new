import { throwOtherSettlementHttpError } from '../../../utils/other-settlement-http-error'
import { otherSettlementDevelopmentRead, otherSettlementInstance, otherSettlementSession } from '../../../utils/other-settlement-runtime'
import { productionOtherSettlementRuntime } from '../../../utils/production-other-settlement-runtime'
import { productionSession } from '../../../utils/production-runtime'

export default defineEventHandler(async (event) => {
  const key = getHeader(event, 'x-ruihang-test-session')
  try {
    const production = productionOtherSettlementRuntime()
    if (production)
      return await production.owner.context(productionSession(event))
    const instance = otherSettlementInstance(key)
    const session = otherSettlementSession(key)
    const context = instance.context(session)
    return otherSettlementDevelopmentRead(context, session, context, 'context')
  }
  catch (cause) {
    throwOtherSettlementHttpError(cause)
  }
})
