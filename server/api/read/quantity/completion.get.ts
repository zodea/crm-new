import { throwQuantityError } from '../../../utils/quantity-error'
import { parseQuantityUnitReadQuery } from '../../../utils/quantity-request'
import { quantityTestInstance } from '../../../utils/quantity-runtime'

export default defineEventHandler(async (event) => {
  try {
    return await quantityTestInstance.completion(parseQuantityUnitReadQuery(getQuery(event)), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) {
    throwQuantityError(cause)
  }
})
