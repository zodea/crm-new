import { once } from 'node:events'
import { createServer } from 'node:http'
import * as h3 from 'h3'
import { afterEach, expect, it, vi } from 'vitest'
import { encodePayrollHollowWire } from '../../app/lib/payroll/central-hollow-deduction-codec'
import { createPayrollRepository } from '../../app/lib/payroll/central-repository'
import { createPayrollHollowFixture } from '../helpers/payroll-hollow-fixture'

const runtime = vi.hoisted(() => ({ service: null as Awaited<ReturnType<typeof createPayrollHollowFixture>>['service'] | null }))
vi.mock('../../server/utils/payroll-runtime', () => ({ payrollServiceForEvent: () => runtime.service }))
afterEach(() => vi.unstubAllGlobals())

it.each(Array.from([null, [], 'real']).map(input1 => ({ input1 })))('真实HTTP配置、启动及冻结沿Repository同源往返，非法范围和客户端自报扣款不写入：输入案例 %#', async ({ input1: query }) => {
  const f = await createPayrollHollowFixture()
  runtime.service = f.service
  for (const name of ['defineEventHandler', 'getQuery', 'getHeader', 'readBody', 'createError'] as const)
    vi.stubGlobal(name, h3[name])
  const router = h3.createRouter()
  router.post('/api/read/payroll/a-form', (await import('../../server/api/read/payroll/a-form.post')).default)
  router.get('/api/read/payroll/a-output', (await import('../../server/api/read/payroll/a-output.get')).default)
  router.post('/api/read/payroll/hollow-config', (await import('../../server/api/read/payroll/hollow-config.post')).default)
  router.post('/api/commands/payroll-a', (await import('../../server/api/commands/payroll-a.post')).default)
  router.post('/api/commands/payroll-hollow', (await import('../../server/api/commands/payroll-hollow.post')).default)
  const app = h3.createApp().use(router)
  const server = createServer(h3.toNodeListener(app))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('本地HTTP地址不可用')
  const base = `http://127.0.0.1:${address.port}`
  const repo = createPayrollRepository(async (path, options) => {
    const url = new URL(path, base)
    for (const [key, value] of Object.entries(options?.query ?? {})) {
      if (value !== undefined)
        url.searchParams.set(key, String(value))
    }
    const response = await fetch(url, { method: options?.method ?? 'GET', headers: { 'content-type': 'application/json' }, ...(options?.body ? { body: JSON.stringify(options.body) } : {}) })
    const data = await response.json()
    if (!response.ok)
      throw Object.assign(new Error('空鼓工资请求失败'), { data: data.data ?? data })
    return data
  })
  try {
    const scope = { projectId: f.draft.projectId, crewId: f.draft.crewId, leaderWorkerId: f.draft.leaderWorkerId, formatFamily: 'A' as const, book: f.draft.book! }
    const configQuery = { scope, month: f.draft.month }
    const config = await repo.hollowConfig({ origin: 'real' }, configQuery)
    expect(config.policies.find(policy => policy.itemId === f.target.itemId)?.unitAmount).toBe(30)
    const policyCommand = { commandId: 'hollow-http-price', workspaceId: config.context.workspaceId, actorId: config.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: config.context.sourceVersion, projectId: f.draft.projectId, target: null, config: configQuery, action: { kind: 'save-hollow-policies' as const, policies: [{ policyId: null, baseRevisionId: null, itemId: f.target.itemId, enabled: true, unitAmount: 30.125, effectiveMonth: f.draft.month }] } }
    const policyResult = await repo.executeHollow(policyCommand)
    expect(await repo.executeHollow(policyCommand)).toEqual(policyResult)
    expect((await repo.hollowConfig({ origin: 'real' }, configQuery)).policies.find(policy => policy.itemId === f.target.itemId)?.unitAmount).toBe(30.125)

    const response = await fetch(`${base}/api/read/payroll/hollow-config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, config: configQuery }) })
    expect(response.status).toBe(400)
    const initial = await repo.aForm({ origin: 'real' }, { statementId: null, draftKey: 'hollow-http-new', draft: f.draft })
    const saved = await repo.execute(f.command(initial, { kind: 'save-a-draft', draft: f.draft }))
    const statementId = saved.statementId!
    const form = () => repo.aForm({ origin: 'real' }, { statementId })
    const command = f.startCommand((await form()).hollow!)
    const forged = { ...command, action: { kind: 'start-hollow-deduction', count: 1, amount: 30 } }
    const rejected = await fetch(`${base}/api/commands/payroll-hollow`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(encodePayrollHollowWire(forged)) })
    expect(rejected.status).toBe(422)
    expect(await f.db.select('SELECT id FROM payroll_hollow_starts')).toEqual([])
    const started = await repo.executeHollow(command)
    expect(await repo.executeHollow(command)).toEqual(started)
    const read = await form()
    expect(read.hollow?.totals.currentDeduction.value).toBe(451.88)
    expect(read.totals.grossAmount.value).toBe(548.12)
    await repo.execute(f.command(read, { kind: 'check-a' }))
    await repo.execute(f.command(await form(), { kind: 'release-a', release: { actualAmount: 548.12, allocations: [{ workerId: f.draft.leaderWorkerId, amount: 548.12 }] } }))
    const output = await repo.aOutput({ origin: 'real' }, statementId)
    expect(output.state).toBe('available')
    expect(output.document?.hollow?.adoptions[0]?.line).toMatchObject({ count: 15, unitAmount: 30.125, amount: 451.88 })
    f.setSession({ ...f.session(), capabilities: ['payroll:read'] })
    await expect(repo.executeHollow(command)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(await f.db.select('SELECT record_id FROM payroll_hollow_adoptions')).toEqual([{ record_id: f.recordId }])
  }
  finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await f.close()
  }
}, 30_000)
