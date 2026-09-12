import { throwQuantityError } from '../../../utils/quantity-error'
import { parseQuantityPhotoReadQuery } from '../../../utils/quantity-request'
import { quantityTestInstance } from '../../../utils/quantity-runtime'

export default defineEventHandler(async (event) => {
  try {
    return await quantityTestInstance.photo(parseQuantityPhotoReadQuery(getQuery(event)), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) {
    throwQuantityError(cause)
  }
})
