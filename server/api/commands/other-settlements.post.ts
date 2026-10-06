import { throwOtherSettlementHttpError } from '../../utils/other-settlement-http-error'
import { otherSettlementInstance, otherSettlementSession } from '../../utils/other-settlement-runtime'
import { productionOtherSettlementRuntime } from '../../utils/production-other-settlement-runtime'
import { productionSession } from '../../utils/production-runtime'

export default defineEventHandler(async (event) => {
  const key = getHeader(event, 'x-ruihang-test-session')
  try {
    const production = productionOtherSettlementRuntime()
    if (production)
      return await production.owner.execute(await readBody(event), productionSession(event))
    return await otherSettlementInstance(key).execute(await readBody(event), otherSettlementSession(key))
  }
  catch (cause) {
    throwOtherSettlementHttpError(cause)
  }
})
