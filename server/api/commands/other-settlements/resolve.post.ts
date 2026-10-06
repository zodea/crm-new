import { throwOtherSettlementHttpError } from '../../../utils/other-settlement-http-error'
import { otherSettlementInstance, otherSettlementSession } from '../../../utils/other-settlement-runtime'
import { productionOtherSettlementRuntime } from '../../../utils/production-other-settlement-runtime'
import { productionSession } from '../../../utils/production-runtime'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    if (!body || Object.keys(body).join(',') !== 'commandId' || typeof body.commandId !== 'string')
      throw createError({ statusCode: 422, statusMessage: 'Invalid original command' })
    const production = productionOtherSettlementRuntime()
    if (production)
      return await production.owner.resolve(body.commandId, productionSession(event))
    const key = getHeader(event, 'x-ruihang-test-session')
    return otherSettlementInstance(key).resolve(body.commandId, otherSettlementSession(key))
  }
  catch (cause) {
    throwOtherSettlementHttpError(cause)
  }
})
