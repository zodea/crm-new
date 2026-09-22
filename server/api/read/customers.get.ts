import { customerReadTestInstance } from '../../utils/customer-read-test-instance'
import { productionCustomerRuntime, productionCustomerSession, throwProductionStorageError } from '../../utils/production-customer-runtime'
import { throwProjectReadError } from '../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const runtime = productionCustomerRuntime()
    if (runtime)
      return await runtime.customers.list(getQuery(event), productionCustomerSession(event))
    return await customerReadTestInstance.list(getQuery(event), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
