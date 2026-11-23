/** 合成 HTTP 响应实验：真实路由与异常映射，工作簿服务与会话为受控替身，无数据库或网络监听。 */
import { createApp, createRouter, defineEventHandler, getRouterParam, send, setHeader, toWebHandler } from 'h3'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CentralInvoiceProblem } from '../../app/lib/invoice/central-contract'

const mocks = vi.hoisted(() => ({ allowed: true, fileName: '', read: vi.fn(), bodyAccess: vi.fn() }))
const syntheticBody = 'SYNTHETIC-PRIVATE-WORKBOOK-BYTES'
const syntheticDigest = 'a'.repeat(64)
vi.mock('../../server/utils/production-runtime', () => ({
  productionRuntime: () => ({ storage: {} }),
  productionSession: () => () => ({ workspaceId: 'synthetic-workspace', actorId: 'synthetic-owner', capabilities: mocks.allowed ? ['finance-invoice:read'] : [] }),
  throwProductionStorageError: () => {},
}))
vi.mock('../../server/utils/production-invoice-service', () => ({
  createProductionInvoiceService: () => ({ workbook: async (id: string, session: () => { capabilities: string[] }) => {
    mocks.read(id)
    if (!session().capabilities.includes('finance-invoice:read'))
      throw new CentralInvoiceProblem('forbidden', '当前身份没有发票读取权限。')
    mocks.bodyAccess()
    return { fileName: mocks.fileName, sha256: syntheticDigest, bytes: new TextEncoder().encode(syntheticBody) }
  } }),
}))
vi.mock('../../server/utils/production-invoice-correction-service', () => ({ createProductionInvoiceCorrectionService: vi.fn() }))
vi.stubGlobal('defineEventHandler', defineEventHandler)
vi.stubGlobal('getRouterParam', getRouterParam)
vi.stubGlobal('setHeader', setHeader)
vi.stubGlobal('send', send)
const route = (await import('../../server/api/read/invoice-workbooks/[id].get')).default
const handler = toWebHandler(createApp().use(createRouter().get('/api/read/invoice-workbooks/:id', route)))
const request = () => handler(new Request('http://synthetic.invalid/api/read/invoice-workbooks/book-one'))
beforeEach(() => {
  mocks.allowed = true
  mocks.fileName = ''
  mocks.read.mockClear()
  mocks.bodyAccess.mockClear()
})
afterAll(() => vi.unstubAllGlobals())

describe('合成工作簿下载响应头', () => {
  it.each(['中文.xlsx', '票据😀.xlsx'])('合法名称 %s 可由 UTF-8 扩展参数无损还原', async (fileName) => {
    mocks.fileName = fileName
    const response = await request()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-content-sha256')).toBe(syntheticDigest)
    const disposition = response.headers.get('content-disposition')
    expect(disposition).toMatch(/^attachment; filename\*=UTF-8''/)
    expect(decodeURIComponent(disposition!.split('UTF-8\'\'')[1]!)).toBe(fileName)
    expect(await response.text()).toBe(syntheticBody)
  })

  it('合法名称中的 RFC 8187 保留字符通过百分号编码且可还原', async () => {
    mocks.fileName = '票据\'()*!😀.xlsx'
    const response = await request()
    expect(response.status).toBe(200)
    const disposition = response.headers.get('content-disposition')!
    const encoded = disposition.split('UTF-8\'\'')[1]!
    expect(encoded).not.toMatch(/['()*]/)
    expect(decodeURIComponent(encoded)).toBe(mocks.fileName)
    expect(await response.text()).toBe(syntheticBody)
  })

  it.each(['\uD800.xlsx', '\uDC00.xlsx'])('孤立代理字符返回明确缺口，不伪造或泄露原件', async (fileName) => {
    mocks.fileName = fileName
    const response = await request()
    expect(response.status).toBe(503)
    expect(response.headers.get('content-disposition')).toBeNull()
    const body = await response.text()
    expect(body).toContain('工作簿文件名无法安全编码')
    expect(body).not.toContain(syntheticBody)
    expect(mocks.fileName).toBe(fileName)
  })

  it('无发票读取权限返回 403，不读取或泄露正文', async () => {
    mocks.allowed = false
    mocks.fileName = '合成.xlsx'
    const response = await request()
    expect(response.status).toBe(403)
    expect(response.headers.get('content-disposition')).toBeNull()
    expect(await response.text()).not.toContain(syntheticBody)
    expect(mocks.bodyAccess).not.toHaveBeenCalled()
  })
})
