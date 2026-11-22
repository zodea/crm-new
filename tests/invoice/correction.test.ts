import type { InvoiceCorrectionContent, InvoiceCorrectionDraft, InvoiceCorrectionSaveCommand } from '../../app/lib/invoice/correction-contract'
import { expect, it, vi } from 'vitest'
import { commandRecoveryFormTarget } from '../../app/lib/forms/command-recovery'
import { invoiceCorrectionChanges } from '../../app/lib/invoice/correction-contract'
import { createInvoiceCorrectionHttp } from '../../app/lib/invoice/correction-http'
import { createInvoiceCorrectionSession } from '../../app/lib/invoice/correction-session'
import { createReadMeta, withReadMeta } from '../../server/utils/read-meta'

function baseline(): InvoiceCorrectionContent {
  return {
    fields: { invoiceNumber: '001', invoiceDate: '2026-10-07', invoiceType: '增值税', buyer: '旧购方', buyerTaxNo: 'BUYER', seller: '旧销方', sellerTaxNo: 'SELLER', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' },
    items: [{ name: '服务', spec: '', unit: '', quantity: null, unitPrice: 0, amount: null, taxRate: '', taxAmount: null }],
    ownerKind: 'project',
    projectId: 'project-one',
    supplierId: 'supplier-one',
    supplierVersion: '1',
    buyer: null,
    contract: { domain: 'material', id: 'same-id', version: '1' },
  }
}

it('更正对照保留未知与真实零，逐项记录票面、明细和主体关系变化', () => {
  const before = baseline()
  const after = structuredClone(before)
  after.fields.amount = 0
  after.fields.taxAmount = null
  after.items[0]!.quantity = 0
  after.projectId = 'project-two'
  after.supplierId = 'supplier-two'
  after.buyer = { id: 'buyer-one', version: '2' }
  after.contract = { domain: 'auxiliary', id: 'same-id', version: '1' }
  const changes = invoiceCorrectionChanges(before, after)
  expect(changes.map(row => row.path)).toEqual(['fields.amount', 'fields.taxAmount', 'items', 'projectId', 'supplierId', 'buyer', 'contract'])
  expect(changes.find(row => row.path === 'fields.amount')).toMatchObject({ before: null, after: 0 })
  expect(changes.find(row => row.path === 'fields.taxAmount')).toMatchObject({ before: 0, after: null })
  expect(changes.find(row => row.path === 'buyer')).toMatchObject({ before: null, after: { id: 'buyer-one', version: '2' } })
  expect(changes.find(row => row.path === 'contract')).toMatchObject({ before: { domain: 'material', id: 'same-id' }, after: { domain: 'auxiliary', id: 'same-id' } })
  after.items[0]!.quantity = 99
  expect(changes.find(row => row.path === 'items')?.after).toMatchObject([{ quantity: 0 }])
})

it('对象属性顺序不同但原始字段不变时，不制造更正差异', () => {
  const before = baseline()
  const after = structuredClone(before)
  after.contract = { version: '1', id: 'same-id', domain: 'material' }
  expect(invoiceCorrectionChanges(before, after)).toEqual([])
})

it('空更正目录仍须绑定可信身份、权限和两个真实来源版本', async () => {
  const identity = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'project:list:read'] }
  let actor = structuredClone(identity)
  const asOf = '2026-11-05T00:00:00.000Z'
  const meta = createReadMeta({ session: identity, schemaVersion: 'invoice-correction-read-v1', operation: 'invoice-correction:list', dataOrigin: 'real', asOf, sources: [{ key: 'invoice-corrections', state: 'readable', sourceVersion: 'invoice-corrections:0', asOf }, { key: 'invoices', state: 'readable', sourceVersion: 'invoices:4', asOf }], coverage: 'complete', scope: { invoiceId: 'invoice-one' } })
  let response: unknown = withReadMeta({ dataOrigin: 'real' as const, items: [] }, meta)
  const client = createInvoiceCorrectionHttp({ identity, context: async () => actor, fetcher: async () => response })
  expect(await client.list('invoice-one')).toEqual([])
  response = { ...response as object, meta: { ...meta, sources: [{ ...meta.sources[0]!, sourceVersion: null }, meta.sources[1]] } }
  await expect(client.list('invoice-one')).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  response = withReadMeta({ dataOrigin: 'real' as const, items: [] }, meta)
  actor = { ...identity, capabilities: ['finance-invoice:read'] }
  await expect(client.list('invoice-one')).rejects.toMatchObject({ problem: { code: 'unavailable' } })
})

it('更正保存回执必须属于原命令并从基准版本递增', async () => {
  const identity = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'finance-invoice:write'] }
  let result = { commandId: 'command-one', correctionId: 'correction-one', invoiceId: 'invoice-one', version: '2', updatedAt: '2026-11-05T00:00:00.000Z' }
  const client = createInvoiceCorrectionHttp({ identity, context: async () => identity, fetcher: async () => result })
  const command = { action: 'save-draft', commandId: 'command-one', invoiceId: 'invoice-one', correctionId: null, baseCorrectionVersion: null } as InvoiceCorrectionSaveCommand
  await expect(client.save(command)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  result = { ...result, version: '1' }
  expect(await client.save(command)).toEqual(result)
})

it('更正结果未知或保存后回读失败时保留原编号，恢复成功才允许新操作', async () => {
  const data = new Map<string, string>()
  const storage = () => ({
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
  })
  const identity = { workspaceId: 'workspace-1', actorId: 'actor-1', capabilities: ['finance-invoice:write'] }
  const result = { commandId: 'command-1', correctionId: 'correction-1', invoiceId: 'invoice-1', version: '1', updatedAt: '2026-11-05T00:00:00.000Z' }
  const correction = { id: result.correctionId, invoiceId: result.invoiceId, version: result.version } as InvoiceCorrectionDraft
  const get = vi.fn().mockRejectedValueOnce(new Error('回读断开')).mockResolvedValue(correction)
  const repository = { save: vi.fn().mockRejectedValueOnce(new Error('连接中断')), submit: vi.fn(), get, resolve: vi.fn().mockResolvedValue({ outcome: 'applied', result }) }
  const session = createInvoiceCorrectionSession({ identity, invoiceId: 'invoice-1', repository, invoiceVersion: async () => '1', context: async () => ({ ...identity, capabilities: ['finance-invoice:write'] }), storage })
  const command = { workspaceId: identity.workspaceId, actorId: identity.actorId, action: 'save-draft', commandId: 'command-1', invoiceId: 'invoice-1', correctionId: null } as InvoiceCorrectionSaveCommand
  await expect(session.execute(command)).rejects.toThrow('连接中断')
  expect(session.pending()).toMatchObject({ commandId: 'command-1', scopeId: 'new' })
  await expect(session.recover()).rejects.toThrow('回读断开')
  expect(session.pending()?.commandId).toBe('command-1')
  await expect(session.recover()).resolves.toMatchObject({ outcome: 'applied', correction })
  expect(session.pending()).toBeNull()
  expect(repository.resolve).toHaveBeenCalledWith({ workspaceId: identity.workspaceId, actorId: identity.actorId, action: 'save-draft', commandId: 'command-1', invoiceId: 'invoice-1', correctionId: null })
  expect(commandRecoveryFormTarget('/finance/invoice/correction/invoice-1')).toEqual({ family: 'finance-invoice', targetId: 'invoice-1' })
  expect(commandRecoveryFormTarget('/finance/invoice/correction/%2F')).toBeNull()
})
