import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { createCentralInvoiceHttp } from '~/lib/invoice/central-http'
import { createCentralInvoiceWorkspace } from '~/lib/invoice/central-workspace'

/** 完全内存中的固定合成数据；没有服务、数据库、文件或真实发票。 */
export async function syntheticOriginalFixture(mode: 'good' | 'digest' | 'length' | 'forbidden' | 'revoked' | 'changed' | 'delay' = 'good', fileName = '合成.png') {
  let currentMode = mode
  const raw = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a92kAAAAASUVORK5CYII=')
  const bytes = Uint8Array.from(raw, char => char.charCodeAt(0))
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('')
  const identity = { workspaceId: 'synthetic-workspace', actorId: 'synthetic-actor' }
  const capabilities = ['finance-invoice:read']
  const asOf = '2026-01-01T00:00:00.000Z'
  const original = { id: 'synthetic-original', fileName, fileSize: bytes.length, mimeType: 'image/png', sha256: hash }
  const record: CentralInvoiceRecord = {
    id: 'synthetic-invoice',
    version: '1',
    sourceKind: 'scan',
    fields: { invoiceNumber: 'SYN-ORIGINAL', invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: null, taxRate: '', remark: '' },
    items: [],
    unrecognizedPageIndexes: [],
    ocrStatus: 'pending',
    completionMethod: null,
    reviewStatus: 'unreviewed',
    accountStatus: 'none',
    duplicateStatus: 'normal',
    printCount: 0,
    printRotation: 0,
    ownerKind: null,
    projectId: null,
    supplierId: null,
    contract: null,
    archivedAt: null,
    original,
    createdAt: asOf,
    updatedAt: asOf,
    deletedAt: null,
  }
  const meta = { schemaVersion: 'invoice-read-v1', ...identity, dataOrigin: 'real', asOf, sourceVersion: 'invoices:1', sources: [{ key: 'invoices', state: 'readable', sourceVersion: 'invoices:1', asOf }], authorizedScope: { coverage: 'complete', fingerprint: 'synthetic-complete' }, capabilities }
  const evidence = { dataOrigin: 'real', meta, asOf, sourceVersion: 'invoices:1', capabilities }
  const events: string[] = []
  let canRead = true
  let details = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const context = async () => {
    events.push('authorize')
    return { ...identity, capabilities: canRead ? capabilities : [] }
  }
  const fetcher = async (url: string) => {
    if (url === '/api/read/invoices') {
      events.push('list')
      return { ...evidence, items: [record], pagination: { requestedPage: 1, page: 1, pageSize: 100, total: 1 } }
    }
    if (url === `/api/read/invoices/${record.id}`) {
      events.push('detail')
      details++
      return { ...evidence, record: currentMode === 'changed' && details > 1 ? { ...record, version: '2' } : record }
    }
    throw new Error(`合成夹具拒绝未知请求 ${url}`)
  }
  const binaryFetch: typeof fetch = async (input, options) => {
    const url = String(input)
    if (url !== `/api/read/invoices/${record.id}/originals/${original.id}` || options?.credentials !== 'same-origin' || options.cache !== 'no-store')
      throw new Error('合成夹具拒绝未预期的原件请求')
    events.push('binary')
    if (currentMode === 'delay')
      await gate
    if (currentMode === 'revoked')
      canRead = false
    if (currentMode === 'forbidden')
      return new Response(null, { status: 403 })
    const returned = bytes.slice()
    if (currentMode === 'digest')
      returned[returned.length - 1] ^= 1
    return new Response(returned, { status: 200, headers: { 'X-Content-SHA256': hash, 'Content-Length': String(currentMode === 'length' ? bytes.length + 1 : bytes.length), 'Content-Type': original.mimeType } })
  }
  const client = createCentralInvoiceHttp(fetcher, identity, binaryFetch)
  const memory = new Map<string, string>()
  const storage = () => ({
    get length() { return memory.size },
    key: (index: number) => [...memory.keys()][index] ?? null,
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value) },
    removeItem: (key: string) => { memory.delete(key) },
  })
  const real = createCentralInvoiceWorkspace({ identity, client, context, storage, recognizeLocal: async () => {
    throw new Error('此测试不识别')
  } })
  await real.load()
  events.length = 0
  // 模拟已加载来源：仅将挂载刷新替换为空操作；原件核验和全部 HTTP 校验为真实实现。
  const workspace = { ...real, load: async () => {} }
  return { record, bytes, hash, events, real, workspace, release, setMode: (next: typeof mode) => {
    currentMode = next
  }, revoke: () => {
    canRead = false
  } }
}
