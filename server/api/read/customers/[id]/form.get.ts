import { resolveBusinessSession } from '../../../../utils/business-session'
import { customerCommandTestInstance } from '../../../../utils/customer-command-test-instance'
import { throwProjectReadError } from '../../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    return customerCommandTestInstance.form(
      getRouterParam(event, 'id') ?? '',
      resolveBusinessSession(),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
