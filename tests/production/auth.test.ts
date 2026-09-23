import type { Server } from 'node:http'
import { Buffer } from 'node:buffer'
import { scryptSync } from 'node:crypto'
import { once } from 'node:events'
import { createServer, request as rawRequest } from 'node:http'
import { resolve } from 'node:path'
import { createApp, defineEventHandler, readBody, toNodeListener } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import loginHandler from '../../server/api/auth/login.post'
import middleware from '../../server/middleware/production-access'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { logoutProductionOwner, productionAuthStatus, requireProductionBusinessSession } from '../../server/utils/production-auth'
import { getProductionRuntimeConfig } from '../../server/utils/production-config'

const code = 'synthetic-access-code-only'
const salt = '0123456789abcdef0123456789abcdef'
const hash = `scrypt$${salt}$${scryptSync(code, Buffer.from(salt, 'hex'), 64).toString('hex')}`
let server: Server
let origin: string
let sequence = 0

beforeEach(async () => {
  const app = createApp({ debug: false })
  app.use(middleware)
  app.use(defineEventHandler(async (event) => {
    const path = event.path.split('?')[0]
    if (path === '/api/auth/status')
      return productionAuthStatus(event)
    if (path === '/api/auth/login')
      return loginHandler(event)
    if (path === '/api/auth/logout')
      return logoutProductionOwner(event)
    const session = requireProductionBusinessSession(event, { touch: path !== '/api/production/backup/status' })
    if (event.method !== 'GET')
      await readBody(event)
    return session
  }))
  server = createServer(toNodeListener(app))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  for (const [key, value] of Object.entries({
    CRM_RUN_MODE: 'production',
    CRM_DATA_DIRECTORY: resolve('.codex-tmp/issue-450-auth-synthetic'),
    CRM_WORKSPACE_ID: `verification-${++sequence}`,
    CRM_OWNER_ID: 'only-owner',
    CRM_DATA_PURPOSE: 'verification',
    CRM_PUBLIC_ORIGIN: origin,
    CRM_ACCESS_CODE_HASH: hash,
    NITRO_HOST: '127.0.0.1',
  })) vi.stubEnv(key, value)
})

afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
})

function request(path: string, options: { method?: string, cookie?: string, body?: unknown, headers?: Record<string, string> } = {}) {
  return fetch(`${origin}${path}`, {
    method: options.method ?? 'GET',
    headers: { Origin: origin, ...(options.cookie ? { Cookie: options.cookie } : {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  })
}

async function login() {
  const response = await request('/api/auth/login', { method: 'POST', body: { accessCode: code } })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ authenticated: true, ownerId: 'only-owner' })
  const header = response.headers.get('set-cookie')!
  expect(header).toContain('HttpOnly')
  expect(header).toContain('SameSite=Strict')
  expect(header).not.toContain(code)
  return header.split(';')[0]!
}

describe('单人正式访问保护', () => {
  it('后台备份状态轮询不续期，空闲过期后业务读取仍要求重新登录', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const cookie = await login()
    vi.setSystemTime(Date.now() + 29 * 60_000)
    expect((await request('/api/production/backup/status', { cookie })).status).toBe(200)
    vi.setSystemTime(Date.now() + 2 * 60_000)
    expect((await request('/api/read/customers', { cookie })).status).toBe(401)
  })

  it('配置缺失或非回环入口停止处理；不会退回默认操作者', async () => {
    expect(() => resolveBusinessSession()).toThrow('正式业务必须')
    for (const [name, value] of [['CRM_PUBLIC_ORIGIN', 'http://localhost:3100'], ['NITRO_HOST', '0.0.0.0'], ['CRM_ACCESS_CODE_HASH', ''], ['CRM_RUN_MODE', 'productoin']]) {
      const previous = process.env[name!]
      vi.stubEnv(name!, value)
      expect((await request('/api/auth/status')).status).toBe(503)
      vi.stubEnv(name!, previous)
    }
    vi.stubEnv('CRM_RUN_MODE', 'development')
    expect(getProductionRuntimeConfig()).toBeNull()
    expect(resolveBusinessSession().actorId).toBe('actor-default')
  })

  it('登录成功后服务端固定身份，退出和再次登录立即撤销旧会话', async () => {
    expect((await request('/api/read/customers')).status).toBe(401)
    expect((await request('/api/auth/login', { method: 'POST', body: { accessCode: `${code}-wrong` } })).status).toBe(401)
    const first = await login()
    const session = await (await request('/api/read/business-session', { cookie: first, headers: { 'x-actor-id': 'forged' } })).json()
    expect(session).toEqual({ workspaceId: process.env.CRM_WORKSPACE_ID, actorId: 'only-owner', capabilities: ['customer:list:read', 'customer:write', 'customer:original:write', 'customer:lifecycle:write', 'project:list:read', 'project:write', 'project:original:write', 'project:lifecycle:write', 'process-library:read', 'process-library:write'] })
    const second = await login()
    expect((await request('/api/read/customers', { cookie: first })).status).toBe(401)
    expect((await request('/api/auth/logout', { method: 'POST', cookie: second })).status).toBe(200)
    expect((await request('/api/read/customers', { cookie: second })).status).toBe(401)
  })

  it('跨站、假Host和测试/代理头不可突破，未接管API保持关闭', async () => {
    const cookie = await login()
    const falseHost = await new Promise<number>((resolve, reject) => {
      const req = rawRequest(`${origin}/api/commands/customers`, { method: 'POST', headers: { Host: 'evil.example', Cookie: cookie, Origin: origin } }, (response) => {
        response.resume()
        resolve(response.statusCode!)
      })
      req.on('error', reject)
      req.end('{}')
    })
    expect(falseHost).toBe(403)
    for (const headers of [{ Origin: 'https://example.com' }, { 'x-ruihang-test-session': 'fake' }, { 'x-forwarded-for': '127.0.0.1' }, { 'Sec-Fetch-Site': 'cross-site' }])
      expect((await request('/api/commands/customers', { method: 'POST', cookie, body: {}, headers })).status, JSON.stringify(headers)).toBe(403)
    for (const path of ['/api/read/payroll', '/api/testing/customers/reset', '/api/read/customers/bad/id'])
      expect((await request(path, { cookie })).status).toBe(503)
    expect((await request('/api/read/customers?origin=demo', { cookie })).status).toBe(403)
    expect((await request('/api/read/customers?includeDemo=true', { cookie })).status).toBe(403)
    expect((await request('/api/read/customers?origin=all', { cookie })).status).toBe(403)
    expect((await request('/api/read/customer-commands/command-123', { cookie })).status).toBe(200)
    expect((await request('/api/commands/customer-resolve', { method: 'POST', cookie, body: { commandId: 'command-123' } })).status).toBe(200)
    expect((await request('/api/commands/customers/customer-123/lifecycle', { method: 'PUT', cookie, body: {} })).status).toBe(503)
  })

  it('只查状态不会延长空闲时间，身份配置改变后原会话失效', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const start = Date.now()
    const cookie = await login()
    vi.setSystemTime(start + 29 * 60_000)
    expect(await (await request('/api/auth/status', { cookie })).json()).toMatchObject({ authenticated: true })
    vi.setSystemTime(start + 30 * 60_000)
    expect((await request('/api/read/customers', { cookie })).status).toBe(401)
    const next = await login()
    vi.stubEnv('CRM_OWNER_ID', 'another-owner')
    expect((await request('/api/read/customers', { cookie: next })).status).toBe(401)
    expect(await (await request('/api/auth/status', { cookie: next })).json()).toMatchObject({ authenticated: false })
  })

  it('持续操作仍受八小时绝对期限约束；尝试过多受限且不回显访问码', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const start = Date.now()
    const cookie = await login()
    for (let minutes = 29; minutes < 480; minutes += 29) {
      vi.setSystemTime(start + minutes * 60_000)
      expect((await request('/api/read/customers', { cookie })).status).toBe(200)
    }
    vi.setSystemTime(start + 480 * 60_000)
    expect((await request('/api/read/customers', { cookie })).status).toBe(401)
    for (let index = 0; index < 5; index++)
      expect((await request('/api/auth/login', { method: 'POST', body: { accessCode: `${code}-wrong` } })).status).toBe(401)
    const limited = await request('/api/auth/login', { method: 'POST', body: { accessCode: code } })
    expect(limited.status).toBe(429)
    expect(await limited.text()).not.toContain(code)
  })
})
