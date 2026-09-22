import { productionCustomerSession, requireProductionCustomers, throwProductionStorageError } from '../../../../utils/production-customer-runtime'
import { throwProjectReadError } from '../../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    return await requireProductionCustomers().audit(getRouterParam(event, 'id') ?? '', productionCustomerSession(event))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
