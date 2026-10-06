import type { FinanceReadScope } from '../../app/lib/finance/central-contract'
import { parseQuery, stringifyQuery } from 'ufo'
import { describe, expect, it } from 'vitest'
import { normalizeFinanceLookup } from '../../app/lib/finance/central-contract'
import { createFinanceRepository } from '../../app/lib/finance/http-repository'
import { createReadMeta, withReadMeta } from '../../server/utils/read-meta'

const scope: FinanceReadScope = { kind: 'current', operation: 'context' }
const actor = { workspaceId: 'synthetic-finance-workspace', actorId: 'synthetic-finance-owner', capabilities: ['finance-current:read', 'finance-current:write'] }
function read<T extends object>(operation: FinanceReadScope, value: T) {
  return withReadMeta({ ...value, ...actor, dataOrigin: 'real', scope: operation }, createReadMeta({ session: actor, schemaVersion: 'finance-read-v1', operation: `finance:${operation.operation}`, dataOrigin: 'real', asOf: '2026-10-05T01:00:00.000Z', sources: [{ key: 'finance', state: 'readable', sourceVersion: 'finance-7', asOf: '2026-10-05T01:00:00.000Z' }], coverage: 'complete', scope: operation }))
}
function repository(value: unknown) {
  return createFinanceRepository(async () => value)
}
const current = { id: 'synthetic-current', no: '', note: '', status: 'draft', direction: 'payment', projectId: null, supplierId: null, counterparty: '历史原文', counterpartyNameSnapshot: null, purpose: '', amount: 0, paymentMethod: '', transactionDate: '', bankSerialNo: '', handler: '' }
const listRow = { id: current.id, no: '', name: '历史原文', projectName: '公司开支', partyName: '', amount: '0', date: '', status: 'draft', customerId: null, dataOrigin: 'real' }
describe('正式财务 HTTP 解码沿公共元数据契约', () => {
  it.each([
    ['未选择付款对象', 'settlements', null, null],
    ['分供方收款', 'settlements', 'synthetic-supplier', null],
    ['工人收款', 'settlements', null, 'synthetic-worker'],
    ['合法空工人清单', 'workers', null, null],
  ] as const)('%s的可空编号经真实查询编码后仍保原范围，完整空源可返回空集合', async (_name, lookupKind, supplierId, workerId) => {
    const session = { ...actor, capabilities: ['finance-payment-application:read', 'other-settlement:read', 'worker:list:read'] }
    const expectedQuery = { kind: lookupKind, keyword: '', projectId: null, supplierId, workerId, contractId: null }
    const target = createFinanceRepository(async (_url, options) => {
      const transported = parseQuery(stringifyQuery(options?.query ?? {}))
      expect(transported.workerId).toBe(workerId ?? '')
      const query = normalizeFinanceLookup(transported)
      expect(query).toEqual(expectedQuery)
      const operation: FinanceReadScope = { kind: 'payment_application', operation: 'lookup', query }
      const asOf = '2026-10-05T01:00:00.000Z'
      const source = lookupKind === 'workers' ? 'workers' : 'expenditure-settlements'
      const meta = createReadMeta({ session, schemaVersion: 'finance-read-v1', operation: 'finance:lookup', dataOrigin: 'real', asOf, sources: [{ key: 'finance', state: 'readable', sourceVersion: 'finance-7', asOf }, { key: source, state: 'readable', sourceVersion: `${source}-0`, asOf }], coverage: 'complete', scope: operation })
      return withReadMeta({ ...session, dataOrigin: 'real', scope: operation, items: [] }, meta)
    })
    expect((await target.lookup('payment_application', expectedQuery)).items).toEqual([])
  })
  it.each(['!', 'worker invalid', 0, [], ['synthetic-worker']])('非法非空工人编号 %s不能被空值正规化掩盖', (workerId) => {
    expect(() => normalizeFinanceLookup({ kind: 'settlements', keyword: '', workerId })).toThrow('财务候选工人稳定编号无效')
  })
  it('工人和分供方同时指定仍拒绝，来源未接通不能当作合法空集合', async () => {
    expect(() => normalizeFinanceLookup({ kind: 'settlements', keyword: '', workerId: 'synthetic-worker', supplierId: 'synthetic-supplier' })).toThrow('财务候选付款对象不能同时为工人与分供方')
    const query = { kind: 'workers' as const, keyword: '', projectId: null, supplierId: null, workerId: null, contractId: null }
    await expect(repository(read({ kind: 'current', operation: 'lookup', query }, { items: [] })).lookup('current', query)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  })
  it('完整同域来源证据可读，真实零金额保持零', async () => {
    expect(await repository(read(scope, {})).context('current')).toMatchObject({ ...actor, dataOrigin: 'real', sourceVersion: expect.any(String) })
    expect((await repository(read({ kind: 'current', operation: 'list' }, { items: [listRow] })).list('current')).items[0]!.amount).toBe('0')
    expect((await repository(read({ kind: 'current', operation: 'list' }, { items: [{ ...listRow, amount: '0.1000001' }] })).list('current')).items[0]!.amount).toBe('0.1000001')
    expect((await repository(read({ kind: 'current', operation: 'form', id: current.id }, { draft: current, version: '1', updatedAt: '2026-10-05T01:00:00.000Z', attachments: [] })).form('current', current.id)).draft.amount).toBe(0)
  })
  it.each([
    ['缺少读取证据', (value: Record<string, any>) => { delete value.meta }],
    ['错误来源版本', (value: Record<string, any>) => { value.sourceVersion = null }],
    ['错误身份镜像', (value: Record<string, any>) => { value.actorId = 'another-owner' }],
    ['测试来源不能冒正式', (value: Record<string, any>) => { value.meta.dataOrigin = 'demo' }],
    ['错误读取范围', (value: Record<string, any>) => { value.scope.operation = 'list' }],
    ['读取域错置', (value: Record<string, any>) => { value.scope.kind = 'payment_record' }],
    ['公共权限镜像不一致', (value: Record<string, any>) => { value.capabilities = [] }],
    ['读取权限缺失', (value: Record<string, any>) => {
      value.capabilities = []
      value.meta.capabilities = []
    }],
    ['不可用源不许携带旧版本', (value: Record<string, any>) => { value.meta.sources[0].state = 'unavailable' }],
    ['来源证据不可省略', (value: Record<string, any>) => {
      value.meta.sources = []
      value.meta.sourceVersion = null
      value.sourceVersion = null
    }],
  ])('%s须拒绝，不能把异常当成空事实', async (_name, change) => {
    const value = structuredClone(read(scope, {}))
    change(value)
    await expect(repository(value).context('current')).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  })
  it.each([null, 'unknown', 0, '1e-7', '00.1', Number.NaN, Number.POSITIVE_INFINITY])('未知或失真列表金额 %s 不能解码为零', async (amount) => {
    await expect(repository(read({ kind: 'current', operation: 'list' }, { items: [{ ...listRow, amount }] })).list('current')).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  })
  it.each([null, '0', Number.NaN, Number.POSITIVE_INFINITY])('未知或失真编辑金额 %s 不能解码为零', async (amount) => {
    await expect(repository(read({ kind: 'current', operation: 'form', id: current.id }, { draft: { ...current, amount }, version: '1', updatedAt: '2026-10-05T01:00:00.000Z', attachments: [] })).form('current', current.id)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  })
  it('记录、原件和候选必须保有唯一且同域的稳定身份', async () => {
    const form = read({ kind: 'current', operation: 'form', id: current.id }, { draft: current, version: '1', updatedAt: '2026-10-05T01:00:00.000Z', attachments: [{ id: 'synthetic-file', ownerType: 'payment_record', ownerId: current.id, fileName: '历史原件', filePath: '', fileSize: 0, mimeType: 'text/plain', category: '', uploader: actor.actorId, uploadedAt: '2026-10-05T01:00:00.000Z', deletedAt: null, sha256: null }] })
    await expect(repository(form).form('current', current.id)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await expect(repository({ ...form, draft: { ...current, id: 'another-current' }, attachments: [] }).form('current', current.id)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    const query = { kind: 'workers' as const, keyword: '', projectId: null, supplierId: null, contractId: null }
    await expect(repository(read({ kind: 'current', operation: 'lookup', query }, { items: [{ id: 'synthetic-worker', label: '同名工人' }, { id: 'synthetic-worker', label: '同名工人' }] })).lookup('current', query)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await expect(repository(read({ kind: 'current', operation: 'lookup', query: { ...query, projectId: 'other-project' } }, { items: [] })).lookup('current', query)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  })
  it('原回执不许指向另一命令，公共权限问题保留精确类型', async () => {
    const request = { ...actor, requiredCapability: 'finance-current:write', commandId: 'synthetic-command', kind: 'current' as const, baseVersion: null, action: 'draft' as const, draft: current, attachments: {} }
    await expect(repository({ id: current.id, commandId: 'other-command', version: '1', updatedAt: '2026-10-05T01:00:00.000Z', attachmentIds: [], logId: null }).execute(request)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    const denied = createFinanceRepository(async () => {
      throw Object.assign(new Error('当前来源已撤权'), { data: { code: 'forbidden', message: '当前来源已撤权', retryable: false, fieldErrors: {}, traceId: null } })
    })
    await expect(denied.context('current')).rejects.toMatchObject({ problem: { code: 'forbidden', message: '当前来源已撤权' } })
  })
  it('已确认批复零与历史批复未知都保留原来源；关系行重复和归属损坏须拒绝', async () => {
    const operation: FinanceReadScope = { kind: 'payment_application', operation: 'form', id: 'synthetic-application' }
    const session = { ...actor, capabilities: ['finance-payment-application:read'] }
    const meta = createReadMeta({ session, schemaVersion: 'finance-read-v1', operation: 'finance:form', dataOrigin: 'real', asOf: '2026-10-05T01:00:00.000Z', sources: [{ key: 'finance', state: 'readable', sourceVersion: 'finance-7', asOf: '2026-10-05T01:00:00.000Z' }], coverage: 'complete', scope: operation })
    const draft = { id: operation.id, no: '', name: '', status: 'draft', note: '', bizType: '', projectId: null, supplierId: null, contractId: null, costName: '', applyAmount: 0, applyDate: '', applicant: '', invoiceState: '无需发票', payContent: '', prepayDeduct: 0, prepayNote: '', approvedAmount: 0, approvedAmountOrigin: 'user-entry', approvalNote: '', externalRef: '', settlementAllocations: [], invoiceAllocations: [], settlementAllocated: 0, settlementDifference: 0, invoiceAllocated: 0, invoiceDifference: 0, pendingInvoiceAmount: 0, paidAmount: 0 }
    const value = withReadMeta({ ...session, dataOrigin: 'real', scope: operation, draft, attachments: [], version: '1', updatedAt: meta.asOf }, meta)
    const known = await repository(value).form('payment_application', operation.id!)
    expect(known.draft.approvedAmount).toBe(0)
    expect(known.draft.approvedAmountOrigin).toBe('user-entry')
    const unknown = await repository({ ...value, draft: { ...draft, approvedAmountOrigin: 'legacy' } }).form('payment_application', operation.id!)
    expect(unknown.draft.approvedAmount).toBe(0)
    expect(unknown.draft.approvedAmountOrigin).toBe('legacy')
    await expect(repository({ ...value, draft: { ...draft, approvedAmountOrigin: null } }).form('payment_application', operation.id!)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await expect(repository({ ...value, draft: { ...draft, settlementAllocations: [{ id: 'same-allocation', settlementId: 'settlement-one', allocatedAmount: 1, note: '' }, { id: 'same-allocation', settlementId: 'settlement-two', allocatedAmount: 1, note: '' }] } }).form('payment_application', operation.id!)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await expect(repository({ ...value, draft: { ...draft, invoiceAllocations: [{ id: 'invoice-allocation', invoiceId: null, allocatedAmount: 1, note: '' }] } }).form('payment_application', operation.id!)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  })
})
