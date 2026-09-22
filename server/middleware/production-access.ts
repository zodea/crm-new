import { createError, defineEventHandler, getQuery, setResponseHeader } from 'h3'
import { assertProductionRequest, requireProductionBusinessSession } from '../utils/production-auth'
import { getProductionRuntimeConfig } from '../utils/production-config'

const id = String.raw`[A-Za-z0-9][\w-]{2,79}`
const readyReads = new RegExp(`^/api/read/(?:business-session|customers|customers-deleted|customer-commands/${id}|customers/${id}(?:/(?:form|lifecycle|audit|files/${id}))?)$`)
const readyWrites = new RegExp(`^/api/commands/customers/${id}(?:/lifecycle)?$`)

export default defineEventHandler((event) => {
  const config = getProductionRuntimeConfig()
  if (!config)
    return
  assertProductionRequest(event, config)
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  setResponseHeader(event, 'Referrer-Policy', 'no-referrer')
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  const path = event.path.split('?')[0]!
  if (!path.startsWith('/api/'))
    return
  if ((event.method === 'GET' && path === '/api/auth/status') || (event.method === 'POST' && ['/api/auth/login', '/api/auth/logout'].includes(path)))
    return
  requireProductionBusinessSession(event, { touch: event.method !== 'GET' || path !== '/api/production/backup/status' })
  const query = getQuery(event)
  if ((query.includeDemo !== undefined && query.includeDemo !== 'false') || Object.values(query).some(value => ['demo', 'all'].includes(String(value)) || (Array.isArray(value) && value.some(item => ['demo', 'all'].includes(String(item))))))
    throw createError({ statusCode: 403, message: '正式入口不提供演示数据源。' })
  const ready = (event.method === 'GET' && (readyReads.test(path) || ['/api/production/status', '/api/production/backup/status'].includes(path)))
    || (event.method === 'POST' && (['/api/commands/customers', '/api/commands/customer-resolve'].includes(path) || (readyWrites.test(path) && path.endsWith('/lifecycle'))))
    || (event.method === 'PUT' && readyWrites.test(path) && !path.endsWith('/lifecycle'))
  if (!ready)
    throw createError({ statusCode: 503, message: '此功能的正式保存尚未就绪，请返回客户资料；不会使用测试实例替代。' })
})
