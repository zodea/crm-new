import { productionNotificationRuntime } from '../../utils/production-notification-runtime'
import { productionSession, throwProductionStorageError } from '../../utils/production-runtime'
import { throwProjectReadError } from '../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const runtime = productionNotificationRuntime()
    if (!runtime)
      throw createError({ statusCode: 503, message: '当前真实消息源尚未接入，不会替代为演示已读。' })
    return await runtime.notifications.execute(await readBody(event), productionSession(event))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
