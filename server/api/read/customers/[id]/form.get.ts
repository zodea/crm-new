import { resolveBusinessSession } from '../../../../utils/business-session'
import { customerCommandTestInstance } from '../../../../utils/customer-command-test-instance'
import { productionCustomerRuntime, productionCustomerSession } from '../../../../utils/production-customer-runtime'
import { throwProductionStorageError } from '../../../../utils/production-runtime'
import { throwProjectReadError } from '../../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const runtime = productionCustomerRuntime()
    if (runtime)
      return await runtime.customers.form(getRouterParam(event, 'id') ?? '', productionCustomerSession(event))
    return customerCommandTestInstance.form(
      getRouterParam(event, 'id') ?? '',
      resolveBusinessSession(),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
