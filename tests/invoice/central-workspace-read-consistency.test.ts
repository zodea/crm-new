import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { describe, expect, it, vi } from 'vitest'
import { createCentralInvoiceHttp } from '~/lib/invoice/central-http'
import { createCentralInvoiceWorkspace } from '~/lib/invoice/central-workspace'
import { createReadMeta } from '../../server/utils/read-meta'

const identity = { workspaceId: 'synthetic-workspace', actorId: 'synthetic-actor' }
const caps = ['finance-invoice:read', 'finance-invoice:write']
const at = '2026-01-01T00:00:00.000Z'
const later = '2026-01-01T00:00:01.000Z'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function invoice(id: string, version = '1'): CentralInvoiceRecord {
  return {
    id,
    version,
    sourceKind: 'manual',
    fields: { invoiceNumber: id, invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: null, taxRate: '', remark: '' },
    items: [{ name: '合成货物', spec: '', unit: '', quantity: null, unitPrice: null, amount: 0, taxRate: '', taxAmount: null }],
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

function evidence(revision: number, capabilities = caps, options: { actorId?: string, workspaceId?: string, token?: string, scope?: string, asOf?: string } = {}) {
  const asOf = options.asOf ?? at
  const sourceVersion = options.token ?? `read-synthetic-${revision}`
  const meta = {
    schemaVersion: 'invoice-read-v1',
    workspaceId: options.workspaceId ?? identity.workspaceId,
    actorId: options.actorId ?? identity.actorId,
    dataOrigin: 'real' as const,
    asOf,
    sourceVersion,
    sources: [{ key: 'invoices', state: 'readable' as const, sourceVersion: `invoices:${revision}`, asOf }],
    authorizedScope: { coverage: 'complete' as const, fingerprint: options.scope ?? 'scope-synthetic' },
    capabilities: [...capabilities],
  }
  return { dataOrigin: 'real' as const, asOf, sourceVersion, capabilities: [...capabilities], meta }
}

function fixture(initial = [invoice('invoice-001')]) {
  let actor = { ...identity, capabilities: [...caps] }
  let rows = structuredClone(initial)
  let revision = 1
  let listPage: ((page: number) => Record<string, unknown> | Promise<Record<string, unknown>>) | undefined
  let detail: ((id: string) => Promise<Record<string, unknown>>) | undefined
  let detailFails = false
  let lastReceipt: Record<string, unknown> | undefined
  const saved = new Map<string, string>()
  const storage = () => ({
    get length() { return saved.size },
    key: (index: number) => [...saved.keys()][index] ?? null,
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value) },
    removeItem: (key: string) => { saved.delete(key) },
  })
  const fetcher = vi.fn<Parameters<typeof createCentralInvoiceHttp>[0]>(async (url, options) => {
    if (url === '/api/read/invoices') {
      const page = Number(options?.query?.page)
      const response = await listPage?.(page)
      if (response)
        return structuredClone(response)
      return { ...evidence(revision, actor.capabilities, { scope: 'scope-list' }), items: structuredClone(rows.slice((page - 1) * 100, page * 100)), pagination: { requestedPage: page, page, pageSize: 100, total: rows.length } }
    }
    if (url === '/api/commands/invoices') {
      const body = options?.body as { commandId: string, invoiceId: string }
      lastReceipt = { commandId: body.commandId, invoiceId: body.invoiceId, version: '2', originalId: null, updatedAt: later }
      return structuredClone(lastReceipt)
    }
    if (url === '/api/commands/invoices/resolve')
      return { outcome: 'applied', result: structuredClone(lastReceipt) }
    if (url === '/api/commands/invoices/print') {
      const body = options?.body as { commandId: string, targets: Array<{ invoiceId: string, baseVersion: string, rotation: 0 | 90 | 180 | 270 }> }
      lastReceipt = { commandId: body.commandId, updatedAt: later, records: body.targets.map(target => ({ invoiceId: target.invoiceId, version: '2', printCount: 1, printRotation: target.rotation })) }
      return structuredClone(lastReceipt)
    }
    if (url === '/api/commands/invoices/print-resolve')
      return { outcome: 'applied', result: structuredClone(lastReceipt) }
    if (url.startsWith('/api/read/invoices/')) {
      const id = decodeURIComponent(url.slice('/api/read/invoices/'.length))
      if (detailFails)
        throw new Error('合成回读失败')
      if (detail)
        return structuredClone(await detail(id))
      const record = rows.find(row => row.id === id)
      if (!record)
        throw new Error('合成详情缺失')
      return { ...evidence(revision, actor.capabilities, { scope: 'scope-detail', asOf: later }), record: structuredClone(record) }
    }
    throw new Error(`拒绝未知合成请求 ${url}`)
  })
  const client = createCentralInvoiceHttp(fetcher, identity)
  const workspace = createCentralInvoiceWorkspace({ identity, client, storage, commandId: () => 'command-synthetic', context: async () => structuredClone(actor), recognizeLocal: async () => {
    throw new Error('未使用识别')
  } })
  return {
    workspace,
    fetcher,
    saved,
    setRows: (next: CentralInvoiceRecord[], nextRevision: number) => {
      rows = structuredClone(next)
      revision = nextRevision
    },
    setActor: (next: typeof actor) => { actor = structuredClone(next) },
    setListPage: (next: typeof listPage) => { listPage = next },
    setDetail: (next: typeof detail) => { detail = next },
    setDetailFails: (next: boolean) => { detailFails = next },
  }
}

async function delayedEdit(f: ReturnType<typeof fixture>, detail: Record<string, unknown>, listed: CentralInvoiceRecord[]) {
  const entered = deferred<void>()
  const gate = deferred<void>()
  f.setDetail(async () => {
    entered.resolve()
    await gate.promise
    return detail
  })
  const target = f.workspace.records.value[0]!
  const pending = f.workspace.edit(target, target.fields, target.items)
  const outcome = pending.then(() => null, error => error)
  await entered.promise
  f.setRows(listed, 2)
  await f.workspace.load()
  gate.resolve()
  return await outcome
}

describe('共享发票读取：完整合成 DTO 与延迟回读', () => {
  it('真实服务端范围证据随页码变化，完整 101 条仍可发布', async () => {
    const rows = Array.from({ length: 101 }, (_, index) => invoice(`invoice-${String(index + 1).padStart(3, '0')}`))
    const f = fixture(rows)
    const fingerprints: string[] = []
    f.setListPage((page) => {
      const meta = createReadMeta({ session: { ...identity, capabilities: caps }, schemaVersion: 'invoice-read-v1', operation: 'invoice:list', dataOrigin: 'real', asOf: at, sources: [{ key: 'invoices', state: 'readable', sourceVersion: 'invoices:1', asOf: at }], coverage: 'complete', scope: { requestedPage: page, pageSize: 100, deleted: false } })
      fingerprints.push(meta.authorizedScope.fingerprint)
      return { dataOrigin: 'real', asOf: at, sourceVersion: meta.sourceVersion, capabilities: meta.capabilities, meta, items: rows.slice((page - 1) * 100, page * 100), pagination: { requestedPage: page, page, pageSize: 100, total: rows.length } }
    })
    await f.workspace.load()
    expect(fingerprints).toHaveLength(2)
    expect(fingerprints[0]).not.toBe(fingerprints[1])
    expect(f.workspace.readState.value).toBe('ready')
    expect(f.workspace.records.value.map(row => row.id)).toEqual(rows.map(row => row.id))
  })

  it('分页能力集合顺序不同但内容相同，仍可发布', async () => {
    const rows = Array.from({ length: 101 }, (_, index) => invoice(`invoice-${String(index + 1).padStart(3, '0')}`))
    const f = fixture(rows)
    f.setListPage(page => ({ ...evidence(1, page === 1 ? caps : [...caps].reverse(), { scope: `scope-list-page-${page}` }), items: rows.slice((page - 1) * 100, page * 100), pagination: { requestedPage: page, page, pageSize: 100, total: rows.length } }))
    await f.workspace.load()
    expect(f.workspace.records.value).toHaveLength(101)
    expect(f.workspace.readState.value).toBe('ready')
  })

  it.each(['actor', 'workspace', 'capabilities', 'duplicate', 'revision', 'token', 'total'] as const)('分页出现 %s 差异时不发布局部集合', async (fault) => {
    const rows = Array.from({ length: 101 }, (_, index) => invoice(`invoice-${String(index + 1).padStart(3, '0')}`))
    const f = fixture(rows)
    f.setListPage((page) => {
      const second = page === 2
      const different = second && fault === 'capabilities' ? [...caps, 'project:list:read'] : caps
      const options = { scope: `scope-list-page-${page}`, actorId: second && fault === 'actor' ? 'other-actor' : undefined, workspaceId: second && fault === 'workspace' ? 'other-workspace' : undefined, token: second && fault === 'token' ? 'read-other' : undefined }
      const items = rows.slice((page - 1) * 100, page * 100)
      if (second && fault === 'duplicate')
        items[0] = rows[0]!
      if (second && fault === 'total')
        items.push(invoice('invoice-102'))
      const total = second && fault === 'total' ? 102 : 101
      return { ...evidence(second && fault === 'revision' ? 2 : 1, different, options), items, pagination: { requestedPage: page, page, pageSize: 100, total } }
    })
    await expect(f.workspace.load()).rejects.toBeInstanceOf(Error)
    expect(f.workspace.readState.value).toBe('unavailable')
    expect(f.workspace.records.value).toEqual([])
  })

  it('分页完成前真实会话能力发生变化时，即使两页本身相同也不得发布', async () => {
    const rows = Array.from({ length: 101 }, (_, index) => invoice(`invoice-${String(index + 1).padStart(3, '0')}`))
    const f = fixture(rows)
    f.setListPage((page) => {
      if (page === 2)
        f.setActor({ ...identity, capabilities: [...caps, 'project:list:read'] })
      return { ...evidence(1, caps, { scope: 'scope-list' }), items: rows.slice((page - 1) * 100, page * 100), pagination: { requestedPage: page, page, pageSize: 100, total: rows.length } }
    })
    await expect(f.workspace.load()).rejects.toThrow('发票读取来源或权限已变化，请重新读取并核对。')
    expect(f.workspace.readState.value).toBe('unavailable')
    expect(f.workspace.records.value).toEqual([])
  })

  it('详情回读时会话能力与详情证据不一致，必须保留原编号且不得再发送', async () => {
    const f = fixture()
    await f.workspace.load()
    f.setDetail(async () => {
      f.setActor({ ...identity, capabilities: [...caps, 'project:list:read'] })
      return { ...evidence(2, caps, { scope: 'scope-detail' }), record: { ...invoice('invoice-001', '2'), updatedAt: later } }
    })
    const row = f.workspace.records.value[0]!
    await expect(f.workspace.edit(row, row.fields, row.items)).rejects.toThrow('发票读取来源或权限已变化')
    expect(f.workspace.pending(row.id)?.commandId).toBe('command-synthetic')
    expect(f.fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices')).toHaveLength(1)
  })

  it('打印详情回读期间会话能力变化，整批保留原任务编号', async () => {
    const first = invoice('invoice-001')
    const second = invoice('invoice-002')
    const f = fixture([first, second])
    await f.workspace.load()
    const printed = [first, second].map(row => ({ ...row, version: '2', printCount: 1, updatedAt: later }))
    f.setDetail(async (id) => {
      if (id === second.id)
        f.setActor({ ...identity, capabilities: [...caps, 'project:list:read'] })
      return { ...evidence(2, caps, { scope: `scope-detail-${id}` }), record: printed.find(row => row.id === id) }
    })
    await expect(f.workspace.recordPrinted([first, second].map(row => ({ invoiceId: row.id, baseVersion: row.version, rotation: 0 as const })))).rejects.toThrow('发票读取来源或权限已变化')
    expect(f.workspace.pendingPrint()?.commandId).toBe('command-synthetic')
    expect(f.fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices/print')).toHaveLength(1)
  })

  it.each(['ordinary', 'print'] as const)('%s 回读与已保存回执不符时遮蔽列表并保留原号', async (kind) => {
    const f = fixture()
    await f.workspace.load()
    const row = f.workspace.records.value[0]!
    f.setDetail(async () => ({ ...evidence(2, caps, { scope: 'scope-detail-invoice-001' }), record: kind === 'ordinary' ? invoice(row.id) : invoice(row.id, '2') }))
    const operation = kind === 'ordinary'
      ? f.workspace.edit(row, row.fields, row.items)
      : f.workspace.recordPrinted([{ invoiceId: row.id, baseVersion: row.version, rotation: 0 }])
    await expect(operation).rejects.toBeInstanceOf(Error)
    expect(f.workspace.readState.value).toBe('unavailable')
    expect(f.workspace.records.value).toEqual([])
    expect(kind === 'ordinary' ? f.workspace.pending(row.id)?.commandId : f.workspace.pendingPrint()?.commandId).toBe('command-synthetic')
  })

  it('同来源等版本且完整详情相同时迟到回读不破坏已读列表', async () => {
    const f = fixture()
    await f.workspace.load()
    const updated = { ...invoice('invoice-001', '2'), updatedAt: later }
    expect(await delayedEdit(f, { ...evidence(2, [...caps].reverse(), { scope: 'scope-detail', asOf: later }), record: updated }, [updated])).toBeNull()
    expect(f.workspace.readState.value).toBe('ready')
    expect(f.workspace.records.value).toEqual([updated])
    expect(f.workspace.sourceVersion.value).toBe('read-synthetic-2')
    expect(f.workspace.pending('invoice-001')).toBeNull()
    expect(f.fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices')).toHaveLength(1)
  })

  it('详情对象和字段键序不同但完整数据相同时仍视为相同记录', async () => {
    const f = fixture()
    await f.workspace.load()
    const updated = { ...invoice('invoice-001', '2'), updatedAt: later }
    const reversed = Object.fromEntries(Object.entries(updated).reverse()) as unknown as CentralInvoiceRecord
    reversed.fields = Object.fromEntries(Object.entries(updated.fields).reverse()) as unknown as CentralInvoiceRecord['fields']
    expect(await delayedEdit(f, { ...evidence(2, caps, { scope: 'scope-detail-invoice-001', asOf: later }), record: reversed }, [updated])).toBeNull()
    expect(f.workspace.readState.value).toBe('ready')
    expect(f.workspace.records.value).toEqual([updated])
    expect(f.workspace.pending(updated.id)).toBeNull()
  })

  it('同版本详情与列表记录相同但各自授权能力不同，不能保留旧列表', async () => {
    const f = fixture()
    await f.workspace.load()
    const updated = { ...invoice('invoice-001', '2'), updatedAt: later }
    const entered = deferred<void>()
    const gate = deferred<void>()
    f.setDetail(async () => {
      entered.resolve()
      await gate.promise
      return { ...evidence(2, caps, { scope: 'scope-detail-invoice-001' }), record: updated }
    })
    const row = f.workspace.records.value[0]!
    const edit = f.workspace.edit(row, row.fields, row.items)
    const outcome = edit.then(() => null, error => error)
    await entered.promise
    f.setActor({ ...identity, capabilities: [...caps, 'project:list:read'] })
    f.setRows([updated], 2)
    await f.workspace.load()
    expect(f.workspace.readState.value).toBe('ready')
    f.setActor({ ...identity, capabilities: [...caps] })
    gate.resolve()
    expect(await outcome).toBeInstanceOf(Error)
    expect(f.workspace.readState.value).toBe('unavailable')
    expect(f.workspace.records.value).toEqual([])
    expect(f.workspace.pending(row.id)?.commandId).toBe('command-synthetic')
    expect(f.fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices')).toHaveLength(1)
  })

  it.each(['capabilities', 'coverage', 'duplicate-source', 'unsafe-revision'] as const)('无效详情 DTO：%s 不得清原号或再次写入', async (fault) => {
    const f = fixture()
    await f.workspace.load()
    const invalid = evidence(2, caps, { scope: 'scope-detail' })
    if (fault === 'capabilities')
      invalid.capabilities = [...caps, 'project:list:read']
    if (fault === 'coverage')
      Object.assign(invalid.meta.authorizedScope, { coverage: 'unknown' })
    if (fault === 'duplicate-source')
      invalid.meta.sources.push({ ...invalid.meta.sources[0]! })
    if (fault === 'unsafe-revision')
      invalid.meta.sources[0]!.sourceVersion = 'invoices:9007199254740992'
    f.setDetail(async () => ({ ...invalid, record: { ...invoice('invoice-001', '2'), updatedAt: later } }))
    const row = f.workspace.records.value[0]!
    await expect(f.workspace.edit(row, row.fields, row.items)).rejects.toBeInstanceOf(Error)
    expect(f.workspace.pending(row.id)?.commandId).toBe('command-synthetic')
    await expect(f.workspace.edit(row, row.fields, row.items)).rejects.toThrow('请先核对原提交')
    expect(f.workspace.pending(row.id)?.commandId).toBe('command-synthetic')
    expect(f.fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices')).toHaveLength(1)
  })

  it('旧列表读取等待期间新详情先到，旧列表不得最终发布为 ready', async () => {
    const f = fixture()
    await f.workspace.load()
    const original = JSON.parse(JSON.stringify(f.workspace.records.value[0])) as CentralInvoiceRecord
    const newer = { ...invoice(original.id, '2'), updatedAt: later }
    const entered = deferred<void>()
    const gate = deferred<void>()
    f.setListPage(async (page) => {
      const snapshot = { ...evidence(1, caps, { scope: 'scope-list' }), items: [structuredClone(original)], pagination: { requestedPage: page, page, pageSize: 100, total: 1 } }
      entered.resolve()
      await gate.promise
      return snapshot
    })
    f.setDetail(async () => ({ ...evidence(2, caps, { scope: 'scope-detail-invoice-001', asOf: later }), record: newer }))
    const loading = f.workspace.load().catch(error => error)
    await entered.promise
    expect(f.workspace.readState.value).toBe('loading')
    await f.workspace.edit(original, original.fields, original.items)
    expect(f.workspace.pending(original.id)).toBeNull()
    gate.resolve()
    await loading
    if (f.workspace.readState.value === 'ready') {
      expect(f.workspace.records.value).toEqual([newer])
    }
    else {
      expect(f.workspace.readState.value).toBe('unavailable')
      expect(f.workspace.records.value).toEqual([])
    }
    expect(f.fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices')).toHaveLength(1)
  })

  it.each(['zero', 'item', 'items-order', 'original', 'missing', 'deleted', 'old', 'token'] as const)('等版本回读 %s 不一致时不沿用旧集合', async (fault) => {
    const f = fixture()
    await f.workspace.load()
    const updated = { ...invoice('invoice-001', '2'), updatedAt: later }
    if (fault === 'original')
      updated.original = { id: 'original-001', fileName: '合成.png', fileSize: 1, mimeType: 'image/png', sha256: 'a'.repeat(64) }
    if (fault === 'items-order')
      updated.items.push({ ...updated.items[0]!, name: '第二行合成货物' })
    const returned = structuredClone(updated)
    if (fault === 'zero')
      returned.fields.amount = 0
    if (fault === 'item')
      returned.items[0]!.name = '另一合成货物'
    if (fault === 'items-order')
      returned.items.reverse()
    if (fault === 'original')
      returned.original!.sha256 = 'b'.repeat(64)
    if (fault === 'deleted')
      returned.deletedAt = later
    const rows = fault === 'missing' ? [invoice('invoice-002', '2')] : [updated]
    expect(await delayedEdit(f, { ...evidence(fault === 'old' ? 1 : 2, caps, { scope: 'scope-detail', token: fault === 'token' ? 'read-other' : undefined }), record: returned }, rows)).toBeInstanceOf(Error)
    expect(f.workspace.readState.value).toBe('unavailable')
    expect(f.workspace.records.value).toEqual([])
    expect(f.workspace.pending('invoice-001')?.commandId).toBe('command-synthetic')
    expect(f.fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices')).toHaveLength(1)
  })

  it('正常递增一版的完整回读仍更新列表', async () => {
    const f = fixture()
    await f.workspace.load()
    const updated = { ...invoice('invoice-001', '2'), updatedAt: later }
    f.setDetail(async () => ({ ...evidence(2, caps, { scope: 'scope-detail' }), record: updated }))
    const row = f.workspace.records.value[0]!
    await f.workspace.edit(row, row.fields, row.items)
    expect(f.workspace.readState.value).toBe('ready')
    expect(f.workspace.records.value).toEqual([updated])
    expect(f.workspace.sourceVersion.value).toBe('read-synthetic-2')
  })

  it('回执成功但详情读取失败时保留原编号，恢复只核对同一编号', async () => {
    const f = fixture()
    await f.workspace.load()
    f.setDetailFails(true)
    const row = f.workspace.records.value[0]!
    await expect(f.workspace.edit(row, row.fields, row.items)).rejects.toThrow('合成回读失败')
    expect(f.workspace.pending(row.id)?.commandId).toBe('command-synthetic')
    f.setDetailFails(false)
    f.setRows([{ ...invoice(row.id, '2'), updatedAt: later }], 2)
    const result = await f.workspace.recover(row.id)
    expect(result?.outcome).toBe('applied')
    expect(f.workspace.pending(row.id)).toBeNull()
    expect(f.fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices')).toHaveLength(1)
    const resolves = f.fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices/resolve')
    expect(resolves).toHaveLength(1)
    expect(resolves[0]![1]?.body).toEqual({ commandId: 'command-synthetic' })
  })

  it('已启动写入后丧失读取权限，不得继续展示此前集合，也不得再次提交', async () => {
    const f = fixture()
    await f.workspace.load()
    const entered = deferred<void>()
    const gate = deferred<void>()
    const updated = { ...invoice('invoice-001', '2'), updatedAt: later }
    f.setDetail(async () => {
      entered.resolve()
      await gate.promise
      return { ...evidence(2, caps, { scope: 'scope-detail' }), record: updated }
    })
    const original = f.workspace.records.value[0]!
    const pending = f.workspace.edit(original, original.fields, original.items)
    const rejected = pending.then(() => ({ resolved: true }), error => ({ error }))
    await entered.promise
    f.setActor({ ...identity, capabilities: ['finance-invoice:write'] })
    gate.resolve()
    expect(await rejected).toMatchObject({ error: { problem: { code: 'forbidden' } } })
    expect(f.workspace.pending(original.id)?.commandId).toBe('command-synthetic')
    expect(f.workspace.readState.value).toBe('unavailable')
    expect(f.workspace.records.value).toEqual([])
    await expect(f.workspace.edit(original, original.fields, original.items)).rejects.toBeInstanceOf(Error)
    f.setActor({ ...identity, capabilities: [...caps] })
    await expect(f.workspace.edit(original, original.fields, original.items)).rejects.toThrow('请先核对原提交')
    expect(f.workspace.pending(original.id)?.commandId).toBe('command-synthetic')
    expect(f.fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices')).toHaveLength(1)
  })

  it.each(['same', 'conflict', 'mixed'] as const)('打印双票回读 %s 时按整批核对', async (kind) => {
    const first = invoice('invoice-001')
    const second = invoice('invoice-002')
    const f = fixture([first, second])
    await f.workspace.load()
    const printed = [first, second].map(row => ({ ...row, version: '2', printCount: 1, updatedAt: later }))
    const entered = deferred<void>()
    const gate = deferred<void>()
    let reads = 0
    f.setDetail(async (id) => {
      if (reads++ === 0) {
        entered.resolve()
        await gate.promise
      }
      const record = structuredClone(printed.find(row => row.id === id)!)
      if (kind === 'conflict' && id === second.id)
        record.fields.remark = '冲突的合成备注'
      return { ...evidence(kind === 'mixed' && id === second.id ? 3 : 2, caps, { scope: `scope-detail-${id}` }), record }
    })
    const pending = f.workspace.recordPrinted([first, second].map(row => ({ invoiceId: row.id, baseVersion: row.version, rotation: 0 as const })))
    const outcome = pending.then(value => ({ status: 'resolved' as const, value }), error => ({ status: 'rejected' as const, error }))
    await entered.promise
    f.setRows(printed, 2)
    await f.workspace.load()
    gate.resolve()
    const result = await outcome
    if (kind === 'same') {
      expect(result.status).toBe('resolved')
      expect(f.workspace.readState.value).toBe('ready')
      expect(f.workspace.records.value).toEqual(printed)
    }
    else {
      expect(result.status).toBe('rejected')
      expect(f.workspace.pendingPrint()?.commandId).toBe('command-synthetic')
      expect(f.workspace.readState.value).toBe('unavailable')
      expect(f.workspace.records.value).toEqual([])
    }
    expect(f.fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices/print')).toHaveLength(1)
  })

  it('打印第二张详情失败时保留原任务号，恢复只核对该号', async () => {
    const first = invoice('invoice-001')
    const second = invoice('invoice-002')
    const f = fixture([first, second])
    await f.workspace.load()
    const printed = [first, second].map(row => ({ ...row, version: '2', printCount: 1, updatedAt: later }))
    f.setRows(printed, 2)
    f.setDetail(async (id) => {
      if (id === second.id)
        throw new Error('合成第二张详情不可读')
      return { ...evidence(2, caps, { scope: 'scope-detail' }), record: printed[0] }
    })
    await expect(f.workspace.recordPrinted([first, second].map(row => ({ invoiceId: row.id, baseVersion: row.version, rotation: 0 as const })))).rejects.toThrow('合成第二张详情不可读')
    expect(f.workspace.pendingPrint()?.commandId).toBe('command-synthetic')
    f.setDetail(undefined)
    const result = await f.workspace.recoverPrint()
    expect(result?.outcome).toBe('applied')
    expect(f.workspace.pendingPrint()).toBeNull()
    expect(f.fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices/print')).toHaveLength(1)
    const resolves = f.fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices/print-resolve')
    expect(resolves).toHaveLength(1)
    expect(resolves[0]![1]?.body).toEqual({ commandId: 'command-synthetic' })
  })

  it('重复打印目标的回执由真实 HTTP 边界拒绝，保留原任务编号', async () => {
    const f = fixture()
    await f.workspace.load()
    const target = { invoiceId: 'invoice-001', baseVersion: '1', rotation: 0 as const }
    await expect(f.workspace.recordPrinted([target, target])).rejects.toBeInstanceOf(Error)
    expect(f.workspace.pendingPrint()?.commandId).toBe('command-synthetic')
    expect(f.fetcher.mock.calls.filter(([url]) => url.startsWith('/api/read/invoices/'))).toHaveLength(0)
  })
})
