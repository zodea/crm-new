import { productionQuantityRuntime } from '../../../utils/production-quantity-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'
import { parseQuantityPhotoReadQuery } from '../../../utils/quantity-request'
import { quantityTestInstance } from '../../../utils/quantity-runtime'

export default defineEventHandler(async (event) => {
  try {
    const production = productionQuantityRuntime(event)
    if (production)
      return await production.quantity.photo(parseQuantityPhotoReadQuery(getQuery(event)))
    return await quantityTestInstance.photo(parseQuantityPhotoReadQuery(getQuery(event)), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) {
    throwQuantityError(cause)
  }
})
