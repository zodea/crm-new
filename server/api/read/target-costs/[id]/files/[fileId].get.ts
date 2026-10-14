import { parseTargetCostQuery } from '../../../../../../app/lib/target-cost/central-codec'
import { throwProductionStorageError } from '../../../../../utils/production-runtime'
import { throwQuantityError } from '../../../../../utils/quantity-error'
import { targetCostApi } from '../../../../../utils/target-cost-runtime'

export default defineEventHandler(async (event) => {
  try {
    return await targetCostApi(event).budget.file(parseTargetCostQuery(getQuery(event)), getRouterParam(event, 'id') ?? '', getRouterParam(event, 'fileId') ?? '')
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwQuantityError(cause)
  }
})
