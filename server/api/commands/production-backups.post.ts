import { productionBackupRuntime } from '../../utils/production-backup-runtime'
import { productionSession, throwProductionStorageError } from '../../utils/production-runtime'

export default defineEventHandler(async (event) => {
  try {
    const session = productionSession(event)
    session()
    const service = productionBackupRuntime()
    if (!service)
      throw createError({ statusCode: 503, message: '备份只在已配置的本机保存模式提供。' })
    return await service.execute(await readBody(event), session)
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throw cause
  }
})
