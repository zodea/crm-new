import { createError, defineEventHandler } from 'h3'
import { productionCrewWorkerRuntime } from '../../../utils/production-crew-worker-runtime'
import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const runtime = productionCrewWorkerRuntime()
    if (!runtime)
      throw createError({ statusCode: 503, message: '工人班组迁入需要已认证的正式中央工作区。' })
    return await runtime.migration.state(productionSession(event))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
