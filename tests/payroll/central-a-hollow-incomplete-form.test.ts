import { once } from 'node:events'
import { createServer } from 'node:http'
import * as h3 from 'h3'
import { afterEach, expect, it, vi } from 'vitest'
import { decodePayrollARead, encodePayrollAWire } from '../../app/lib/payroll/central-a-codec'
import { createPayrollRepository } from '../../app/lib/payroll/central-repository'
import { createPayrollHollowFixture } from '../helpers/payroll-hollow-fixture'

const runtime = vi.hoisted(() => ({ service: null as Awaited<ReturnType<typeof createPayrollHollowFixture>>['service'] | null }))
vi.mock('../../server/utils/payroll-runtime', () => ({ get payrollService() {
  return runtime.service
} }))
afterEach(() => vi.unstubAllGlobals())

it('首次新建 A 尚未选择负责人时返回缺项诊断和未知空鼓依据，不能抛出服务错误', async () => {
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
    for (const forged of [
      { ...read, draft: f.draft },
      { ...read, hollow: { ...read.hollow, state: 'available' } },
      { ...read, hollow: { ...read.hollow, eligibility: { canStart: true, reasons: [] } } },
    ])
      expect(() => decodePayrollARead(encodePayrollAWire(forged), 'form', { origin: 'real' }, input)).toThrow()
  }
  finally {
    await f.close()
  }
})

it('空稿、部分主体和清空月份均经真实 HTTP/Repository 返回诊断，补齐选择后恢复原 1000 核算', async () => {
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
    for (const draft of [
      {},
      { projectId: f.draft.projectId, month: f.draft.month, crewId: null },
      { ...f.draft, leaderWorkerId: '', memberWorkerIds: [] },
      { ...f.draft, month: '' },
    ]) {
      const read = await repo.aForm({ origin: 'real' }, { statementId: null, draftKey: 'incomplete-http-a', draft })
      expect(read.draft).toMatchObject(draft)
      expect(read.blockers.length).toBeGreaterThan(0)
      expect(read.eligibility).toMatchObject({ canSaveDraft: false, canCheck: false, canRelease: false })
      expect(read.hollow).toMatchObject({ state: 'unavailable' })
      expect(read.totals.grossAmount).toMatchObject({ state: 'unknown', value: null })
    }
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
