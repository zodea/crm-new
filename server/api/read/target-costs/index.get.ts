import { encodeTargetCostWire, parseTargetCostQuery } from '../../../../app/lib/target-cost/central-codec'
import { throwQuantityError } from '../../../utils/quantity-error'
import { targetCostDemoContext, targetCostService } from '../../../utils/target-cost-runtime'

export default defineEventHandler(async (event) => {
  try {
    const query = parseTargetCostQuery(getQuery(event))
    const sessionId = getHeader(event, 'x-ruihang-test-session')
    return encodeTargetCostWire(query.origin === 'demo' ? targetCostDemoContext(Boolean(query.includeDemo), sessionId) : await targetCostService.list(query, sessionId))
  }
  catch (cause) { throwQuantityError(cause) }
})
