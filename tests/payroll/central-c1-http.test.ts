import { once } from 'node:events'
import { createServer } from 'node:http'
import * as h3 from 'h3'
import { afterEach, expect, it, vi } from 'vitest'
import { decodePayrollRead } from '~/lib/payroll/central-codec'
import { createPayrollRepository } from '~/lib/payroll/central-repository'
import { createPayrollC1ServiceFixture } from '../helpers/payroll-c1-service-fixture'

const runtime = vi.hoisted(() => ({ service: null as Awaited<ReturnType<typeof createPayrollC1ServiceFixture>>['service'] | null }))
vi.mock('../../server/utils/payroll-runtime', () => ({ payrollServiceForEvent: () => runtime.service }))
afterEach(() => vi.unstubAllGlobals())
it.each(Array.from(['lines', 'stored'] as const).map(input1 => ({ input1 })))('真实 HTTP/Repository 贯通考勤、独立费率、C1 核对实发与配对冻结，传输不截工时或费率：输入案例 %#', async ({ input1: section }) => {
  const f = await createPayrollC1ServiceFixture()
  runtime.service = f.service
  for (const name of ['defineEventHandler', 'getQuery', 'getHeader', 'getRouterParam', 'readBody', 'createError'] as const) vi.stubGlobal(name, h3[name])
  const app = h3.createApp()
  const router = h3.createRouter()
  router.get('/api/read/payroll/attendance', (await import('../../server/api/read/payroll/attendance.get')).default)
  router.post('/api/commands/payroll-attendance', (await import('../../server/api/commands/payroll-attendance.post')).default)
  router.post('/api/read/payroll/c1-form', (await import('../../server/api/read/payroll/c1-form.post')).default)
  router.get('/api/read/payroll/c1-config', (await import('../../server/api/read/payroll/c1-config.get')).default)
  router.get('/api/read/payroll/c1-output', (await import('../../server/api/read/payroll/c1-output.get')).default)
  router.post('/api/commands/payroll-c1', (await import('../../server/api/commands/payroll-c1.post')).default)
  router.get('/api/read/payroll/:id', (await import('../../server/api/read/payroll/[id].get')).default)
  app.use(router)
  const server = createServer(h3.toNodeListener(app))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('HTTP 地址不可用')
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
    const initialScope = { projectId: '', month: '', crewId: null }
    const initial = await repo.attendanceMatrix({ origin: 'real' }, initialScope)
    expect(initial.scope).toEqual(initialScope)
    expect(initial.options.projects).toHaveLength(2)
    expect(initial).toMatchObject({ workers: [], records: [], locks: [] })
    const withoutMonth = await repo.attendanceMatrix({ origin: 'real' }, { projectId: 'p', month: '', crewId: null })
    expect(withoutMonth.scope.month).toBe('')
    expect(withoutMonth.options.crews.map(crew => crew.id)).toEqual(['crew'])
    expect(withoutMonth).toMatchObject({ workers: [], records: [], locks: [] })
    await expect(repo.attendanceMatrix({ origin: 'real' }, { projectId: 'p', month: '2026-13', crewId: null })).rejects.toThrow()
    await expect(repo.executeAttendance(f.attendanceCommand(withoutMonth, { workerId: 'w', crewId: 'crew', workDate: '2026-08-01', hours: 8, overtimeHours: 0, workContent: '', note: '' }))).rejects.toThrow()
    const empty = await repo.attendanceMatrix({ origin: 'real' }, { projectId: '', month: '2026-08', crewId: null })
    expect(empty.options.projects).toHaveLength(2)
    expect(empty.records).toEqual([])
    const matrix = await repo.attendanceMatrix({ origin: 'real' }, f.scope)
    await repo.executeAttendance(f.attendanceCommand(matrix, { workerId: 'w', crewId: 'crew', workDate: '2026-08-01', hours: 7.51, overtimeHours: 2, workContent: '小数真实工时', note: '' }))
    const target = { statementId: null, draftKey: 'http-c1', draft: f.draft } as const
    const form = await repo.c1Form({ origin: 'real' }, target)
    expect(form.facts[0]?.hours).toBe(7.51)
    expect(form.rates[0]?.overtimeRate).toBe(60.125)
    expect(wire.at(-1)).toMatchObject({ facts: [{ hours: '7.51', overtimeHours: '2' }], rates: expect.arrayContaining([expect.objectContaining({ workerId: 'w', dailyWage: '481', overtimeRate: '60.125' }), expect.objectContaining({ workerId: 'zero', dailyWage: '0', overtimeRate: '0' })]), totals: { grossAmount: { value: '571.79' } } })
    await repo.executeC1(f.command(await repo.c1Config({ origin: 'real' }, f.scope), { kind: 'save-c1-rates', rates: [{ workerId: 'w', dailyWage: null, overtimeRate: 55 }] }))
    const saved = await repo.executeC1(f.command(await repo.c1Form({ origin: 'real' }, target), { kind: 'save-c1-draft', draft: f.draft }))
    const detail = async (status: string) => {
      const result = await repo.detail({ origin: 'real' }, saved.statementId!)
      const normal = { workerId: 'w', quantity: 7.51, unitPrice: 60.125, amount: 451.54 }
      expect(result.statement).toMatchObject({ status, lines: expect.arrayContaining([expect.objectContaining(normal)]), stored: { lines: expect.arrayContaining([expect.objectContaining(normal)]) } })
      const normalWire = { workerId: 'w', quantity: '7.51', unitPrice: '60.125', amount: '451.54' }
      expect(wire.at(-1)).toMatchObject({ statement: { grossAmount: '561.54', lines: expect.arrayContaining([expect.objectContaining(normalWire)]), stored: { lines: expect.arrayContaining([expect.objectContaining(normalWire)]) } } })
      return wire.at(-1)
    }
    await detail('draft')
    const read = () => repo.c1Form({ origin: 'real' }, { statementId: saved.statementId! })
    await repo.executeC1(f.command(await read(), { kind: 'check-c1' }))
    await repo.executeC1(f.command(await read(), { kind: 'release-c1', release: { actualAmount: 500, allocations: [{ workerId: 'w', amount: 500 }, { workerId: 'member', amount: 0 }, { workerId: 'zero', amount: 0 }] } }))
    const releasedWire = await detail('released')

    const malformed = structuredClone(releasedWire) as { statement: { lines: { amount: string }[], stored: { lines: { amount: string }[] } } }
    const lines = section === 'lines' ? malformed.statement.lines : malformed.statement.stored.lines
    lines[0]!.amount = '451.541'
    expect(() => decodePayrollRead(malformed, 'detail', { origin: 'real' }, saved.statementId!)).toThrow()
    const otherFormat = structuredClone(releasedWire) as { statement: { formatFamily: string } }
    otherFormat.statement.formatFamily = 'A'
    expect(() => decodePayrollRead(otherFormat, 'detail', { origin: 'real' }, saved.statementId!)).toThrow()
    const output = await repo.c1Output({ origin: 'real' }, saved.statementId!)
    expect(output.state).toBe('available')
    if (output.state === 'available') {
      expect(output.document.attendance[0]?.hours).toBe(7.51)
      expect(output.document.grossAmount).toBe(561.54)
      expect(output.document.actualAmount).toBe(500)
      expect(output.document.members).toHaveLength(3)
    }
    const forged = { ...f.command(await read(), { kind: 'check-c1' }), action: { kind: 'check-c1', grossAmount: '0.00', facts: [] } }
    const rejected = await fetch(`${base}/api/commands/payroll-c1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(forged) })
    expect(rejected.status).toBe(422)
    await expect(repo.attendanceMatrix({ origin: 'demo' }, f.scope)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    f.setSession({ workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read'] })
    expect((await repo.c1Config({ origin: 'real' }, f.scope)).context.readonly).toBe(true)
    await expect(repo.executeC1(f.command(form, { kind: 'save-c1-draft', draft: f.draft }))).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  }
  finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await f.close()
  }
})
