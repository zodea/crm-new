import { once } from 'node:events'
import { createServer } from 'node:http'
import * as h3 from 'h3'
import { afterEach, expect, it, vi } from 'vitest'
import { hasPayrollAFeesForm } from '~/lib/payroll/central-a-fees-contract'
import { createPayrollRepository } from '~/lib/payroll/central-repository'
import { createPayrollAServiceFixture } from '../helpers/payroll-a-service-fixture'

const runtime = vi.hoisted(() => ({ service: null as Awaited<ReturnType<typeof createPayrollAServiceFixture>>['service'] | null }))
vi.mock('../../server/utils/payroll-runtime', () => ({ payrollServiceForEvent: () => runtime.service }))
afterEach(() => vi.unstubAllGlobals())
it.each(Array.from([{ projectId: '', month: '2026-08', crewId: null }, { projectId: '', leaderWorkerId: '', month: '', memberWorkerIds: [] }]).flatMap(input1 => Array.from([
  { projectId: 'unknown-project', month: '2026-08' },
  { projectId: 'unknown-project', month: '2026-08', book: { bookPurpose: 'ordinary' as const, managementBookId: null } },
  { projectId: '', month: '', book: { bookPurpose: 'management' as const, managementBookId: 'selected-management' } },
]).map(input2 => ({ input1, input2 }))))('a HTTP/Repository往返保数量精度、明确零与固定目标，拒绝客户端伪造来源和未知动作：输入案例 %#', async ({ input1: emptyDraft, input2: invalidDraft }) => {
  const f = await createPayrollAServiceFixture()
  runtime.service = f.service
  for (const name of ['defineEventHandler', 'getQuery', 'getHeader', 'readBody', 'createError'] as const)
    vi.stubGlobal(name, h3[name])
  const app = h3.createApp()
  const router = h3.createRouter()
  router.post('/api/read/payroll/a-form', (await import('../../server/api/read/payroll/a-form.post')).default)
  router.get('/api/read/payroll/a-config', (await import('../../server/api/read/payroll/a-config.get')).default)
  router.get('/api/read/payroll/a-output', (await import('../../server/api/read/payroll/a-output.get')).default)
  router.post('/api/commands/payroll-a', (await import('../../server/api/commands/payroll-a.post')).default)
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
    const result = await response.json()
    wire.push(result)
    if (!response.ok)
      throw Object.assign(new Error('工资请求失败'), { data: result.data ?? result })
    return result
  })
  try {
    // 台账直接新建，以及清空选择后重新预览，必须能读取候选而不是先被请求校验挡住。

    const initial = await repo.aForm({ origin: 'real' }, { statementId: null, draftKey: 'empty-form', draft: emptyDraft })
    expect(initial.draft.projectId).toBe('')
    expect(initial.options.projects.map(project => project.id)).toEqual(['p'])
    expect(initial.options.workers).toEqual([])
    expect(initial.members).toEqual([])
    expect(initial.eligibility.canSaveDraft).toBe(false)
    expect(initial.blockers).toContainEqual(expect.objectContaining({ code: 'project-unavailable' }))
    await expect(repo.execute(f.command(initial, { kind: 'save-a-draft', draft: { ...f.draft, projectId: '', leaderWorkerId: '' } }))).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    // 项目失效或清空选择时保留用途草稿，返回明确未知的费用依据，供页面继续修正选择。

    const invalidProject = await repo.aForm({ origin: 'real' }, { statementId: null, draftKey: 'invalid-project', draft: invalidDraft })
    expect(invalidProject.draft.projectId).toBe(invalidDraft.projectId)
    expect(invalidProject.draft.book).toEqual(invalidDraft.book ?? { bookPurpose: 'ordinary', managementBookId: null })
    expect(invalidProject.options.projects.map(project => project.id)).toEqual(['p'])
    expect(invalidProject.eligibility).toMatchObject({ canSaveDraft: false, canCheck: false, canRelease: false, canOutput: false })
    expect(invalidProject.blockers).toContainEqual(expect.objectContaining({ code: 'project-unavailable' }))
    expect(hasPayrollAFeesForm(invalidProject)).toBe(true)
    if (!hasPayrollAFeesForm(invalidProject))
      throw new Error('费用草稿缺少明确的不可用读取状态')
    expect(invalidProject.bookProof).toMatchObject({ state: 'unproven', book: null })
    expect(invalidProject.fees).toBeNull()
    expect(invalidProject.bookEligibility).toMatchObject({ canSave: false, canCheck: false, canRelease: false })
    expect(Object.values(invalidProject.totals).every(amount => amount.state === 'unknown' && amount.value === null && amount.reasons.length > 0)).toBe(true)
    await expect(repo.aForm({ origin: 'real' }, { statementId: null, draftKey: 'invalid-identity', draft: { projectId: 'invalid project' } })).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect(await f.db.select('SELECT * FROM wage_statements')).toEqual([])
    const scope = { projectId: 'p', month: '2026-08', crewId: 'crew', leaderWorkerId: 'w' }
    const config = await repo.aConfig({ origin: 'real' }, scope)
    await f.db.execute('INSERT INTO items(id,project_id,code,name,trade,unit) VALUES(\'item\',\'p\',\'WALL\',\'墙砖\',\'泥工\',\'㎡\')')
    await repo.execute(f.command(config, { kind: 'save-a-prices', prices: [{ priceId: null, itemId: 'item', unit: '㎡', mode: 'baseline', workerId: null, effectiveMonth: '2026-08', unitPrice: 0, scope: { kind: 'project' } }] }))
    f.facts.rows[0]!.fieldQty = 8.123456
    const input = { statementId: null, draftKey: 'new-a', draft: f.draft } as const
    const form = await repo.aForm({ origin: 'real' }, input)
    expect(form.facts[0]?.fieldQty).toBe(8.123456)
    expect(form.lines[0]?.unitPrice).toBe(0)
    expect(form.totals.workAmount).toMatchObject({ value: 0, state: 'known' })
    expect(wire.at(-1)).toMatchObject({ facts: [{ fieldQty: '8.123456' }], lines: [{ unitPrice: '0.00' }], totals: { workAmount: { value: '0.00' } } })
    const saved = await repo.execute(f.command(form, { kind: 'save-a-draft', draft: f.draft }))
    expect((await repo.aForm({ origin: 'real' }, { statementId: saved.statementId! })).statementId).toBe(saved.statementId)
    expect((await repo.aOutput({ origin: 'real' }, saved.statementId!)).state).toBe('unavailable')
    const forged = { ...f.command(form, { kind: 'check-a' }), action: { kind: 'check-a', previouslyPaid: '0.00', facts: [] } }
    const response = await fetch(`${base}/api/commands/payroll-a`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(forged) })
    expect(response.status).toBe(422)
    await expect(repo.aForm({ origin: 'demo' }, input)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    f.setSession({ workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read'] })
    expect((await repo.aForm({ origin: 'real' }, input)).context.readonly).toBe(true)
    await expect(repo.execute(f.command(form, { kind: 'save-a-draft', draft: f.draft }))).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  }
  finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await f.close()
  }
})
