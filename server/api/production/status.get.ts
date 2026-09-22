import { productionCustomerRuntime, productionCustomerSession, throwProductionStorageError } from '../../utils/production-customer-runtime'

export default defineEventHandler(async (event) => {
  try {
    productionCustomerSession(event)()
    const runtime = productionCustomerRuntime()
    if (!runtime)
      throw createError({ statusCode: 503, statusMessage: 'Production storage is not configured' })
    return await runtime.storage.status()
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throw cause
  }
})
