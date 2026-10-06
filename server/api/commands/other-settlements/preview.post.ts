import { throwOtherSettlementHttpError } from '../../../utils/other-settlement-http-error'
import { productionOtherSettlementRuntime } from '../../../utils/production-other-settlement-runtime'
import { productionSession } from '../../../utils/production-runtime'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    if (!body || Object.keys(body).join(',') !== 'source')
      throw createError({ statusCode: 422, statusMessage: 'Invalid source' })
    const runtime = productionOtherSettlementRuntime()
    if (!runtime)
      throw createError({ statusCode: 503, statusMessage: 'Production owner unavailable' })
    return await runtime.owner.previewSnapshot(body.source, productionSession(event))
  }
  catch (cause) {
    throwOtherSettlementHttpError(cause)
  }
})
