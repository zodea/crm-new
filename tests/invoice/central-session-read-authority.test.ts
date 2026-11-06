import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { describe, expect, it, vi } from 'vitest'
import { createCentralInvoiceHttp } from '~/lib/invoice/central-http'
import { createCentralInvoicePrintSession, createCentralInvoiceSession } from '~/lib/invoice/central-session'

const identity = { workspaceId: 'synthetic-workspace', actorId: 'synthetic-actor' }
const granted = ['finance-invoice:read', 'finance-invoice:write']
const at = '2026-01-01T00:00:00.000Z'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function record(id: string): CentralInvoiceRecord {
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

function fixture(kind: 'ordinary' | 'print', outcome: 'applied' | 'not-applied') {
  let capabilities = [...granted]
  let actorId = identity.actorId
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
  const printReceipt = { commandId: 'synthetic-command', updatedAt: at, records: ['invoice-001', 'invoice-002'].map(invoiceId => ({ invoiceId, version: '2', printCount: 1, printRotation: 0 })) }
  const fetcher = vi.fn<Parameters<typeof createCentralInvoiceHttp>[0]>(async (url) => {
    if (url === '/api/commands/invoices' || url === '/api/commands/invoices/print') {
      if (outcome === 'not-applied')
        throw new Error('合成请求结果未知')
      return kind === 'ordinary' ? ordinaryReceipt : printReceipt
    }
    if (url === '/api/commands/invoices/resolve' || url === '/api/commands/invoices/print-resolve') {
      if (outcome === 'not-applied' && gated) {
        entered.resolve()
        await gate.promise
        gated = false
      }
      return outcome === 'not-applied' ? { outcome, commandId: 'synthetic-command' } : { outcome, result: kind === 'ordinary' ? ordinaryReceipt : printReceipt }
    }
    if (url.startsWith('/api/read/invoices/')) {
      const id = decodeURIComponent(url.slice('/api/read/invoices/'.length))
      if (outcome === 'applied' && gated && (kind === 'ordinary' || id === 'invoice-002')) {
        entered.resolve()
        await gate.promise
        gated = false
      }
      const meta = { schemaVersion: 'invoice-read-v1', ...identity, dataOrigin: 'real', asOf: at, sourceVersion: 'read-synthetic-2', sources: [{ key: 'invoices', state: 'readable', sourceVersion: 'invoices:2', asOf: at }], authorizedScope: { coverage: 'complete', fingerprint: 'scope-synthetic-detail' }, capabilities: [...granted] }
      return { dataOrigin: 'real', asOf: at, sourceVersion: meta.sourceVersion, capabilities: [...granted], meta, record: record(id) }
    }
    throw new Error(`拒绝未知合成请求 ${url}`)
  })
  const repository = createCentralInvoiceHttp(fetcher, identity)
  const context = async () => ({ ...identity, actorId, capabilities: [...capabilities] })
  const ordinary = createCentralInvoiceSession({ identity, targetId: 'invoice-001', repository, context, storage })
  const print = createCentralInvoicePrintSession({ identity, repository, context, storage })
  const session = kind === 'ordinary' ? ordinary : print
  const command = { ...identity, commandId: 'synthetic-command', requiredCapability: 'finance-invoice:write' as const }
  function submit() {
    return kind === 'ordinary'
      ? ordinary.submit({ ...command, action: 'edit', invoiceId: 'invoice-001', baseVersion: '1', fields: record('invoice-001').fields, items: [] })
      : print.submit({ ...command, action: 'record-printed', targets: ['invoice-001', 'invoice-002'].map(invoiceId => ({ invoiceId, baseVersion: '1', rotation: 0 as const })) })
  }
  return {
    session,
    submit,
    entered,
    gate,
    fetcher,
    revokeRead: () => { capabilities = ['finance-invoice:write'] },
    revokeWrite: () => { capabilities = ['finance-invoice:read'] },
    addCapability: () => { capabilities = [...granted, 'project:list:read'] },
    switchActor: () => { actorId = 'other-actor' },
    restore: () => {
      capabilities = [...granted]
      actorId = identity.actorId
    },
  }
}

describe('普通和打印原编号：读取权限迟到失效', () => {
  it.each(['ordinary', 'print'] as const)('%s 双权限正常时成功回读并清号', async (kind) => {
    const f = fixture(kind, 'applied')
    f.gate.resolve()
    const result = await f.submit()
    expect(result.result.commandId).toBe('synthetic-command')
    expect(f.session.pending()).toBeNull()
  })

  it.each(['ordinary', 'print'] as const)('%s 提交前缺权限或身份变化时不发送也不记号', async (kind) => {
    for (const change of ['read', 'write', 'identity'] as const) {
      const f = fixture(kind, 'applied')
      if (change === 'read')
        f.revokeRead()
      if (change === 'write')
        f.revokeWrite()
      if (change === 'identity')
        f.switchActor()
      await expect(f.submit()).rejects.toMatchObject({ problem: { code: 'forbidden' } })
      expect(f.session.pending()).toBeNull()
      expect(f.fetcher).not.toHaveBeenCalled()
    }
  })

  it.each(['ordinary', 'print'] as const)('%s 已应用：最后详情回读期间失读，保留原号并按原号恢复', async (kind) => {
    const f = fixture(kind, 'applied')
    const pending = f.submit()
    await f.entered.promise
    f.revokeRead()
    f.gate.resolve()
    await expect(pending).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(f.session.pending()?.commandId).toBe('synthetic-command')
    f.restore()
    expect(await f.session.recover()).toMatchObject({ outcome: 'applied', result: { commandId: 'synthetic-command' } })
    expect(f.session.pending()).toBeNull()
    const writeUrl = kind === 'ordinary' ? '/api/commands/invoices' : '/api/commands/invoices/print'
    const resolveUrl = `${writeUrl}${kind === 'ordinary' ? '/resolve' : '-resolve'}`
    expect(f.fetcher.mock.calls.filter(([url]) => url === writeUrl)).toHaveLength(1)
    const resolutions = f.fetcher.mock.calls.filter(([url]) => url === resolveUrl)
    expect(resolutions).toHaveLength(1)
    expect(resolutions[0]![1]?.body).toEqual({ commandId: 'synthetic-command' })
  })

  it.each(['ordinary', 'print'] as const)('%s 未应用：回执核对期间失读，恢复后才清除原号', async (kind) => {
    const f = fixture(kind, 'not-applied')
    await expect(f.submit()).rejects.toThrow('合成请求结果未知')
    expect(f.session.pending()?.commandId).toBe('synthetic-command')
    const pending = f.session.recover()
    await f.entered.promise
    f.revokeRead()
    f.gate.resolve()
    await expect(pending).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(f.session.pending()?.commandId).toBe('synthetic-command')
    f.restore()
    expect(await f.session.recover()).toEqual({ outcome: 'not-applied' })
    expect(f.session.pending()).toBeNull()
    const writeUrl = kind === 'ordinary' ? '/api/commands/invoices' : '/api/commands/invoices/print'
    const resolveUrl = `${writeUrl}${kind === 'ordinary' ? '/resolve' : '-resolve'}`
    expect(f.fetcher.mock.calls.filter(([url]) => url === writeUrl)).toHaveLength(1)
    const resolutions = f.fetcher.mock.calls.filter(([url]) => url === resolveUrl)
    expect(resolutions).toHaveLength(2)
    expect(resolutions.every(([, options]) => JSON.stringify(options?.body) === JSON.stringify({ commandId: 'synthetic-command' }))).toBe(true)
  })

  it.each(['ordinary', 'print'] as const)('%s 未应用核对期间能力集合改变时保留原号', async (kind) => {
    const f = fixture(kind, 'not-applied')
    await expect(f.submit()).rejects.toThrow('合成请求结果未知')
    const pending = f.session.recover()
    await f.entered.promise
    f.addCapability()
    f.gate.resolve()
    await expect(pending).rejects.toThrow('发票读取来源或权限已变化')
    expect(f.session.pending()?.commandId).toBe('synthetic-command')
    f.restore()
    expect(await f.session.recover()).toEqual({ outcome: 'not-applied' })
    expect(f.session.pending()).toBeNull()
  })
})
