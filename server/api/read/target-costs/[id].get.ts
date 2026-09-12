import { encodeTargetCostWire, parseTargetCostQuery } from '../../../../app/lib/target-cost/central-codec'
import { throwQuantityError } from '../../../utils/quantity-error'
import { targetCostService } from '../../../utils/target-cost-runtime'

export default defineEventHandler(async (event) => {
  try {
    return encodeTargetCostWire(await targetCostService.detail(parseTargetCostQuery(getQuery(event)), getRouterParam(event, 'id') ?? '', getHeader(event, 'x-ruihang-test-session')))
  }
  catch (cause) { throwQuantityError(cause) }
})
