/** 真实工作簿路由、服务与错误映射；会话和存储为合成替身，不监听、不使用数据库。 */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { createApp, createError, createRouter, defineEventHandler, toWebHandler } from 'h3'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ mode: 'allowed' as 'allowed' | 'expired' | 'origin-denied' | 'no-import', runtimeFailure: null as null | 'h3-401' | 'h3-403' | 'object-401' | 'object-403', calls: 0, onFirst: null as null | (() => void), transaction: vi.fn(), assertWrite: vi.fn() }))
const actor = { workspaceId: 'synthetic-workspace', actorId: 'synthetic-owner', capabilities: ['finance-invoice:read', 'finance-invoice:write', 'finance-invoice:import'] }
const storage = { identity: { workspaceId: actor.workspaceId, actorId: actor.actorId }, withTransaction: state.transaction, assertBusinessWrite: state.assertWrite }
vi.mock('../../server/utils/production-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/production-runtime')>()
  return {
    ...actual,
    productionRuntime: () => {
      if (state.runtimeFailure) {
        const statusCode = state.runtimeFailure.endsWith('401') ? 401 : 403
        if (state.runtimeFailure.startsWith('h3'))
          throw createError({ statusCode, message: 'SYNTHETIC_PRIVATE_FORGED_ERROR', data: { secret: 'SYNTHETIC_PRIVATE_FORGED_DATA' } })
        // eslint-disable-next-line no-throw-literal -- 模拟来源不可信的普通对象，核验不能伪造认证错误。
        throw { statusCode, message: 'SYNTHETIC_PRIVATE_FORGED_ERROR' }
      }
      return { storage }
    },
    productionSession: () => () => {
      state.calls++
      if (state.calls === 1)
        state.onFirst?.()
      if (state.mode === 'expired')
        throw createError({ statusCode: 401, message: '请先输入本机访问码；登录可能已过期。' })
      if (state.mode === 'origin-denied')
        throw createError({ statusCode: 403, message: 'SYNTHETIC_PRIVATE_SESSION_ERROR' })
      return state.mode === 'no-import' ? { ...actor, capabilities: actor.capabilities.filter(cap => cap !== 'finance-invoice:import') } : actor
    },
  }
})
vi.stubGlobal('defineEventHandler', defineEventHandler)
const importRoute = (await import('../../server/api/commands/invoices/import-workbook.post')).default
const correctionRoute = (await import('../../server/api/commands/invoice-corrections/submit-workbook.post')).default
const router = createRouter().post('/api/commands/invoices/import-workbook', importRoute).post('/api/commands/invoice-corrections/submit-workbook', correctionRoute)
const web = toWebHandler(createApp({ debug: false }).use(router))
const bytes = Buffer.from('SYNTHETIC_PRIVATE_WORKBOOK')
const source = { fileName: '合成.xlsx', fileDigest: createHash('sha256').update(bytes).digest('hex'), sheetName: '合成表', rowNumber: 2, rawSnapshot: { 票号: 'SYNTHETIC_PRIVATE_SOURCE' } }
const workbook = { fileName: source.fileName, fileSize: bytes.length, payloadBase64: bytes.toString('base64') }
const common = { workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'synthetic-command', requiredCapability: 'finance-invoice:write' }
const fields = { invoiceNumber: '', invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: null, taxRate: '', remark: '' }
const cases = [
  { name: '导入', path: '/api/commands/invoices/import-workbook', body: { command: { ...common, action: 'import', baseVersion: null, fields, items: [], ownerKind: 'personal', projectId: null, supplierId: null, source, confirmed: true }, mapping: {}, workbook } },
  { name: '补空', path: '/api/commands/invoice-corrections/submit-workbook', body: { command: { ...common, action: 'submit', invoiceId: 'invoice-one', baseInvoiceVersion: '1', correctionId: 'correction-one', baseCorrectionVersion: '1', confirmed: true, workbookSource: { source, mapping: { invoiceNumber: '票号' } } }, workbook } },
] as const
const headers = { 'content-type': 'application/json' }
const request = (path: string, body: unknown) => web(new Request(`http://synthetic.invalid${path}`, { method: 'POST', headers, body: JSON.stringify(body) }))
async function delayed(path: string, body: unknown, nextMode: 'expired' | 'origin-denied' | 'no-import') {
  let notify!: () => void
  const firstAuth = new Promise<void>((resolve) => {
    notify = resolve
  })
  state.onFirst = notify
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(value) { controller = value },
  })
  const encoded = new TextEncoder().encode(JSON.stringify(body))
  const response = web(new Request(`http://synthetic.invalid${path}`, { method: 'POST', headers, body: stream, duplex: 'half' } as RequestInit & { duplex: 'half' }))
  await firstAuth
  const middle = Math.floor(encoded.length / 2)
  controller.enqueue(encoded.subarray(0, middle))
  state.mode = nextMode
  controller.enqueue(encoded.subarray(middle))
  controller.close()
  return response
}
beforeEach(() => {
  state.mode = 'allowed'
  state.runtimeFailure = null
  state.calls = 0
  state.onFirst = null
  state.transaction.mockReset().mockImplementation(() => {
    throw new Error('合成测试禁止进入事务')
  })
  state.assertWrite.mockReset().mockImplementation(() => {
    throw new Error('合成测试禁止写入')
  })
})
afterAll(() => vi.unstubAllGlobals())

describe.each(cases)('$name 工作簿请求的会话边界', ({ path, body }) => {
  it('正常身份会到达关闭的 XML 门禁而不进入事务', async () => {
    const response = await request(path, body)
    expect(response.status).toBe(503)
    const text = await response.text()
    expect(text).toContain('工作簿安全核验暂不可用')
    expect(text).not.toContain('SYNTHETIC_PRIVATE')
    expect(state.calls).toBeGreaterThanOrEqual(2)
    expect(state.transaction).not.toHaveBeenCalled()
    expect(state.assertWrite).not.toHaveBeenCalled()
  })
  it('首次缺少导入权限时 403 且不进入事务', async () => {
    state.mode = 'no-import'
    const response = await request(path, body)
    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain('SYNTHETIC_PRIVATE')
    expect(state.calls).toBe(1)
    expect(state.transaction).not.toHaveBeenCalled()
  })
  it.each(['expired', 'origin-denied'] as const)('首次可信会话 %s 返回安全状态且不泄露异常', async (mode) => {
    state.mode = mode
    const response = await request(path, body)
    expect(response.status).toBe(mode === 'expired' ? 401 : 403)
    expect(await response.text()).not.toContain('SYNTHETIC_PRIVATE')
    expect(state.transaction).not.toHaveBeenCalled()
  })
  it('第一次核验后读取请求体期间会话过期，返回 401 且不进入事务', async () => {
    const response = await delayed(path, body, 'expired')
    expect(state.calls).toBeGreaterThanOrEqual(2)
    expect(await response.text()).not.toContain('SYNTHETIC_PRIVATE')
    expect(state.transaction).not.toHaveBeenCalled()
    expect(state.assertWrite).not.toHaveBeenCalled()
    expect(response.status).toBe(401)
  })
  it('读取请求体期间撤销导入权限，返回 403 且不进入事务', async () => {
    const response = await delayed(path, body, 'no-import')
    expect(state.calls).toBeGreaterThanOrEqual(2)
    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain('SYNTHETIC_PRIVATE')
    expect(state.transaction).not.toHaveBeenCalled()
    expect(state.assertWrite).not.toHaveBeenCalled()
  })
  it('读取请求体期间可信会话拒绝来源，返回固定 403 且不泄露内部消息', async () => {
    const response = await delayed(path, body, 'origin-denied')
    expect(state.calls).toBeGreaterThanOrEqual(2)
    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain('SYNTHETIC_PRIVATE')
    expect(state.transaction).not.toHaveBeenCalled()
    expect(state.assertWrite).not.toHaveBeenCalled()
  })
  it.each(['h3-401', 'h3-403', 'object-401', 'object-403'] as const)('非会话的 %s 保持安全 503，不能透传伪造状态或消息', async (failure) => {
    state.runtimeFailure = failure
    const response = await request(path, body)
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('SYNTHETIC_PRIVATE')
    expect(state.transaction).not.toHaveBeenCalled()
    expect(state.assertWrite).not.toHaveBeenCalled()
  })
})
