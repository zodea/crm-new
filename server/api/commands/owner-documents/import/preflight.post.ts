import { createError, defineEventHandler, readBody } from 'h3'
import { productionOwnerDocumentRuntime } from '../../../../utils/production-owner-document-runtime'
import { throwProductionStorageError } from '../../../../utils/production-runtime'
import { throwProjectReadError } from '../../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const production = productionOwnerDocumentRuntime(event)
    if (!production)
      throw createError({ statusCode: 503, message: '商务完整来源正式迁入尚未启用' })
    return await production.migration.preflight(await readBody(event))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
