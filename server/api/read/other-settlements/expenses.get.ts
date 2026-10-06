import { throwOtherSettlementHttpError } from '../../../utils/other-settlement-http-error'
import { otherSettlementDevelopmentRead, otherSettlementSession } from '../../../utils/other-settlement-runtime'
import { productionOtherSettlementRuntime } from '../../../utils/production-other-settlement-runtime'
import { productionSession } from '../../../utils/production-runtime'

export default defineEventHandler(async (event) => {
  try {
    const production = productionOtherSettlementRuntime()
    if (production)
      return await production.owner.expenses(productionSession(event))
    const session = otherSettlementSession(getHeader(event, 'x-ruihang-test-session'))
    return otherSettlementDevelopmentRead({ workspaceId: session.workspaceId, actorId: session.actorId, capabilities: session.capabilities, items: [] }, session, [], 'expenses')
  }
  catch (cause) {
    throwOtherSettlementHttpError(cause)
  }
})
