import { throwQuantityError } from '../../utils/quantity-error'
import { parseQuantityCommand } from '../../utils/quantity-request'
import { quantityTestInstance } from '../../utils/quantity-runtime'

export default defineEventHandler(async (event) => {
  try {
    return await quantityTestInstance.execute(parseQuantityCommand(await readBody(event)), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) {
    throwQuantityError(cause)
  }
})
