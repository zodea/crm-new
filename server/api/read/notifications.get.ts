import { NOTIFICATION_READ_SCHEMA } from '../../../app/lib/notifications/contract'
import { shanghaiBusinessDate } from '../../../app/lib/supplier/credentials'
import { resolveBusinessSession } from '../../utils/business-session'
import { productionNotificationRuntime } from '../../utils/production-notification-runtime'
import { productionSession, throwProductionStorageError } from '../../utils/production-runtime'
import { throwProjectReadError } from '../../utils/project-read-error'
import { createReadMeta, withReadMeta } from '../../utils/read-meta'

export default defineEventHandler(async (event) => {
  try {
    const runtime = productionNotificationRuntime()
    if (runtime)
      return await runtime.notifications.list(getQuery(event), productionSession(event, { touch: false }))
    const actor = resolveBusinessSession(event)
    const query = getQuery(event)
    const numericQuery = (value: unknown) => value === undefined || (typeof value === 'string' && /^[1-9]\d*$/.test(value))
    const requestedPage = query.page === undefined ? 1 : Number(query.page)
    const pageSize = query.pageSize === undefined ? 100 : Number(query.pageSize)
    if (Object.keys(query).some(key => !['page', 'pageSize'].includes(key)) || !numericQuery(query.page) || !numericQuery(query.pageSize)
      || !Number.isSafeInteger(requestedPage) || requestedPage < 1 || ![10, 20, 50, 100].includes(pageSize)) {
      throw createError({ statusCode: 400, message: '消息分页条件无效。' })
    }
    const timestamp = new Date().toISOString()
    const meta = createReadMeta({ session: actor, schemaVersion: NOTIFICATION_READ_SCHEMA, operation: 'notifications-list', dataOrigin: 'real', asOf: timestamp, coverage: 'unknown', scope: {}, sources: [{ key: 'notification-ledger', state: 'unavailable', sourceVersion: null, asOf: null }] })
    return withReadMeta({ dataOrigin: 'real', workspaceId: actor.workspaceId, actorId: actor.actorId, businessDate: shanghaiBusinessDate(new Date(timestamp)), evaluationState: 'unavailable', items: [], unreadCount: 0, pagination: { requestedPage, page: 1, pageSize, total: 0 } }, meta)
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
