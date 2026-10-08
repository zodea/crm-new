import type { H3Event } from 'h3'
import type { BusinessSession } from './business-session'
import type { ProductionRuntimeConfig } from './production-config'
import { Buffer } from 'node:buffer'
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { createError, deleteCookie, getCookie, getHeader, setCookie } from 'h3'
import { PRODUCTION_AUXILIARY_CONTRACT_CAPABILITIES } from './production-auxiliary-contract-schema'
import { PRODUCTION_BOQ_CAPABILITIES } from './production-boq-access'
import { getProductionRuntimeConfig } from './production-config'
import { PRODUCTION_CONSTRUCTION_CONTRACT_CAPABILITIES } from './production-construction-contract-access'
import { PRODUCTION_CONSTRUCTION_SCOPE_CAPABILITIES } from './production-construction-scope-access'
import { PRODUCTION_CREW_WORKER_CAPABILITIES } from './production-crew-worker-access'
import { FINANCE_CAPABILITIES, FINANCE_IMPORT_CAPABILITY } from './production-finance-access'
import { PRODUCTION_MATERIAL_CONTRACT_CAPABILITIES } from './production-material-contract-access'
import { PRODUCTION_MATERIAL_QUOTATION_CAPABILITIES } from './production-material-quotation-access'
import { PRODUCTION_OTHER_SETTLEMENT_CAPABILITIES } from './production-other-settlement-access'
import { PRODUCTION_PAYROLL_CAPABILITIES } from './production-payroll-access'
import { PRODUCTION_PROCESS_LIBRARY_CAPABILITIES } from './production-process-library-access'
import { PRODUCTION_PROJECT_CAPABILITIES } from './production-project-access'
import { PRODUCTION_QUANTITY_CAPABILITIES } from './production-quantity-access'
import { PRODUCTION_SUBCONTRACT_CONTRACT_CAPABILITIES } from './production-subcontract-contract-access'
import { PRODUCTION_SUPPLIER_CAPABILITIES } from './production-supplier-access'
import { PRODUCTION_TARGET_COST_CAPABILITIES } from './production-target-cost-access'
import { PRODUCTION_WBS_CAPABILITIES } from './production-wbs-access'

const COOKIE = 'ruihang_owner_session'
const ABSOLUTE_MS = 8 * 60 * 60 * 1000
const IDLE_MS = 30 * 60 * 1000
const OWNER_CAPABILITIES = Object.freeze([...new Set(['customer:list:read', 'customer:write', 'customer:original:write', 'customer:lifecycle:write', ...PRODUCTION_PROJECT_CAPABILITIES, ...PRODUCTION_PROCESS_LIBRARY_CAPABILITIES, ...PRODUCTION_SUPPLIER_CAPABILITIES, ...PRODUCTION_MATERIAL_CONTRACT_CAPABILITIES, ...PRODUCTION_MATERIAL_QUOTATION_CAPABILITIES, ...PRODUCTION_OTHER_SETTLEMENT_CAPABILITIES, ...FINANCE_CAPABILITIES, FINANCE_IMPORT_CAPABILITY, ...PRODUCTION_CREW_WORKER_CAPABILITIES, ...PRODUCTION_TARGET_COST_CAPABILITIES, ...PRODUCTION_PAYROLL_CAPABILITIES, ...PRODUCTION_QUANTITY_CAPABILITIES, ...PRODUCTION_WBS_CAPABILITIES, ...PRODUCTION_CONSTRUCTION_CONTRACT_CAPABILITIES, ...PRODUCTION_BOQ_CAPABILITIES, ...PRODUCTION_CONSTRUCTION_SCOPE_CAPABILITIES, ...PRODUCTION_SUBCONTRACT_CONTRACT_CAPABILITIES, ...PRODUCTION_AUXILIARY_CONTRACT_CAPABILITIES, 'our-signatory:read', 'our-signatory:write'])])
interface OwnerSession { configuration: string, created: number, used: number }
// Authentication is intentionally revoked by a process restart; business receipts live on disk.
const sessions = new Map<string, OwnerSession>()
let attempts: { configuration: string, until: number, count: number } | undefined
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const configurationKey = (config: ProductionRuntimeConfig) => digest(JSON.stringify(config))
function denied(statusCode: number, message: string): never {
  throw createError({ statusCode, message })
}

export function assertProductionRequest(event: H3Event, config: ProductionRuntimeConfig): void {
  const address = event.node.req.socket.remoteAddress
  if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(address ?? '') || getHeader(event, 'host') !== new URL(config.origin).host)
    denied(403, '本期仅允许从这台电脑的固定入口访问。')
  if (Object.keys(event.node.req.headers).some(name => name.startsWith('x-ruihang-test') || name.startsWith('x-forwarded-') || name === 'forwarded'))
    denied(403, '正式入口不接受测试或代理身份。')
  if (getHeader(event, 'sec-fetch-site') === 'cross-site')
    denied(403, '请从本机固定入口操作。')
  if (!['GET', 'HEAD'].includes(event.method) && getHeader(event, 'origin') !== config.origin)
    denied(403, '提交来源不匹配，请重新打开本机入口。')
}

function currentSession(event: H3Event, config: ProductionRuntimeConfig, touch: boolean): OwnerSession | null {
  const token = getCookie(event, COOKIE)
  if (!token || !/^[\w-]{43}$/.test(token))
    return null
  const key = digest(token)
  const session = sessions.get(key)
  const now = Date.now()
  if (!session || session.configuration !== configurationKey(config) || now - session.created >= ABSOLUTE_MS || now - session.used >= IDLE_MS) {
    sessions.delete(key)
    return null
  }
  if (touch)
    session.used = now
  return session
}

export function productionAuthStatus(event: H3Event) {
  const config = getProductionRuntimeConfig()
  if (!config)
    return { mode: 'development' as const, authenticated: false }
  assertProductionRequest(event, config)
  const session = currentSession(event, config, false)
  return { mode: 'production' as const, authenticated: Boolean(session), purpose: config.purpose, ...(session ? { ownerId: config.ownerId, expiresAt: new Date(session.created + ABSOLUTE_MS).toISOString() } : {}) }
}

export function requireProductionBusinessSession(event: H3Event, options: { touch?: boolean } = {}): BusinessSession {
  const config = getProductionRuntimeConfig()
  if (!config)
    return denied(503, '正式会话只能用于正式运行模式。')
  assertProductionRequest(event, config)
  if (!currentSession(event, config, options.touch !== false))
    denied(401, '请先输入本机访问码；登录可能已过期。')
  return { workspaceId: config.workspaceId, actorId: config.ownerId, capabilities: OWNER_CAPABILITIES }
}

export async function loginProductionOwner(event: H3Event, input: unknown) {
  const config = getProductionRuntimeConfig()
  if (!config)
    return denied(404, '当前模式不提供本机登录。')
  assertProductionRequest(event, config)
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || !('accessCode' in input) || typeof input.accessCode !== 'string' || input.accessCode.length < 12 || input.accessCode.length > 256)
    return denied(400, '请输入完整访问码（12至256个字符）。')
  const key = configurationKey(config)
  const now = Date.now()
  if (!attempts || attempts.configuration !== key || attempts.until <= now)
    attempts = { configuration: key, until: now + 60_000, count: 0 }
  if (++attempts.count > 5)
    return denied(429, '尝试次数较多，请一分钟后再试。')
  const [, salt, expected] = config.accessCodeHash.split('$')
  const actual = await new Promise<Buffer>((resolve, reject) => scrypt(input.accessCode as string, Buffer.from(salt!, 'hex'), 64, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }, (error, bytes) => error ? reject(error) : resolve(bytes)))
  if (!timingSafeEqual(actual, Buffer.from(expected!, 'hex')))
    return denied(401, '访问码不正确。')
  const latestConfig = getProductionRuntimeConfig()
  if (!latestConfig || configurationKey(latestConfig) !== key)
    return denied(401, '运行配置已变化，请重新登录。')
  const token = randomBytes(32).toString('base64url')
  sessions.clear()
  sessions.set(digest(token), { configuration: key, created: Date.now(), used: Date.now() })
  setCookie(event, COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: false, path: '/', maxAge: ABSOLUTE_MS / 1000 })
  return { mode: 'production' as const, authenticated: true, purpose: config.purpose, ownerId: config.ownerId, expiresAt: new Date(Date.now() + ABSOLUTE_MS).toISOString() }
}

export function logoutProductionOwner(event: H3Event) {
  const config = getProductionRuntimeConfig()
  if (!config)
    return denied(404, '当前模式不提供本机登录。')
  assertProductionRequest(event, config)
  const token = getCookie(event, COOKIE)
  if (token)
    sessions.delete(digest(token))
  deleteCookie(event, COOKIE, { httpOnly: true, sameSite: 'strict', secure: false, path: '/' })
  return { authenticated: false }
}
