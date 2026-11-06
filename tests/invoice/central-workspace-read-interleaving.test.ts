import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { describe, expect, it, vi } from 'vitest'
import { createCentralInvoiceHttp } from '~/lib/invoice/central-http'
import { createCentralInvoiceWorkspace } from '~/lib/invoice/central-workspace'

const identity = { workspaceId: 'synthetic-workspace', actorId: 'synthetic-actor' }
const granted = ['finance-invoice:read', 'finance-invoice:write']
const at = '2026-01-01T00:00:00.000Z'
const later = '2026-01-01T00:00:01.000Z'
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function invoice(id: string): CentralInvoiceRecord {
  return {
    id,
    version: '1',
    sourceKind: 'manual',
    fields: { invoiceNumber: id, invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: null, taxRate: '', remark: '' },
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
    original: null,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  }
}
function evidence(revision: number, scope: string) {
  const sourceVersion = `read-synthetic-${revision}`
  const meta = { schemaVersion: 'invoice-read-v1', ...identity, dataOrigin: 'real', asOf: at, sourceVersion, sources: [{ key: 'invoices', state: 'readable', sourceVersion: `invoices:${revision}`, asOf: at }], authorizedScope: { coverage: 'complete', fingerprint: scope }, capabilities: [...granted] }
  return { dataOrigin: 'real', asOf: at, sourceVersion, capabilities: [...granted], meta }
}
function fixture() {
  let capabilities = [...granted]
  let revision = 1
  let rows = [invoice('invoice-001'), invoice('invoice-002')]
  let holdList = false
  let holdFollowingList = false
  let failDetail = false
  let holdDetail = false
  let lastReceipt: Record<string, unknown> | undefined
  const writeEntered = deferred()
  const writeGate = deferred()
  const listEntered = deferred()
  const listGate = deferred()
  const followingListEntered = deferred()
  const followingListGate = deferred()
  const detailEntered = deferred()
  const detailGate = deferred()
  const values = new Map<string, string>()
  const storage = () => ({
    get length() { return values.size },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  })
  const fetcher = vi.fn<Parameters<typeof createCentralInvoiceHttp>[0]>(async (url, options) => {
    if (url === '/api/read/invoices') {
      const snapshot = { ...evidence(revision, 'scope-list'), items: structuredClone(rows), pagination: { requestedPage: 1, page: 1, pageSize: 100, total: rows.length } }
      if (holdList) {
        holdList = false
        listEntered.resolve()
        await listGate.promise
      }
      else if (holdFollowingList) {
        holdFollowingList = false
        followingListEntered.resolve()
        await followingListGate.promise
      }
      return snapshot
    }
    if (url === '/api/commands/invoices' || url === '/api/commands/invoices/print') {
      const body = options?.body as { commandId: string, invoiceId?: string, targets?: Array<{ invoiceId: string, rotation: number }> }
      writeEntered.resolve()
      await writeGate.promise
      revision = 2
      rows = rows.map(row => url.endsWith('/print') || row.id === body.invoiceId
        ? { ...row, version: '2', updatedAt: later, printCount: url.endsWith('/print') ? 1 : row.printCount }
        : row)
      lastReceipt = url.endsWith('/print')
        ? { commandId: body.commandId, updatedAt: later, records: body.targets!.map(target => ({ invoiceId: target.invoiceId, version: '2', printCount: 1, printRotation: target.rotation })) }
        : { commandId: body.commandId, invoiceId: body.invoiceId, version: '2', originalId: null, updatedAt: later }
      return structuredClone(lastReceipt)
    }
    if (url === '/api/commands/invoices/resolve' || url === '/api/commands/invoices/print-resolve')
      return { outcome: 'applied', result: structuredClone(lastReceipt) }
    if (url.startsWith('/api/read/invoices/')) {
      const id = decodeURIComponent(url.slice('/api/read/invoices/'.length))
      if (failDetail)
        throw new Error('合成详情回读失败')
      const snapshot = { ...evidence(revision, `scope-detail-${id}`), record: structuredClone(rows.find(row => row.id === id)) }
      if (holdDetail) {
        holdDetail = false
        detailEntered.resolve()
        await detailGate.promise
      }
      return snapshot
    }
    throw new Error(`拒绝未知合成请求 ${url}`)
  })
  const client = createCentralInvoiceHttp(fetcher, identity)
  const workspace = createCentralInvoiceWorkspace({ identity, client, storage, commandId: () => 'synthetic-command', context: async () => ({ ...identity, capabilities: [...capabilities] }), recognizeLocal: async () => {
    throw new Error('未使用识别')
  } })
  return {
    workspace,
    fetcher,
    writeEntered,
    writeGate,
    listEntered,
    listGate,
    followingListEntered,
    followingListGate,
    detailEntered,
    detailGate,
    holdOldList: () => { holdList = true },
    failDetail: (value: boolean) => { failDetail = value },
    holdFollowingList: () => { holdFollowingList = true },
    holdNextDetail: () => { holdDetail = true },
    revokeRead: () => { capabilities = ['finance-invoice:write'] },
  }
}

describe('已开始命令与旧列表读取交错（合成传输）', () => {
  it.each(['ordinary', 'print', 'ordinary-recover', 'print-recover'] as const)('%s 新详情先于旧列表时不得发布旧快照', async (kind) => {
    const f = fixture()
    await f.workspace.load()
    const original = JSON.parse(JSON.stringify(f.workspace.records.value[0])) as CentralInvoiceRecord
    const isPrint = kind.startsWith('print')
    const recovering = kind.endsWith('recover')
    const submitted = isPrint
      ? f.workspace.recordPrinted([{ invoiceId: 'invoice-001', baseVersion: '1', rotation: 0 }, { invoiceId: 'invoice-002', baseVersion: '1', rotation: 0 }])
      : f.workspace.edit(original, original.fields, original.items, () => true)
    const settled = submitted.then(value => ({ status: 'resolved' as const, value }), error => ({ status: 'rejected' as const, error }))
    await f.writeEntered.promise
    expect(isPrint ? f.workspace.pendingPrint()?.commandId : f.workspace.pending(original.id)?.commandId).toBe('synthetic-command')
    f.holdOldList()
    const oldList = f.workspace.load().then(() => null, error => error)
    await f.listEntered.promise
    if (recovering)
      f.failDetail(true)
    f.writeGate.resolve()
    const result = await settled
    if (recovering) {
      expect(result).toMatchObject({ status: 'rejected', error: { message: '合成详情回读失败' } })
      expect(isPrint ? f.workspace.pendingPrint()?.commandId : f.workspace.pending(original.id)?.commandId).toBe('synthetic-command')
      f.failDetail(false)
      const recovered = isPrint ? await f.workspace.recoverPrint() : await f.workspace.recover(original.id)
      expect(recovered).toMatchObject({ outcome: 'applied', result: { commandId: 'synthetic-command' } })
    }
    else {
      expect(result.status).toBe('resolved')
    }
    expect(isPrint ? f.workspace.pendingPrint() : f.workspace.pending(original.id)).toBeNull()
    f.listGate.resolve()
    await oldList
    if (f.workspace.readState.value === 'ready') {
      expect(f.workspace.sourceVersion.value).toBe('read-synthetic-2')
      expect(f.workspace.records.value.map(row => row.version)).toEqual(isPrint ? ['2', '2'] : ['2', '1'])
    }
    else {
      expect(f.workspace.readState.value).toBe('unavailable')
      expect(f.workspace.records.value).toEqual([])
    }
    const writeUrl = isPrint ? '/api/commands/invoices/print' : '/api/commands/invoices'
    expect(f.fetcher.mock.calls.filter(([url]) => url === writeUrl)).toHaveLength(1)
  })

  it('新详情读取中撤销读权，旧列表不得恢复显示且保留原号', async () => {
    const f = fixture()
    await f.workspace.load()
    const original = JSON.parse(JSON.stringify(f.workspace.records.value[0])) as CentralInvoiceRecord
    const submitted = f.workspace.edit(original, original.fields, original.items, () => true)
    const settled = submitted.then(() => null, error => error)
    await f.writeEntered.promise
    f.holdOldList()
    const oldList = f.workspace.load().then(() => null, error => error)
    await f.listEntered.promise
    f.holdNextDetail()
    f.writeGate.resolve()
    await f.detailEntered.promise
    f.revokeRead()
    f.detailGate.resolve()
    expect(await settled).toMatchObject({ problem: { code: 'forbidden' } })
    expect(f.workspace.pending(original.id)?.commandId).toBe('synthetic-command')
    f.listGate.resolve()
    await oldList
    expect(f.workspace.readState.value).toBe('unavailable')
    expect(f.workspace.records.value).toEqual([])
    expect(f.workspace.pending(original.id)?.commandId).toBe('synthetic-command')
    expect(f.fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices')).toHaveLength(1)
  })

  it.each(['complete-first', 'pending'] as const)('取消旧读取后后继读取 %s 不受旧 finally 干扰', async (mode) => {
    const f = fixture()
    await f.workspace.load()
    const original = JSON.parse(JSON.stringify(f.workspace.records.value[0])) as CentralInvoiceRecord
    const submitted = f.workspace.edit(original, original.fields, original.items, () => true)
    await f.writeEntered.promise
    f.holdOldList()
    const oldList = f.workspace.load().then(() => null, error => error)
    await f.listEntered.promise
    f.writeGate.resolve()
    await submitted
    expect(f.workspace.readState.value).toBe('unavailable')
    expect(f.workspace.loading.value).toBe(false)
    expect(f.workspace.pending(original.id)).toBeNull()
    if (mode === 'pending')
      f.holdFollowingList()
    const nextList = f.workspace.load()
    if (mode === 'pending')
      await f.followingListEntered.promise
    else await nextList
    f.listGate.resolve()
    await oldList
    if (mode === 'pending') {
      expect(f.workspace.loading.value).toBe(true)
      expect(f.workspace.readState.value).toBe('loading')
      f.followingListGate.resolve()
      await nextList
    }
    expect(f.workspace.loading.value).toBe(false)
    expect(f.workspace.readState.value).toBe('ready')
    expect(f.workspace.sourceVersion.value).toBe('read-synthetic-2')
    expect(f.workspace.records.value.map(row => row.version)).toEqual(['2', '1'])
    expect(f.fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices')).toHaveLength(1)
  })
})
