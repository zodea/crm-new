import { encodeTargetCostWire, parseTargetCostQuery } from '../../../../app/lib/target-cost/central-codec'
import { throwQuantityError } from '../../../utils/quantity-error'
import { targetCostService } from '../../../utils/target-cost-runtime'

export default defineEventHandler(async (event) => {
  try {
    const input = getQuery(event)
    return encodeTargetCostWire(await targetCostService.form(parseTargetCostQuery(input), typeof input.id === 'string' && input.id ? input.id : null, typeof input.draftKey === 'string' ? input.draftKey : undefined, getHeader(event, 'x-ruihang-test-session')))
  }
  catch (cause) { throwQuantityError(cause) }
})
