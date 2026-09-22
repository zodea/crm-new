import { parseTargetCostQuery } from '../../../../../../app/lib/target-cost/central-codec'
import { throwQuantityError } from '../../../../../utils/quantity-error'
import { targetCostService } from '../../../../../utils/target-cost-runtime'

export default defineEventHandler(async (event) => {
  try {
    return await targetCostService.file(parseTargetCostQuery(getQuery(event)), getRouterParam(event, 'id') ?? '', getRouterParam(event, 'fileId') ?? '', getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) { throwQuantityError(cause) }
})
