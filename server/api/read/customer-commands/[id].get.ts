import { productionCustomerSession, requireProductionCustomers } from '../../../utils/production-customer-runtime'
import { throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    return await requireProductionCustomers().command(getRouterParam(event, 'id') ?? '', productionCustomerSession(event))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
