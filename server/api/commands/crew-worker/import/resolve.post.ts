import { createError, defineEventHandler, readBody } from 'h3'
import { productionCrewWorkerRuntime } from '../../../../utils/production-crew-worker-runtime'
import { productionSession, throwProductionStorageError } from '../../../../utils/production-runtime'
import { throwProjectReadError } from '../../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const runtime = productionCrewWorkerRuntime()
    if (!runtime)
      throw createError({ statusCode: 503, message: '原迁入核对需要已认证的正式中央工作区。' })
    return await runtime.migration.resolve(await readBody(event), productionSession(event))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
