import { encodeTargetCostWire, parseTargetCostQuery } from '../../../../app/lib/target-cost/central-codec'
import { throwProductionStorageError } from '../../../utils/production-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'
import { targetCostApi } from '../../../utils/target-cost-runtime'

export default defineEventHandler(async (event) => {
  try {
    return encodeTargetCostWire(await targetCostApi(event).budget.detail(parseTargetCostQuery(getQuery(event)), getRouterParam(event, 'id') ?? ''))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwQuantityError(cause)
  }
})
