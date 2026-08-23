import { resolveBusinessSession } from '../../../utils/business-session'
import { parseCustomerCommandRequest } from '../../../utils/customer-command-request'
import { customerCommandTestInstance } from '../../../utils/customer-command-test-instance'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id') ?? ''
    return await customerCommandTestInstance.execute(
      parseCustomerCommandRequest(await readBody(event), id),
      resolveBusinessSession(),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
