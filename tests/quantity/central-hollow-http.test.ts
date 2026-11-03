import { once } from 'node:events'
import { createServer } from 'node:http'
import * as h3 from 'h3'
import { afterEach, expect, it, vi } from 'vitest'
import { quantityHollowReceiptObserved } from '~/lib/quantity/central-hollow-codec'
import { createQuantityRepository } from '~/lib/quantity/central-repository'
import { createQuantityHollowFixture } from '../helpers/quantity-hollow-fixture'

const runtime = vi.hoisted(() => ({ fixture: null as Awaited<ReturnType<typeof createQuantityHollowFixture>> | null }))
vi.mock('../../server/utils/quantity-runtime', () => ({ get quantityHollowTestInstance() {
  return runtime.fixture!.service
}, quantityTestInstance: { execute: (...args: unknown[]) => runtime.fixture!.quantity.execute(args[0] as never, runtime.fixture!.session()) } }))
afterEach(() => vi.unstubAllGlobals())

it('真实 HTTP 与 Repository 冷读明确零、修订及整改，并按历史确认原回执', async () => {
  const f = await createQuantityHollowFixture()
  runtime.fixture = f
  for (const name of ['defineEventHandler', 'getQuery', 'getHeader', 'readBody', 'createError'] as const) vi.stubGlobal(name, h3[name])
  const router = h3.createRouter()
  router.get('/api/read/quantity/hollow', (await import('../../server/api/read/quantity/hollow.get')).default)
  router.post('/api/commands/quantity', (await import('../../server/api/commands/quantity.post')).default)
  const server = createServer(h3.toNodeListener(h3.createApp().use(router)))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('HTTP地址不可用')
  const repository = createQuantityRepository(async (path, options) => {
    const url = new URL(path, `http://127.0.0.1:${address.port}`)
    for (const [key, value] of Object.entries(options?.query ?? {})) {
      if (value !== undefined)
        url.searchParams.set(key, String(value))
    }
    const response = await fetch(url, { method: options?.method ?? 'GET', headers: { 'content-type': 'application/json' }, signal: options?.signal, ...(options?.body ? { body: JSON.stringify(options.body) } : {}) })
    const body = await response.json()
    if (!response.ok)
      throw Object.assign(new Error('来源请求失败'), { data: body.data ?? body })
    return body
  })
  try {
    const initial = await repository.hollow(f.scope)
    const command = f.command(initial, { kind: 'create-hollow-inspection', target: initial.data.targets[0]!.target, input: { inspectedOn: '2026-09-15', count: 0, note: '本次明确排查零处' } })
    const created = await repository.execute(command)
    const checked = await repository.hollow(f.scope)
    expect(checked.data.records[0]).toMatchObject({ remainingCount: 0, inspection: { input: { count: 0 } }, eligibility: { rectify: { allowed: false } } })
    expect(quantityHollowReceiptObserved(checked, command, created)).toBe(true)
    await repository.execute(f.command(checked, { kind: 'revise-hollow-inspection', recordId: created.hollow.recordId, expectedRevisionId: created.hollow.revisionId, input: { inspectedOn: '2026-09-15', count: 19, note: '复查发现' }, reason: '补全同次检查记录' }))
    const revised = await repository.hollow(f.scope)
    expect(revised.data.records[0]!.revisions.map(row => row.input.count)).toEqual([0, 19])
    expect(quantityHollowReceiptObserved(revised, command, created)).toBe(true)
    const rectification = { kind: 'rectify-hollow-inspection' as const, recordId: created.hollow.recordId, expectedRevisionId: revised.data.records[0]!.inspection.revisionId, rectifiedOn: '2026-09-15', count: 20, note: '超额' }
    await expect(repository.execute(f.command(revised, rectification))).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(repository.execute(f.command(revised, { ...rectification, count: 1, rectifiedOn: '2026-09-14' }))).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect((await repository.hollow(f.scope)).data.records[0]!.remainingCount).toBe(19)
    await repository.execute(f.command(revised, { ...rectification, count: 19, note: '全部整改' }))
    expect((await repository.hollow(f.scope)).data.records[0]).toMatchObject({ remainingCount: 0, rectifiedCount: 19, eligibility: { rectify: { allowed: false } } })
  }
  finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await f.close()
  }
})
