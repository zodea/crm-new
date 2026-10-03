import { createError, defineEventHandler, readBody } from 'h3'
import { productionSession, throwProductionStorageError } from '../../utils/production-runtime'
import { productionSupplierRuntime } from '../../utils/production-supplier-runtime'
import { throwProjectReadError } from '../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const body: unknown = await readBody(event)
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !('commandId' in body) || typeof body.commandId !== 'string')
      throw createError({ statusCode: 422, message: '请提供原提交编号。' })
    const runtime = productionSupplierRuntime()
    if (!runtime)
      throw createError({ statusCode: 503, message: '当前未启用正式分供方存储。' })
    return await runtime.suppliers.resolveCommand(body.commandId, productionSession(event))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
