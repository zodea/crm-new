import { customerReadTestInstance } from '../../utils/customer-read-test-instance'
import { throwProjectReadError } from '../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    return await customerReadTestInstance.list(getQuery(event), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
