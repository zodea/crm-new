import { throwOtherSettlementHttpError } from '../../../../../utils/other-settlement-http-error'
import { productionOtherSettlementRuntime } from '../../../../../utils/production-other-settlement-runtime'
import { productionSession } from '../../../../../utils/production-runtime'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    if (Object.keys(query).some(key => key !== 'version') || (query.version !== undefined && (typeof query.version !== 'string' || !/^[1-9]\d*$/.test(query.version))))
      throw createError({ statusCode: 422, statusMessage: 'Invalid original version' })
    const production = productionOtherSettlementRuntime()
    if (!production)
      throw createError({ statusCode: 503, statusMessage: 'Original owner unavailable' })
    return await production.owner.original(getRouterParam(event, 'id')!, getRouterParam(event, 'fileId')!, typeof query.version === 'string' ? query.version : null, productionSession(event))
  }
  catch (cause) {
    throwOtherSettlementHttpError(cause)
  }
})
