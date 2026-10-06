import { expect, it } from 'vitest'
import { newQuotationDraft } from '~/lib/material-quotation/contract'
import { createQuotationHttpRepository, decodeQuotationRead } from '~/lib/material-quotation/http-repository'
import { createReadMeta, withReadMeta } from '../../server/utils/read-meta'

const actor = { workspaceId: 'quote-workspace', actorId: 'quote-actor', capabilities: ['material-quotation:read', 'material-quotation:write'] }
const asOf = '2026-10-05T00:00:00.000Z'
function read() {
  const draft = { ...newQuotationDraft(), partyName: '未知目录的原报价方', lines: [{ ...newQuotationDraft().lines[0]!, id: 'quotation-line-original', name: '真实材料', unit: '吨', unitPrice: 0, taxRate: null }] }
  const record = { id: 'quotation-original', version: '1', createdAt: asOf, updatedAt: asOf, draft, attachments: [], history: [{ version: '1', draft, files: [], commandId: 'original-command', actorId: actor.actorId, occurredAt: asOf }] }
  const meta = createReadMeta({ session: actor, schemaVersion: 'material-quotation-read-v1', operation: 'quotation:list', dataOrigin: 'real', asOf, coverage: 'complete', scope: {}, sources: [{ key: 'material-quotations', state: 'readable', sourceVersion: 'actual:1', asOf }] })
  return withReadMeta({ records: [record] }, meta)
}
it('真实零价和未知报价日期/税点/目录身份在完整读取证明下保留', () => {
  expect(decodeQuotationRead(read()).records[0]!.draft).toMatchObject({ supplierId: null, projectId: null, quotationDate: null, lines: [{ unitPrice: 0, taxRate: null }] })
  expect(() => decodeQuotationRead({ ...read(), meta: undefined })).toThrow('读取证明')
  expect(() => decodeQuotationRead({ ...read(), sourceVersion: '另一个来源' })).toThrow('读取证明')
})
it('迁入关系投影只影响新编辑所采用的当前关系，原历史与价格零值保持；冲突/额外/增删原关系拒绝', async () => {
  const raw = read()
  const sourceDraft = { ...raw.records[0]!.draft, scope: 'project' as const, projectId: 'native-project-id', supplierId: 'native-supplier-id' }
  const record = { ...raw.records[0]!, draft: sourceDraft, history: [{ ...raw.records[0]!.history[0]!, draft: sourceDraft }], relations: [{ version: '1', projectId: 'actual-target-project', supplierId: 'actual-target-supplier', importBatchId: 'actual-import-batch', sourceSnapshotSha256: 'a'.repeat(64) }] }
  const response = { ...raw, records: [record] }
  const repo = createQuotationHttpRepository(async () => response)
  const loaded = await repo.loadForm(record.id)
  expect(loaded.draft).toMatchObject({ projectId: 'actual-target-project', supplierId: 'actual-target-supplier' })
  expect(loaded.history[0]!.draft).toMatchObject({ projectId: 'native-project-id', supplierId: 'native-supplier-id', lines: [{ unitPrice: 0, taxRate: null }] })
  for (const relations of [[...record.relations, ...record.relations], [{ ...record.relations[0]!, projectId: null }], [{ ...record.relations[0]!, version: '2' }], [{ ...record.relations[0]!, guessedByName: true }]])
    expect(() => decodeQuotationRead({ ...response, records: [{ ...record, relations }] })).toThrow('迁入')
})
it('原价当前记录与冻结版本冲突、身份重复时拒绝，不更改期望数量遮掩', () => {
  const value = read()
  expect(() => decodeQuotationRead({ ...value, records: [...value.records, ...value.records] })).toThrow('身份重复')
  const record = value.records[0]!
  expect(() => decodeQuotationRead({ ...value, records: [{ ...record, draft: { ...record.draft, lines: [{ ...record.draft.lines[0]!, unitPrice: 9 }] } }] })).toThrow('历史不一致')
})
it('核对回执必须同一原命令；原件接口明确head/file/version，拒绝伪正文摘要', async () => {
  const calls: {
    url: string
    options: any
  }[] = []
  const repository = createQuotationHttpRepository(async (url, options) => {
    calls.push({ url, options })
    if (url.includes('/resolve'))
      return { outcome: 'applied', result: { commandId: 'other-command', id: 'quotation-original', version: '1', updatedAt: asOf, attachmentIds: [] } }
    return { ownerId: 'quotation-original', fileId: 'quotation-file-original', dataOrigin: 'real', fileName: '原件', fileSize: 3, mimeType: 'text/plain', sha256: '0'.repeat(64), payloadBase64: 'YWJj' }
  })
  await expect(repository.resolve('original-command')).rejects.toThrow('当前请求不一致')
  await expect(repository.original('quotation-original', 'quotation-file-original', '1')).rejects.toThrow('正文或身份')
  expect(calls[1]).toMatchObject({ url: '/api/read/material-quotations/quotation-original/files/quotation-file-original', options: { query: { version: '1' } } })
})
