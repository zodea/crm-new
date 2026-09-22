import type { BusinessSession } from './business-session'
import type { createDeliveryCommandService } from './delivery-command-service'
import { deliveryProblem } from '../../app/lib/delivery-record/contract'
import { resolveBusinessSession } from './business-session'

type Commands = ReturnType<typeof createDeliveryCommandService>
function queryOrigin(query: Record<string, unknown>, session: BusinessSession, file = false) {
  const allowed = file ? ['origin', 'includeDemo', 'projectId', 'supplierId'] : ['origin', 'includeDemo']
  if (Object.keys(query).some(key => !allowed.includes(key)) || (query.origin !== undefined && query.origin !== 'real' && query.origin !== 'demo')
    || (query.includeDemo !== undefined && ![true, false, 'true', 'false'].includes(query.includeDemo as boolean | string))) {
    throw deliveryProblem('invalid-query', '送货读取参数无效')
  }
  const origin = query.origin ?? 'real'
  if (origin === 'demo') {
    if (query.includeDemo !== true && query.includeDemo !== 'true')
      throw deliveryProblem('forbidden', '请先明确开启演示数据')
    if (!session.capabilities.includes('demo:read'))
      throw deliveryProblem('forbidden', '无演示数据读取权限')
  }
  return origin
}

/** URL 仅表达读取意图，当前会话、祖先关系及正文归属仍由服务端重验。 */
export function createDeliveryReadService(commands: Commands, sessionFor: (sessionId?: string | null) => BusinessSession = resolveBusinessSession) {
  function detail(id: string, query: Record<string, unknown>, sessionId?: string | null) {
    const session = sessionFor(sessionId)
    const origin = queryOrigin(query, session)
    const record = commands.detail(id, session, sessionId)
    if (record.dataOrigin !== origin)
      throw deliveryProblem('not-found', '该来源的送货记录不存在')
    return record
  }
  return {
    session: sessionFor,
    context(query: Record<string, unknown>, sessionId?: string | null) {
      const session = sessionFor(sessionId)
      const origin = queryOrigin(query, session)
      const result = commands.context(session, sessionId)
      return { ...result, projects: result.projects.filter(row => row.dataOrigin === origin), suppliers: result.suppliers.filter(row => row.dataOrigin === origin), capabilities: origin === 'real' ? result.capabilities : result.capabilities.filter(cap => cap !== 'delivery:write') }
    },
    list(query: Record<string, unknown>, sessionId?: string | null) {
      const session = sessionFor(sessionId)
      const origin = queryOrigin(query, session)
      if (!session.capabilities.includes('project:list:read'))
        throw deliveryProblem('forbidden', '无送货关联项目读取权限')
      const result = commands.list(session, sessionId, origin)
      return { ...result, records: result.records.filter(row => row.dataOrigin === origin), capabilities: origin === 'real' ? result.capabilities : result.capabilities.filter(cap => cap !== 'delivery:write') }
    },
    detail,
    history(id: string, query: Record<string, unknown>, sessionId?: string | null) {
      detail(id, query, sessionId)
      return commands.history(id, sessionFor(sessionId), sessionId)
    },
    fileContent(id: string, assetId: string, query: Record<string, unknown>, sessionId?: string | null) {
      const session = sessionFor(sessionId)
      queryOrigin(query, session, true)
      const record = detail(id, { origin: query.origin, includeDemo: query.includeDemo }, sessionId)
      if (query.projectId !== record.projectId || (query.supplierId ?? null) !== record.supplierId)
        throw deliveryProblem('relationship-mismatch', '送货原件请求归属已变化，请重新读取记录')
      return { ...commands.fileContent(id, assetId, session, sessionId), recordId: record.id, origin: record.dataOrigin, ownerType: 'delivery_record' as const, projectId: record.projectId, supplierId: record.supplierId, sourceVersion: record.version }
    },
  }
}
