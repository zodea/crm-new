import type { CustomerLifecycleCommand } from '../../../../../app/lib/customer/production-contract'
import { productionCustomerSession, requireProductionCustomers } from '../../../../utils/production-customer-runtime'
import { throwProductionStorageError } from '../../../../utils/production-runtime'
import { throwProjectReadError } from '../../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const body: CustomerLifecycleCommand = await readBody(event)
    if (body?.id !== getRouterParam(event, 'id'))
      throw createError({ statusCode: 422, statusMessage: 'Customer identity mismatch' })
    return await requireProductionCustomers().executeLifecycle(body, productionCustomerSession(event))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
