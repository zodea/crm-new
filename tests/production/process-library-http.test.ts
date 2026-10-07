import type { ProcessLibraryCreateCommand } from '../../app/lib/schedule/process-library-contract'
import { Buffer } from 'node:buffer'
import { scryptSync } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { createApp, createError, createRouter, defineEventHandler, getHeader, getQuery, getRouterParam, readBody, toNodeListener } from 'h3'
import { expect, it, vi } from 'vitest'
import middleware from '../../server/middleware/production-access'
import { loginProductionOwner } from '../../server/utils/production-auth'
import { productionCustomerRuntime } from '../../server/utils/production-customer-runtime'

for (const [key, value] of Object.entries({ defineEventHandler, createError, getHeader, getQuery, getRouterParam, readBody })) vi.stubGlobal(key, value)
// Load the real handlers before timing the HTTP business journey; no HTTP operation is mocked.
const [{ default: create }, { default: list }, { default: detail }] = await Promise.all([
  import('../../server/api/commands/process-libraries.post'),
  import('../../server/api/read/process-libraries.get'),
  import('../../server/api/read/process-libraries/[id].get'),
])

async function fixture() {
  const router = createRouter()
  const app = createApp({ debug: false }).use(middleware)
  router.post('/api/auth/login', defineEventHandler(async event => loginProductionOwner(event, await readBody(event))))
  router.post('/api/commands/process-libraries', create)
  router.get('/api/read/process-libraries', list)
  router.get('/api/read/process-libraries/:id', detail)
  app.use(router)
  const server = createServer(toNodeListener(app)).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const base = resolve('.tmp/legacy-test-artifacts/issue-463-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/http-`)
  const code = 'process-library-synthetic-access'
  const salt = '0123456789abcdef0123456789abcdef'
  const accessCodeHash = `scrypt$${salt}$${scryptSync(code, Buffer.from(salt, 'hex'), 64).toString('hex')}`
  for (const [key, value] of Object.entries({ CRM_RUN_MODE: 'production', CRM_DATA_DIRECTORY: directory, CRM_WORKSPACE_ID: 'library-workspace', CRM_OWNER_ID: 'library-owner', CRM_DATA_PURPOSE: 'verification', CRM_PUBLIC_ORIGIN: origin, CRM_ACCESS_CODE_HASH: accessCodeHash, NITRO_HOST: '127.0.0.1' })) vi.stubEnv(key, value)
  let cookie = ''
  const request = (path: string, body?: unknown) => fetch(`${origin}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Origin': origin, 'Cookie': cookie, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const login = await request('/api/auth/login', { accessCode: code })
  expect(login.status).toBe(200)
  cookie = login.headers.get('set-cookie')!.split(';')[0]!
  return {
    request,
    async close() {
      await productionCustomerRuntime()?.storage.close()
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}

it('正式公开工序库保存完整版本且同键重复不升号，旧版本仍按稳定身份读取', async () => {
  const f = await fixture()
  try {
    const initial = await f.request('/api/read/process-libraries?origin=real')
    expect(initial.status).toBe(200)
    expect(await initial.json()).toMatchObject({ libraries: [], seriesVersions: {} })
    const command: ProcessLibraryCreateCommand = { action: 'create-version', commandId: 'library-create-first', workspaceId: 'library-workspace', actorId: 'library-owner', origin: 'real', requiredCapability: 'process-library:write', baseVersion: 0, sourceVersion: null, draft: { sourceLibraryId: null, code: 'LIB', name: '正式工序库', description: '完整图冻结', tasks: [{ key: 'later', name: '后序', durationDays: 3, trade: '泥水工', color: '#123456', stageCode: 'S2', itemCodes: ['I2'], predecessorKey: 'first', predecessorDisabled: true }, { key: 'first', name: '前序', durationDays: 2, trade: '木工', color: '#654321', stageCode: 'S1', itemCodes: ['I1'], predecessorKey: null, predecessorDisabled: false }] } }
    const saved = await f.request('/api/commands/process-libraries', command)
    expect(saved.status).toBe(200)
    const result = await saved.json()
    expect(result).toMatchObject({ commandId: command.commandId, version: 1, sourceVersion: '1' })
    const original = await (await f.request(`/api/read/process-libraries/${result.id}?origin=real`)).json()
    expect(original).toMatchObject({ id: result.id, createdBy: 'library-owner', version: 1, usageCount: 0, usageProjects: [], tasks: [{ key: 'later', predecessorKey: 'first', predecessorDisabled: true, itemCodes: ['I2'] }, { key: 'first', predecessorKey: null }] })
    const [stored] = await productionCustomerRuntime()!.storage.select<{ snapshot_json: string }>('SELECT snapshot_json FROM process_library_versions WHERE id=?', [result.id])
    expect(JSON.parse(stored!.snapshot_json)).toMatchObject({ usageCount: null })
    expect(JSON.parse(stored!.snapshot_json)).not.toHaveProperty('usageProjects')
    expect(await (await f.request('/api/commands/process-libraries', command)).json()).toEqual(result)
    const newer = await f.request('/api/commands/process-libraries', { ...command, commandId: 'library-create-second', baseVersion: 1, sourceVersion: '1', draft: { ...command.draft, sourceLibraryId: result.id, name: '第二版名称' } })
    expect(await newer.json()).toMatchObject({ version: 2 })
    expect(await (await f.request(`/api/read/process-libraries/${result.id}?origin=real`)).json()).toEqual(original)
    expect(await productionCustomerRuntime()!.storage.select('SELECT snapshot_json FROM process_library_versions WHERE id=?', [result.id])).toEqual([stored])
    expect(await (await f.request('/api/read/process-libraries?origin=real')).json()).toMatchObject({ seriesVersions: { LIB: 2 }, sourceVersion: '2' })
  }
  finally { await f.close() }
})
