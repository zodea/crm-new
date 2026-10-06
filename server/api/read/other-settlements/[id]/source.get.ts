import { throwOtherSettlementHttpError } from '../../../../utils/other-settlement-http-error'
import { otherSettlementDevelopmentRead, otherSettlementInstance, otherSettlementSession } from '../../../../utils/other-settlement-runtime'
import { productionOtherSettlementRuntime } from '../../../../utils/production-other-settlement-runtime'
import { productionSession } from '../../../../utils/production-runtime'

export default defineEventHandler(async (event) => {
  const key = getHeader(event, 'x-ruihang-test-session')
  try {
    const production = productionOtherSettlementRuntime()
    if (production)
      return await production.owner.source(getRouterParam(event, 'id')!, String(getQuery(event).factId ?? ''), productionSession(event))
    const instance = otherSettlementInstance(key)
    const session = otherSettlementSession(key)
    const source = instance.source(getRouterParam(event, 'id')!, String(getQuery(event).factId ?? ''), session)
    return otherSettlementDevelopmentRead(source, session, source, 'source', { id: getRouterParam(event, 'id')!, factId: getQuery(event).factId })
  }
  catch (cause) {
    throwOtherSettlementHttpError(cause)
  }
})
