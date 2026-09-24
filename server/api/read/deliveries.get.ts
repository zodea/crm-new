import { deliveryReadTestInstance } from '../../utils/delivery-runtime'
import { throwProjectReadError } from '../../utils/project-read-error'

export default defineEventHandler((event) => {
  try {
    return deliveryReadTestInstance.list(getQuery(event), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
