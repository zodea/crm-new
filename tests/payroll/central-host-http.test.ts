import { once } from 'node:events'
import { createServer } from 'node:http'
import * as h3 from 'h3'
import { afterEach, expect, it, vi } from 'vitest'
import { createHttpCrewWorkerReadRepository } from '~/lib/crew-worker/http-repository'
import { createHttpProjectListRepository } from '~/lib/project/http-repository'
import { createPayrollHostFixture } from '../helpers/payroll-host-fixture'

const runtime = vi.hoisted(() => ({ people: null as Awaited<ReturnType<typeof createPayrollHostFixture>>['people'] | null, project: null as Awaited<ReturnType<typeof createPayrollHostFixture>>['project'] | null }))
vi.mock('../../server/utils/crew-worker-read-test-instance', async importOriginal => ({
  ...await importOriginal<object>(),
  get crewWorkerReadTestInstance() { return runtime.people },
}))
vi.mock('../../server/utils/project-read-test-instance', async importOriginal => ({
  ...await importOriginal<object>(),
  get projectReadTestInstance() { return runtime.project },
}))
afterEach(() => vi.unstubAllGlobals())

it('真实三个详情HTTP接口受控读取同一退40后960，撤工资权限不返回来源或姓名', async () => {
  const f = await createPayrollHostFixture()
  runtime.people = f.people
  runtime.project = f.project
  for (const name of ['defineEventHandler', 'getQuery', 'getHeader', 'getRouterParam', 'createError'] as const) vi.stubGlobal(name, h3[name])
  const router = h3.createRouter()
  router.get('/api/read/crews/:id', (await import('../../server/api/read/crews/[id].get')).default)
  router.get('/api/read/workers/:id', (await import('../../server/api/read/workers/[id].get')).default)
  router.get('/api/read/projects/:id', (await import('../../server/api/read/projects/[id].get')).default)
  const server = createServer(h3.toNodeListener(h3.createApp().use(router)))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('HTTP地址不可用')
  let wire: unknown
  const fetcher = async (path: string, options?: { query?: Record<string, unknown> }) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}?${new URLSearchParams(Object.entries(options?.query ?? {}).map(([key, value]) => [key, String(value)]))}`)
    wire = await response.json()
    if (!response.ok)
      throw Object.assign(new Error('请求失败'), { data: wire })
    return wire
  }
  const people = createHttpCrewWorkerReadRepository({ fetcher })
  const projects = createHttpProjectListRepository({ fetcher })
  try {
    const adjustment = await f.payroll.correct()
    await f.payroll.refund(adjustment.adjustment.id, 40)
    const worker = await people.getWorker({ id: 'w', origin: 'real', includeDemo: false })
    expect(worker.payrollActual?.netAmount.value).toBe(960)
    expect(wire).toMatchObject({ payrollActual: { netAmount: { value: '960.00' } } })
    expect((await people.getCrew({ id: 'crew', origin: 'real', includeDemo: false })).payrollActual?.netAmount.value).toBe(960)
    expect((await projects.get({ id: 'p', origin: 'real', includeDemo: false })).payrollActual?.netAmount.value).toBe(960)
    const before = f.readCount()
    await expect(people.getWorker({ id: 'unknown', origin: 'real', includeDemo: false })).rejects.toMatchObject({ problem: { code: 'not-found' } })
    expect(f.readCount()).toBe(before)
    f.setCapabilities(['worker:list:read', 'crew:list:read', 'project:list:read'])
    const denied = await people.getWorker({ id: 'w', origin: 'real', includeDemo: false })
    expect(denied.payrollActual).toMatchObject({ status: 'forbidden', rows: [], netAmount: { value: null, knownValue: null } })
    expect(JSON.stringify(denied.payrollActual)).not.toContain(f.payroll.statementId)
    expect(f.readCount()).toBe(before)
  }
  finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await f.close()
  }
}, 30_000)

it('异步读取期间撤目标页权限或更换档案版本拒绝整份旧响应，同步事实接缝保持同步', async () => {
  const f = await createPayrollHostFixture()
  try {
    expect(f.people.facts()).not.toBeInstanceOf(Promise)
    expect(f.project.facts()).not.toBeInstanceOf(Promise)
    expect(f.project.identities()).not.toBeInstanceOf(Promise)
    f.setAfterRead(() => f.setCapabilities(['payroll:read', 'crew:list:read', 'project:list:read']))
    await expect(f.people.workerDetail('w', { origin: 'real' })).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    f.setCapabilities(['payroll:read', 'crew:list:read', 'worker:list:read', 'project:list:read'])
    f.setAfterRead(f.changeVersion)
    await expect(f.people.crewDetail('crew', { origin: 'real' })).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await expect(f.project.detail('p', { origin: 'real' })).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  }
  finally { await f.close() }
})
