import { customerReadTestInstance } from '../../../utils/customer-read-test-instance'
import { productionCustomerRuntime, productionCustomerSession } from '../../../utils/production-customer-runtime'
import { throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const runtime = productionCustomerRuntime()
    if (runtime)
      return await runtime.customers.detail(getRouterParam(event, 'id') ?? '', getQuery(event), productionCustomerSession(event))
    return await customerReadTestInstance.detail(
      getRouterParam(event, 'id') ?? '',
      getQuery(event),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
