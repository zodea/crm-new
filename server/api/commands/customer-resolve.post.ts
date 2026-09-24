import { productionCustomerSession, requireProductionCustomers } from '../../utils/production-customer-runtime'
import { throwProductionStorageError } from '../../utils/production-runtime'
import { throwProjectReadError } from '../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const body: unknown = await readBody(event)
    if (!body || typeof body !== 'object' || Object.keys(body).join(',') !== 'commandId' || typeof (body as { commandId?: unknown }).commandId !== 'string')
      throw createError({ statusCode: 422, statusMessage: 'Invalid command identity' })
    return await requireProductionCustomers().resolveCommand((body as { commandId: string }).commandId, productionCustomerSession(event))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
