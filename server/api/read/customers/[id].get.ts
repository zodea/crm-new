import { customerReadTestInstance } from '../../../utils/customer-read-test-instance'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    return await customerReadTestInstance.detail(
      getRouterParam(event, 'id') ?? '',
      getQuery(event),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
