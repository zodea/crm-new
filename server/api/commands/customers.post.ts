import { resolveBusinessSession } from '../../utils/business-session'
import { parseCustomerCommandRequest } from '../../utils/customer-command-request'
import { customerCommandTestInstance } from '../../utils/customer-command-test-instance'
import { productionCustomerRuntime, productionCustomerSession, throwProductionStorageError } from '../../utils/production-customer-runtime'
import { throwProjectReadError } from '../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const runtime = productionCustomerRuntime()
    if (runtime)
      return await runtime.customers.execute(await readBody(event), productionCustomerSession(event), null)
    return await customerCommandTestInstance.execute(
      parseCustomerCommandRequest(await readBody(event)),
      resolveBusinessSession(),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
