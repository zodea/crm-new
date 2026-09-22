import { throwQuantityError } from '../../../utils/quantity-error'
import { parseQuantityHollowReadQuery } from '../../../utils/quantity-request'
import { quantityHollowTestInstance } from '../../../utils/quantity-runtime'

export default defineEventHandler(async (event) => {
  try {
    return await quantityHollowTestInstance.hollow(parseQuantityHollowReadQuery(getQuery(event)), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) { throwQuantityError(cause) }
})
