import { once } from 'node:events'
import { createServer } from 'node:http'
import * as h3 from 'h3'
import { afterEach, expect, it, vi } from 'vitest'
import { createPayrollRepository } from '~/lib/payroll/central-repository'
import { createPayrollC2ServiceFixture } from '../helpers/payroll-c2-service-fixture'

const runtime = vi.hoisted(() => ({ service: null as Awaited<ReturnType<typeof createPayrollC2ServiceFixture>>['service'] | null }))
vi.mock('../../server/utils/payroll-runtime', () => ({
  get payrollService() {
    return runtime.service
  },
}))
afterEach(() => vi.unstubAllGlobals())
it.each(Array.from([[0.0000001, '0.0000001'], [1e21, '1000000000000000000000'], [350.125, '350.125']] as const).map(input1 => ({ input1 })))('真实HTTP贯通签工与C2空态、半工、主体配置、唯一核对发放及冻结，价保原精度而金额到分：输入案例 %#', async ({ input1: [unitRate, expected] }) => {
  const f = await createPayrollC2ServiceFixture()
  runtime.service = f.service
  for (const name of ['defineEventHandler', 'getQuery', 'getHeader', 'getRouterParam', 'readBody', 'createError'] as const) vi.stubGlobal(name, h3[name])
  const app = h3.createApp()
  const router = h3.createRouter()
  router.get('/api/read/payroll/daywork', (await import('../../server/api/read/payroll/daywork.get')).default)
  router.post('/api/read/payroll/daywork-form', (await import('../../server/api/read/payroll/daywork-form.post')).default)
  router.post('/api/commands/payroll-daywork', (await import('../../server/api/commands/payroll-daywork.post')).default)
  router.post('/api/read/payroll/c2-form', (await import('../../server/api/read/payroll/c2-form.post')).default)
  router.get('/api/read/payroll/c2-config', (await import('../../server/api/read/payroll/c2-config.get')).default)
  router.get('/api/read/payroll/c2-output', (await import('../../server/api/read/payroll/c2-output.get')).default)
  router.post('/api/commands/payroll-c2', (await import('../../server/api/commands/payroll-c2.post')).default)
  router.get('/api/read/payroll/:id', (await import('../../server/api/read/payroll/[id].get')).default)
  app.use(router)
  const server = createServer(h3.toNodeListener(app))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('HTTP地址不可用')
  const base = `http://127.0.0.1:${address.port}`
  const wire: unknown[] = []
  const repo = createPayrollRepository(async (path, options) => {
    const url = new URL(path, base)
    for (const [key, value] of Object.entries(options?.query ?? {})) {
      if (value !== undefined)
        url.searchParams.set(key, String(value))
    }
    const response = await fetch(url, { method: options?.method ?? 'GET', headers: { 'content-type': 'application/json' }, ...(options?.body ? { body: JSON.stringify(options.body) } : {}) })
    const value = await response.json()
    wire.push(value)
    if (!response.ok)
      throw Object.assign(new Error('请求失败'), { data: value.data ?? value })
    return value
  })
  try {
    const empty = await repo.dayworkList({ origin: 'real' }, { projectId: '', month: '', crewId: null, dayworkStatuses: [] })
    expect(empty.options.projects).toHaveLength(2)
    expect(empty.records).toEqual([])
    expect((await repo.dayworkForm({ origin: 'real' }, { recordId: null, draftKey: 'empty-daywork' })).draft.projectId).toBe('')
    expect((await repo.c2Config({ origin: 'real' }, { projectId: '', leaderWorkerId: '' })).options.projects).toHaveLength(2)
    const cfg = await repo.c2Config({ origin: 'real' }, { projectId: 'p', leaderWorkerId: 'w' })

    const current = await repo.c2Config({ origin: 'real' }, cfg.scope)
    await repo.executeC2(f.c2Command(current, { kind: 'save-c2-config', config: { crewId: 'crew', unitRate, ruleText: '' } }))
    expect((await repo.c2Config({ origin: 'real' }, cfg.scope)).config?.unitRate).toBe(unitRate)
    expect(wire.at(-1)).toMatchObject({ config: { unitRate: expected } })
    const workflowConfig = await repo.c2Config({ origin: 'real' }, cfg.scope)
    await repo.executeC2(f.c2Command(workflowConfig, { kind: 'save-c2-config', config: { crewId: 'crew', unitRate: 350.125, ruleText: '' } }))
    const exponentCommand = f.c2Command(await repo.c2Config({ origin: 'real' }, cfg.scope), { kind: 'save-c2-config', config: { crewId: 'crew', unitRate: 0.0000001, ruleText: '' } })
    const exponentResponse = await fetch(`${base}/api/commands/payroll-c2`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...exponentCommand, action: { kind: 'save-c2-config', config: { crewId: 'crew', unitRate: '1e-7', ruleText: '' } } }) })
    expect(exponentResponse.status).toBe(422)
    for (const [index, record] of [{ ...f.record, status: 'confirmed' as const, witness: '现场证明', confirmedOn: '2026-08-03' }, { ...f.record, workerId: 'member', laborUnits: 0.5, endTime: '12:00', status: 'confirmed' as const, witness: '现场证明', confirmedOn: '2026-08-03' }].entries()) {
      const read = await repo.dayworkForm({ origin: 'real' }, { recordId: null, draftKey: `http-daywork-${index}`, draft: record })
      const saved = await repo.executeDaywork(f.dayworkCommand(read, { kind: 'save-daywork', record }))
      expect((await repo.dayworkForm({ origin: 'real' }, { recordId: saved.recordId })).record?.id).toBe(saved.recordId)
    }
    const target = { statementId: null, draftKey: 'http-c2', draft: f.draft } as const
    const preview = await repo.c2Form({ origin: 'real' }, target)
    expect(preview.totals.grossAmount.value).toBe(525.19)
    expect(wire.at(-1)).toMatchObject({ config: { unitRate: '350.125', ruleText: '', original: { unit_rate: 350.125 } }, lines: expect.arrayContaining([expect.objectContaining({ unitPrice: '350.125', amount: '350.13' })]) })
    const saved = await repo.executeC2(f.c2Command(preview, { kind: 'save-c2-draft', draft: f.draft }))
    const read = () => repo.c2Form({ origin: 'real' }, { statementId: saved.statementId! })
    await repo.executeC2(f.c2Command(await read(), { kind: 'check-c2' }))
    await repo.executeC2(f.c2Command(await read(), { kind: 'release-c2', release: { actualAmount: 500, allocations: [{ workerId: 'w', amount: 350 }, { workerId: 'member', amount: 150 }, { workerId: 'zero', amount: 0 }] } }))
    expect((await repo.c2Output({ origin: 'real' }, saved.statementId!)).state).toBe('available')
    const detail = await repo.detail({ origin: 'real' }, saved.statementId!)
    expect(detail.statement).toMatchObject({ formatFamily: 'C2', actualAmount: 500, lines: expect.arrayContaining([expect.objectContaining({ unitPrice: 350.125 })]), stored: { lines: expect.arrayContaining([expect.objectContaining({ unitPrice: 350.125 })]) } })
    const forged = await fetch(`${base}/api/commands/payroll-c2`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...f.c2Command(await read(), { kind: 'check-c2' }), action: { kind: 'check-c2', sourceRecordIds: [] } }) })
    expect(forged.status).toBe(422)
    f.setSession({ workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read'] })
    expect((await repo.dayworkList({ origin: 'real' }, f.scope)).context.readonly).toBe(true)
    await expect(repo.executeC2(f.c2Command(cfg, { kind: 'save-c2-config', config: { crewId: 'crew', unitRate: 360, ruleText: '' } }))).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  }
  finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await f.close()
  }
}, 30_000)
