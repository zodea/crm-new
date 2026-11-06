import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { describe, expect, it, vi } from 'vitest'
import { createCentralInvoiceHttp } from '~/lib/invoice/central-http'
import { createCentralInvoicePrintSession, createCentralInvoiceSession } from '~/lib/invoice/central-session'

const identity = { workspaceId: 'synthetic-workspace', actorId: 'synthetic-actor' }
const capabilities = ['finance-invoice:read', 'finance-invoice:write']
const at = '2026-01-01T00:00:00.000Z'
function invoice(id = 'invoice-001'): CentralInvoiceRecord {
  return {
    id,
    version: '2',
    sourceKind: 'manual',
    fields: { invoiceNumber: id, invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: null, taxRate: '', remark: '' },
    items: [],
    unrecognizedPageIndexes: [],
    ocrStatus: 'pending',
    completionMethod: null,
    reviewStatus: 'unreviewed',
    accountStatus: 'none',
    duplicateStatus: 'normal',
    printCount: 1,
    printRotation: 0,
    ownerKind: null,
    projectId: null,
    supplierId: null,
    contract: null,
    archivedAt: null,
    original: null,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  }
}
function evidence(revision: string) {
  const sourceVersion = 'read-synthetic'
  const meta = { schemaVersion: 'invoice-read-v1', ...identity, dataOrigin: 'real', asOf: at, sourceVersion, sources: [{ key: 'invoices', state: 'readable', sourceVersion: `invoices:${revision}`, asOf: at }], authorizedScope: { coverage: 'complete', fingerprint: 'scope-synthetic' }, capabilities: [...capabilities] }
  return { dataOrigin: 'real', asOf: at, sourceVersion, capabilities: [...capabilities], meta }
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('发票 HTTP 来源修订安全边界（合成响应）', () => {
  it.each(['0', '1', '01', '0000', '9007199254740991'])('合法来源 %s 在列表和详情均可读取', async (revision) => {
    const client = createCentralInvoiceHttp(async url => url === '/api/read/invoices'
      ? { ...evidence(revision), items: [invoice()], pagination: { requestedPage: 1, page: 1, pageSize: 100, total: 1 } }
      : { ...evidence(revision), record: invoice() }, identity)
    expect((await client.list({ page: 1, pageSize: 100 })).meta.sources[0]?.sourceVersion).toBe(`invoices:${revision}`)
    expect((await client.get('invoice-001')).meta.sources[0]?.sourceVersion).toBe(`invoices:${revision}`)
  })

  for (const kind of ['list', 'detail'] as const) {
    it.each(['-1', '+1', '1.0', '', 'abc', '9007199254740992'])(`${kind} 拒绝非法来源 %s`, async (revision) => {
      const client = createCentralInvoiceHttp(async url => url === '/api/read/invoices'
        ? { ...evidence(revision), items: [invoice()], pagination: { requestedPage: 1, page: 1, pageSize: 100, total: 1 } }
        : { ...evidence(revision), record: invoice() }, identity)
      const read = kind === 'list' ? client.list({ page: 1, pageSize: 100 }) : client.get('invoice-001')
      await expect(read).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    })
  }

  it.each([
    { revision: '9007199254740991', allowed: true },
    { revision: '0001', allowed: true },
    { revision: '9007199254740992', allowed: false },
  ])('预检复用同一来源校验：$revision', async ({ revision, allowed }) => {
    const client = createCentralInvoiceHttp(async () => ({ ...evidence(revision), candidates: [] }), identity)
    const input = { fields: invoice().fields, items: [], source: { fileName: '合成.xlsx', fileDigest: 'a'.repeat(64), sheetName: '合成', rowNumber: 2, rawSnapshot: {} } }
    if (allowed)
      expect((await client.previewImport(input)).candidates).toEqual([])
    else
      await expect(client.previewImport(input)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  })

  it.each(['ordinary', 'print'] as const)('%s 已记录原编号后收到超限详情，必须保留原号并在修复后只核对原号', async (kind) => {
    let revision = '9007199254740992'
    let gated = true
    const entered = deferred()
    const gate = deferred()
    const data = new Map<string, string>()
    const storage = () => ({
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value) },
      removeItem: (key: string) => { data.delete(key) },
    })
    const ordinaryReceipt = { commandId: 'synthetic-command', invoiceId: 'invoice-001', version: '2', originalId: null, updatedAt: at }
    const printReceipt = { commandId: 'synthetic-command', updatedAt: at, records: [{ invoiceId: 'invoice-001', version: '2', printCount: 1, printRotation: 0 }] }
    const fetcher = vi.fn<Parameters<typeof createCentralInvoiceHttp>[0]>(async (url) => {
      if (url === '/api/commands/invoices')
        return ordinaryReceipt
      if (url === '/api/commands/invoices/print')
        return printReceipt
      if (url === '/api/commands/invoices/resolve')
        return { outcome: 'applied', result: ordinaryReceipt }
      if (url === '/api/commands/invoices/print-resolve')
        return { outcome: 'applied', result: printReceipt }
      if (url === '/api/read/invoices/invoice-001') {
        if (gated) {
          entered.resolve()
          await gate.promise
          gated = false
        }
        return { ...evidence(revision), record: invoice() }
      }
      throw new Error(`拒绝未知合成请求 ${url}`)
    })
    const repository = createCentralInvoiceHttp(fetcher, identity)
    const context = async () => ({ ...identity, capabilities: [...capabilities] })
    const ordinary = createCentralInvoiceSession({ identity, targetId: 'invoice-001', repository, context, storage })
    const print = createCentralInvoicePrintSession({ identity, repository, context, storage })
    const session = kind === 'ordinary' ? ordinary : print
    const common = { ...identity, commandId: 'synthetic-command', requiredCapability: 'finance-invoice:write' as const }
    const pending = kind === 'ordinary'
      ? ordinary.submit({ ...common, action: 'edit', invoiceId: 'invoice-001', baseVersion: '1', fields: invoice().fields, items: [] })
      : print.submit({ ...common, action: 'record-printed', targets: [{ invoiceId: 'invoice-001', baseVersion: '1', rotation: 0 }] })
    const settled = pending.then(() => ({ status: 'resolved' as const }), error => ({ status: 'rejected' as const, error }))
    await entered.promise
    expect(session.pending()?.commandId).toBe('synthetic-command')
    gate.resolve()
    const result = await settled
    expect(session.pending()?.commandId).toBe('synthetic-command')
    expect(result).toMatchObject({ status: 'rejected', error: { problem: { code: 'unavailable' } } })
    revision = '2'
    expect(await session.recover()).toMatchObject({ outcome: 'applied', result: { commandId: 'synthetic-command' } })
    expect(session.pending()).toBeNull()
    const writeUrl = kind === 'ordinary' ? '/api/commands/invoices' : '/api/commands/invoices/print'
    const resolveUrl = kind === 'ordinary' ? '/api/commands/invoices/resolve' : '/api/commands/invoices/print-resolve'
    expect(fetcher.mock.calls.filter(([url]) => url === writeUrl)).toHaveLength(1)
    expect(fetcher.mock.calls.filter(([url]) => url === resolveUrl)[0]?.[1]?.body).toEqual({ commandId: 'synthetic-command' })
  })
})
