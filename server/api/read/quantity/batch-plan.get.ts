import { throwQuantityError } from '../../../utils/quantity-error'
import { parseQuantityBatchReadQuery } from '../../../utils/quantity-request'
import { quantityTestInstance } from '../../../utils/quantity-runtime'

export default defineEventHandler(async (event) => {
  try {
    return await quantityTestInstance.batchPlan(parseQuantityBatchReadQuery(getQuery(event)), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) {
    throwQuantityError(cause)
  }
})
