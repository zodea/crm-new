import type { PayrollADraft, PayrollAFormRead } from '../../app/lib/payroll/central-a-contract'
import { once } from 'node:events'
import { createServer } from 'node:http'
import * as h3 from 'h3'
import { afterEach, expect, it, vi } from 'vitest'
import { decodePayrollARead, encodePayrollAWire } from '../../app/lib/payroll/central-a-codec'
import { createPayrollRepository } from '../../app/lib/payroll/central-repository'
import { createPayrollHollowFixture } from '../helpers/payroll-hollow-fixture'

const runtime = vi.hoisted(() => ({ service: null as Awaited<ReturnType<typeof createPayrollHollowFixture>>['service'] | null }))
vi.mock('../../server/utils/payroll-runtime', () => ({ payrollServiceForEvent: () => runtime.service }))
afterEach(() => vi.unstubAllGlobals())

type HollowFixture = Awaited<ReturnType<typeof createPayrollHollowFixture>>
it.each([
  (read: PayrollAFormRead, f: HollowFixture) => ({ ...read, draft: f.draft }),
  (read: PayrollAFormRead) => ({ ...read, hollow: { ...read.hollow, state: 'available' } }),
  (read: PayrollAFormRead) => ({ ...read, hollow: { ...read.hollow, eligibility: { canStart: true, reasons: [] } } }),
])('首次新建 A 缺负责人保持未知空鼓依据，拒绝提升资格：%#', async (makeForged) => {
  const f = await createPayrollHollowFixture()
  try {
    const read = await f.service.aForm({ origin: 'real' }, {
      statementId: null,
      draftKey: 'incomplete-a-hollow',
      draft: { projectId: f.draft.projectId, month: f.draft.month, crewId: null },
    })
    expect(read.blockers).toContainEqual(expect.objectContaining({ code: 'members-incomplete' }))
    expect(read.eligibility).toMatchObject({ canSaveDraft: false, canCheck: false, canRelease: false })
    expect(read.hollow).toMatchObject({ state: 'unavailable', scope: null })
    expect(read.totals.grossAmount).toMatchObject({ state: 'unknown', value: null })
    const input = { statementId: null, draftKey: read.draftKey!, draft: read.draft }
    // 尚未选全的分支不能冒充完整主体，或被响应中的可启动标记提升权限。
    const forged = makeForged(read, f)
    expect(() => decodePayrollARead(encodePayrollAWire(forged), 'form', { origin: 'real' }, input)).toThrow()
  }
  finally {
    await f.close()
  }
})

it.each([
  () => ({}),
  (draft: PayrollADraft) => ({ projectId: draft.projectId, month: draft.month, crewId: null }),
  (draft: PayrollADraft) => ({ ...draft, leaderWorkerId: '', memberWorkerIds: [] }),
  (draft: PayrollADraft) => ({ ...draft, month: '' }),
])('空稿、缺项主体与空月份经 HTTP 返回诊断，补齐后恢复核算：%#', async (makeDraft) => {
  const f = await createPayrollHollowFixture()
  runtime.service = f.service
  for (const name of ['defineEventHandler', 'getHeader', 'readBody', 'createError'] as const)
    vi.stubGlobal(name, h3[name])
  const router = h3.createRouter()
  router.post('/api/read/payroll/a-form', (await import('../../server/api/read/payroll/a-form.post')).default)
  const server = createServer(h3.toNodeListener(h3.createApp().use(router)))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('本地 HTTP 地址不可用')
  const repo = createPayrollRepository(async (path, options) => {
    const response = await fetch(new URL(path, `http://127.0.0.1:${address.port}`), {
      method: options?.method ?? 'GET',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(options?.body),
    })
    const data = await response.json()
    expect(response.status).toBe(200)
    return data
  })
  try {
    const draft = makeDraft(f.draft)
    const read = await repo.aForm({ origin: 'real' }, { statementId: null, draftKey: 'incomplete-http-a', draft })
    expect(read.draft).toMatchObject(draft)
    expect(read.blockers.length).toBeGreaterThan(0)
    expect(read.eligibility).toMatchObject({ canSaveDraft: false, canCheck: false, canRelease: false })
    expect(read.hollow).toMatchObject({ state: 'unavailable' })
    expect(read.totals.grossAmount).toMatchObject({ state: 'unknown', value: null })
    const complete = await repo.aForm({ origin: 'real' }, { statementId: null, draftKey: 'incomplete-http-a', draft: f.draft })
    expect(complete.eligibility.canSaveDraft).toBe(true)
    expect(complete.totals.grossAmount.value).toBe(1000)
    expect(complete.hollow?.rows[0]).toMatchObject({ state: 'ready', fact: { remainingCount: 15 } })
  }
  finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await f.close()
  }
})
