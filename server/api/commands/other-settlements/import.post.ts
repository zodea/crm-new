import { throwOtherSettlementHttpError } from '../../../utils/other-settlement-http-error'
import { productionOtherSettlementRuntime } from '../../../utils/production-other-settlement-runtime'
import { productionSession } from '../../../utils/production-runtime'

export default defineEventHandler(async (event) => {
  try {
    const runtime = productionOtherSettlementRuntime()
    if (!runtime)
      throw createError({ statusCode: 503, statusMessage: 'Production owner unavailable' })
    return await runtime.owner.importSnapshot(await readBody(event), productionSession(event))
  }
  catch (cause) {
    throwOtherSettlementHttpError(cause)
  }
})
