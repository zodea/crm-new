import { once } from 'node:events'
import { createServer } from 'node:http'
import * as h3 from 'h3'
import { afterEach, expect, it, vi } from 'vitest'
import { createPayrollRepository } from '../../app/lib/payroll/central-repository'
import { createPayrollNumberingFixture, numberingCommand } from '../helpers/payroll-numbering-fixture'

const runtime = vi.hoisted(() => ({ service: null as Awaited<ReturnType<typeof createPayrollNumberingFixture>>['service'] | null }))
vi.mock('../../server/utils/payroll-runtime', () => ({ get payrollService() {
  return runtime.service
} }))
afterEach(() => vi.unstubAllGlobals())
it('真实HTTP读取冻结金额、初始化、正式出具及失响应原键恢复完整往返', async () => {
  const f = await createPayrollNumberingFixture()
  runtime.service = f.service
  for (const name of ['defineEventHandler', 'getHeader', 'readBody', 'createError'] as const) vi.stubGlobal(name, h3[name])
  const app = h3.createApp()
  const router = h3.createRouter()
  router.post('/api/read/payroll/numbering', (await import('../../server/api/read/payroll/numbering.post')).default)
  router.post('/api/commands/payroll-numbering', (await import('../../server/api/commands/payroll-numbering.post')).default)
  app.use(router)
  const server = createServer(h3.toNodeListener(app))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('HTTP地址不可用')
  const base = `http://127.0.0.1:${address.port}`
  let loseResponse = false
  const repo = createPayrollRepository(async (path, options) => {
    const response = await fetch(new URL(path, base), { method: options?.method ?? 'GET', headers: { 'content-type': 'application/json' }, body: JSON.stringify(options?.body) })
    const result = await response.json()
    if (!response.ok)
      throw Object.assign(new Error('编号请求失败'), { data: result.data ?? result })
    if (loseResponse && path === '/api/commands/payroll-numbering') {
      loseResponse = false
      throw new Error('response-lost-after-commit')
    }
    return result
  })
  try {
    const query = { origin: 'real' as const, projectId: 'p' }
    const read = () => repo.numbering(query, f.input)
    const initial = await read()
    expect(initial.document?.actualAmount).toBe(525)
    await repo.executeNumbering(numberingCommand(initial, 'http-number-start', { kind: 'initialize', nextNumber: 128, evidenceNote: '旧纸号已核实127' }))
    const command = numberingCommand(await read(), 'http-official-128', { kind: 'issue' })
    loseResponse = true
    await expect(repo.executeNumbering(command)).rejects.toThrow('项目读取服务暂时不可用，请重试')
    const recovered = await repo.executeNumbering(command)
    expect(recovered.issue?.number).toBe('128')
    expect(await read()).toMatchObject({ settings: { nextNumber: 129 }, issue: recovered.issue, document: { actualAmount: 525 }, eligibility: { canDownload: true } })
    const raw = await (await fetch(`${base}/api/read/payroll/numbering`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, input: f.input }) })).json()
    expect(raw.document.actualAmount).toBe('525.00')
    const malformed = await fetch(`${base}/api/commands/payroll-numbering`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...command, officialNumber: 999 }) })
    expect(malformed.status).toBe(422)
    await expect(repo.numbering(query, { ...f.input, projectId: 'other-project' })).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
    expect(await f.db.select('SELECT * FROM payroll_official_issues')).toHaveLength(1)
  }
  finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await f.close()
  }
}, 30_000)
