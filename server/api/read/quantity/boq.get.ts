import { productionQuantityRuntime } from '../../../utils/production-quantity-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'
import { parseQuantityReadQuery } from '../../../utils/quantity-request'
import { quantityTestInstance } from '../../../utils/quantity-runtime'

export default defineEventHandler(async (event) => {
  try {
    const production = productionQuantityRuntime(event)
    if (production)
      return await production.quantity.boq(parseQuantityReadQuery(getQuery(event)))
    return await quantityTestInstance.boq(parseQuantityReadQuery(getQuery(event)), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) {
    throwQuantityError(cause)
  }
})
