import type { EventHandler } from 'h3'
import type { CentralFinanceKind } from '../../app/lib/finance/central-contract'
import { createServer } from 'node:http'
import { createApp, createRouter, defineEventHandler, getQuery, getRouterParam, toNodeListener } from 'h3'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

vi.mock('../../server/utils/finance-api', async (load) => {
  const actual = await load<typeof import('../../server/utils/finance-api')>()
  const result = (kind: CentralFinanceKind, operation: string, id?: string) => ({ scope: { kind, operation, ...(id ? { id } : {}) } })
  return {
    ...actual,
    // Only domain facts are substituted here; actual handlers and Nitro's h3
    // routing precedence determine whether an endpoint reaches its owner.
    financeApi: () => ({
      session: () => ({ workspaceId: 'routing-workspace', actorId: 'routing-owner', capabilities: [] }),
      finance: {
        context: (kind: CentralFinanceKind) => result(kind, 'context'),
        list: (kind: CentralFinanceKind) => ({ ...result(kind, 'list'), items: [] }),
        form: (kind: CentralFinanceKind, id: string) => result(kind, 'form', id),
        paymentDetail: (id: string) => ({ ...result('payment_application', 'detail', id), detail: { id } }),
      },
    }),
  }
})

const handlers = import.meta.glob<{ default: EventHandler }>('../../server/api/read/finance/**/*.get.ts')
const server = createServer()
let origin = ''
beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', defineEventHandler)
  vi.stubGlobal('getQuery', getQuery)
  vi.stubGlobal('getRouterParam', getRouterParam)
  const router = createRouter({ preemptive: true })
  for (const [file, load] of Object.entries(handlers)) {
    const route = file.replace('../../server', '').replace(/\.get\.ts$/, '').replace(/\[([^\]]+)\]/g, ':$1')
    router.use(route, (await load()).default, 'get')
  }
  const app = createApp().use(router).use(defineEventHandler(() => '<!DOCTYPE html><title>SPA fallback</title>'))
  server.on('request', toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('财务路由测试未获得本机端口')
  origin = `http://127.0.0.1:${address.port}`
})
afterAll(async () => {
  if (server.listening)
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  vi.unstubAllGlobals()
})

it.each(['current', 'reimbursement', 'payment_application', 'payment_record', 'invoice_application'] as const)('%s 的读取分派保留同域 JSON 与参数，不被详情路由遮挡', async (kind) => {
  for (const operation of ['context', 'list', 'form/routing-record']) {
    const response = await fetch(`${origin}/api/read/finance/${kind}/${operation}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toMatchObject({ scope: { kind, operation: operation.split('/')[0], ...(operation.startsWith('form/') ? { id: 'routing-record' } : {}) } })
  }
})
it('付款申请详情保留原公开路径，其他财务类型不能借详情端点扩大读取范围', async () => {
  const response = await fetch(`${origin}/api/read/finance/payment_application/detail/routing-record`)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ scope: { kind: 'payment_application', operation: 'detail', id: 'routing-record' }, detail: { id: 'routing-record' } })
  for (const kind of ['current', 'reimbursement', 'payment_record', 'invoice_application']) {
    const rejected = await fetch(`${origin}/api/read/finance/${kind}/detail/routing-record`)
    expect(rejected.status).toBe(400)
    expect(await rejected.json()).toMatchObject({ data: { code: 'invalid-query' } })
  }
})
