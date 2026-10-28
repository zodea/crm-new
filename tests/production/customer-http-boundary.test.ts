import { Buffer } from 'node:buffer'
import { scryptSync } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createApp, createError, createRouter, defineEventHandler, getHeader, getRouterParam, readBody, toNodeListener } from 'h3'
import { afterAll, expect, it, vi } from 'vitest'
import { cleanupTestTempRoot, testTempRoot } from '../helpers/test-temp-root'

afterAll(cleanupTestTempRoot)

it.each(Array.from([{ origin: 'demo' }, { includeDemo: true }, { capabilities: ['customer:write'] }, { commandId: 'with spaces' }, { commandId: 'x'.repeat(81) }]).flatMap(input1 => Array.from([{ origin: 'demo' }, { includeDemo: true }, { commandId: 'with spaces' }]).map(input2 => ({ input1, input2 }))))('生产公开命令在解码前拒绝跨来源、伪能力与无法回查的编号：输入案例 %#', async ({ input1, input2 }) => {
  vi.resetModules()
  const [{ default: middleware }, { loginProductionOwner }, { productionCustomerRuntime }] = await Promise.all([
    import('../../server/middleware/production-access'),
    import('../../server/utils/production-auth'),
    import('../../server/utils/production-customer-runtime'),
  ])
  for (const [key, value] of Object.entries({ defineEventHandler, createError, getHeader, getRouterParam, readBody })) vi.stubGlobal(key, value)
  const create = (await import('../../server/api/commands/customers.post')).default
  const update = (await import('../../server/api/commands/customers/[id].put')).default
  const lifecycle = (await import('../../server/api/commands/customers/[id]/lifecycle.post')).default
  const app = createApp({ debug: false })
  const router = createRouter()
  app.use(middleware)
  router.post('/api/auth/login', defineEventHandler(async event => loginProductionOwner(event, await readBody(event))))
  router.post('/api/commands/customers', create)
  router.put('/api/commands/customers/:id', update)
  router.post('/api/commands/customers/:id/lifecycle', lifecycle)
  app.use(router)
  const server = createServer(toNodeListener(app)).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const base = testTempRoot('legacy-test-artifacts/issue-450-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/http-`)
  const code = 'http-boundary-synthetic-code'
  const salt = '0123456789abcdef0123456789abcdef'
  const accessCodeHash = `scrypt$${salt}$${scryptSync(code, Buffer.from(salt, 'hex'), 64).toString('hex')}`
  for (const [key, value] of Object.entries({ CRM_RUN_MODE: 'production', CRM_DATA_DIRECTORY: directory, CRM_WORKSPACE_ID: 'http-workspace', CRM_OWNER_ID: 'http-owner', CRM_DATA_PURPOSE: 'verification', CRM_PUBLIC_ORIGIN: origin, CRM_ACCESS_CODE_HASH: accessCodeHash, NITRO_HOST: '127.0.0.1' })) vi.stubEnv(key, value)
  let cookie = ''
  const send = (path: string, body: unknown, method = 'POST') => fetch(`${origin}${path}`, { method, headers: { 'Origin': origin, 'Cookie': cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try {
    const login = await send('/api/auth/login', { accessCode: code })
    expect(login.status).toBe(200)
    cookie = login.headers.get('set-cookie')!.split(';')[0]!
    const command = { commandId: 'valid-create-key', workspaceId: 'http-workspace', actorId: 'http-owner', requiredCapability: 'customer:write', baseVersion: null, action: 'save', draft: { name: 'HTTP边界验证', contact: '合成人' }, attachments: {} }

    expect((await send('/api/commands/customers', { ...command, ...input1 })).status, JSON.stringify(input1)).toBe(422)
    const response = await send('/api/commands/customers', command)
    expect(response.status).toBe(200)
    const saved = await response.json()
    expect((await send('/api/commands/customers', { ...command, commandId: 'forged-actor', actorId: 'another-owner' })).status).toBe(403)
    expect((await send('/api/commands/customers', { ...command, draft: { ...command.draft, name: '同键异文' } })).status).toBe(409)
    expect((await send(`/api/commands/customers/${saved.id}`, { ...command, id: saved.id, commandId: 'stale-command', baseVersion: '0' }, 'PUT')).status).toBe(409)
    const lifecycleCommand = { id: saved.id, commandId: 'bad key', workspaceId: command.workspaceId, actorId: command.actorId, requiredCapability: command.requiredCapability, baseVersion: '1', action: 'delete' }
    expect((await send(`/api/commands/customers/${saved.id}/lifecycle`, lifecycleCommand)).status).toBe(422)
    expect((await send(`/api/commands/customers/${saved.id}/lifecycle`, { ...lifecycleCommand, commandId: 'valid-delete', origin: 'demo' })).status).toBe(422)

    expect((await send(`/api/commands/customers/${saved.id}`, { ...command, id: saved.id, baseVersion: '1', commandId: 'valid-update-key', ...input2 }, 'PUT')).status).toBe(422)
    const storage = productionCustomerRuntime()!.storage
    await storage.withTransaction(tx => tx.execute('CREATE TRIGGER fail_http_audit BEFORE INSERT ON customer_audits BEGIN SELECT RAISE(ABORT,\'synthetic-before-commit\'); END'))
    expect((await send(`/api/commands/customers/${saved.id}`, { ...command, id: saved.id, commandId: 'before-commit-failure', baseVersion: '1', draft: { ...command.draft, name: '不可留下的更正' }, attachments: { add: [{ fileName: '不可留下.txt', fileSize: 3, contentBase64: 'YWJj' }] } }, 'PUT')).status).toBe(500)
    await storage.withTransaction(tx => tx.execute('DROP TRIGGER fail_http_audit'))
    expect((await storage.select<{ name: string, version: number }>('SELECT name,version FROM customers'))[0]).toEqual({ name: 'HTTP边界验证', version: 1 })
    expect(await storage.select('SELECT id FROM file_refs')).toEqual([])
    expect((await storage.select('SELECT id FROM customers')).length).toBe(1)
    expect((await storage.select('SELECT command_id FROM customer_command_receipts')).length).toBe(1)
  }
  finally {
    await productionCustomerRuntime()?.storage.close()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
