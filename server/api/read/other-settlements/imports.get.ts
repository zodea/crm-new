import { throwOtherSettlementHttpError } from '../../../utils/other-settlement-http-error'
import { productionOtherSettlementRuntime } from '../../../utils/production-other-settlement-runtime'
import { productionSession } from '../../../utils/production-runtime'

export default defineEventHandler(async (event) => {
  try {
    if (Object.keys(getQuery(event)).length)
      throw createError({ statusCode: 422, statusMessage: 'Invalid query' })
    const runtime = productionOtherSettlementRuntime()
    if (!runtime)
      throw createError({ statusCode: 503, statusMessage: 'Production owner unavailable' })
    return await runtime.owner.imports(productionSession(event))
  }
  catch (cause) {
    throwOtherSettlementHttpError(cause)
  }
})
