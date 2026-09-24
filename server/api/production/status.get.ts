import { productionRuntime, productionSession, throwProductionStorageError } from '../../utils/production-runtime'

export default defineEventHandler(async (event) => {
  try {
    productionSession(event)()
    const runtime = productionRuntime()
    if (!runtime)
      throw createError({ statusCode: 503, statusMessage: 'Production storage is not configured' })
    return await runtime.storage.status()
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throw cause
  }
})
