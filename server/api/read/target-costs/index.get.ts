import { encodeTargetCostWire, parseTargetCostQuery } from '../../../../app/lib/target-cost/central-codec'
import { throwProductionStorageError } from '../../../utils/production-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'
import { targetCostApi } from '../../../utils/target-cost-runtime'

export default defineEventHandler(async (event) => {
  try {
    const query = parseTargetCostQuery(getQuery(event))
    return encodeTargetCostWire(await targetCostApi(event).budget.list(query))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwQuantityError(cause)
  }
})
