import { throwProductionStorageError } from '../../../utils/production-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'
import { targetCostApi } from '../../../utils/target-cost-runtime'

export default defineEventHandler(async (event) => {
  try {
    return await targetCostApi(event).budget.resolve(await readBody(event))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwQuantityError(cause)
  }
})
