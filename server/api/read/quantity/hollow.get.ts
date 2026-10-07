import { productionQuantityRuntime } from '../../../utils/production-quantity-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'
import { parseQuantityHollowReadQuery } from '../../../utils/quantity-request'
import { quantityHollowTestInstance } from '../../../utils/quantity-runtime'

export default defineEventHandler(async (event) => {
  try {
    const production = productionQuantityRuntime(event)
    if (production)
      return await production.quantity.hollow(parseQuantityHollowReadQuery(getQuery(event)))
    return await quantityHollowTestInstance.hollow(parseQuantityHollowReadQuery(getQuery(event)), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) { throwQuantityError(cause) }
})
