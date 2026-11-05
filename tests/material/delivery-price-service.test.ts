import type { DeliveryDraft } from '~/lib/delivery-record/contract'
import { expect, it } from 'vitest'
import { buildMaterialPriceCatalog } from '~/lib/material/price-analysis'
import { buildMaterialSourcePriceFacts } from '~/lib/material/price-source-facts'
import { createDeliveryCommandService } from '../../server/utils/delivery-command-service'

it('送货实际归档、补件、修订和删除驱动两类价格投影，并保全可读历史原件', () => {
  const session = { workspaceId: 'price-service-workspace', actorId: 'price-service-owner', capabilities: ['delivery:read', 'delivery:write', 'project:list:read', 'supplier:list:read'] }
  const references = { projects: [{ id: 'p1', name: '合成项目', dataOrigin: 'real' as const }], suppliers: [{ id: 's1', name: '合成分供方', dataOrigin: 'real' as const }] }
  let sequence = 0
  const service = createDeliveryCommandService({ references: () => references, createId: () => `price-service-${++sequence}`, now: () => '2026-09-11T02:00:00.000Z' })
  const envelope = { workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'delivery:write' as const, origin: 'real' as const }
  const draft: DeliveryDraft = { projectId: 'p1', supplierId: 's1', orderNo: 'PRICE-1', deliveryDate: '2026-09-11', note: '', rawSiteText: '', reviewFlag: '', confirmations: { pricePendingConfirmed: true }, lines: [{ materialName: '钢筋', spec: 'HRB400', unit: '吨', qty: 2, unitPrice: null, amount: null, amountSource: 'calculated', note: '' }] }
  const file = (text: string) => {
    const payloadBase64 = btoa(`%PDF-1.7\n${text}\n%%EOF`)
    return { fileName: '合成原件.pdf', mimeType: 'application/pdf', fileSize: atob(payloadBase64).length, payloadBase64 }
  }
  const project = () => {
    const records = service.list(session, undefined, 'real').records
    return {
      records,
      trend: buildMaterialPriceCatalog(records, references.suppliers, references.projects),
      sources: buildMaterialSourcePriceFacts({ deliveries: records, suppliers: references.suppliers }),
    }
  }

  const archived = service.execute({ ...envelope, commandId: 'price-archive', action: 'archive', baseVersion: null, uploadBatchId: 'price-upload', source: null, draft }, session)
  const initial = project()
  expect(initial.records).toHaveLength(1)
  expect(initial.records[0]).toMatchObject({ id: archived.id, version: archived.version, assetId: null, hasSourceFile: false, lines: [{ unitPrice: null, amount: null }] })
  expect(initial.trend).toEqual([])
  expect(initial.sources).toEqual([])

  const original = file('first original')
  const attached = service.execute({ ...envelope, commandId: 'price-attach', action: 'source', id: archived.id, baseVersion: archived.version, reason: '补充合成原件', source: original }, session)
  const withFile = project()
  const assetId = withFile.records[0]!.assetId!
  const lineId = withFile.records[0]!.lines[0]!.id
  expect(withFile.records[0]).toMatchObject({ version: attached.version, hasSourceFile: true, lines: [{ id: lineId, unitPrice: null, amount: null }] })
  expect(service.fileContent(archived.id, assetId, session).payloadBase64).toBe(original.payloadBase64)
  expect(withFile.trend).toEqual([])
  expect(withFile.sources).toEqual([])

  const correctedDraft: DeliveryDraft = { ...draft, confirmations: {}, lines: [{ ...draft.lines[0]!, id: lineId, unitPrice: 10, amount: 20 }] }
  const revised = service.execute({ ...envelope, commandId: 'price-revise', action: 'revise', id: archived.id, baseVersion: attached.version, reason: '核对单价', draft: correctedDraft }, session)
  const priced = project()
  expect(priced.trend).toHaveLength(1)
  expect(priced.trend[0]!.facts).toEqual([expect.objectContaining({ deliveryRecordId: archived.id, price: 10, projectId: 'p1', supplierId: 's1', provenance: expect.objectContaining({ sourceRecordId: archived.id, sourceLineId: lineId }) })])
  expect(priced.sources).toEqual([expect.objectContaining({ kind: 'delivery', sourceId: archived.id, lineId, version: revised.version, unitPrice: 10, quantity: 2, fileIds: [assetId] })])
  expect(service.version(archived.id, attached.version, session)).toMatchObject({ assetId, lines: [{ id: lineId, unitPrice: null, amount: null }] })

  const replacement = file('replacement original')
  const replaced = service.execute({ ...envelope, commandId: 'price-replace', action: 'source', id: archived.id, baseVersion: revised.version, reason: '更换合成原件', source: replacement }, session)
  const afterReplacement = project()
  const replacementId = afterReplacement.records[0]!.assetId!
  expect(replacementId).not.toBe(assetId)
  expect(afterReplacement.sources).toEqual([expect.objectContaining({ sourceId: archived.id, lineId, version: replaced.version, unitPrice: 10, fileIds: [replacementId] })])
  expect(service.fileContent(archived.id, assetId, session).payloadBase64).toBe(original.payloadBase64)
  expect(service.fileContent(archived.id, replacementId, session).payloadBase64).toBe(replacement.payloadBase64)
  expect(service.version(archived.id, revised.version, session)).toMatchObject({ assetId, lines: [{ id: lineId, unitPrice: 10 }] })

  const deleted = service.execute({ ...envelope, commandId: 'price-delete', action: 'delete', id: archived.id, baseVersion: replaced.version, reason: '删除合成送货单' }, session)
  expect(project()).toEqual({ records: [], trend: [], sources: [] })
  expect(() => service.fileContent(archived.id, assetId, session)).toThrow('送货记录不存在或已删除')
  const restored = service.execute({ ...envelope, commandId: 'price-restore', action: 'restore', id: archived.id, baseVersion: deleted.version, reason: '恢复合成送货单' }, session)
  expect(project().sources).toEqual([expect.objectContaining({ sourceId: archived.id, lineId, version: restored.version, unitPrice: 10, fileIds: [replacementId] })])
  expect(service.fileContent(archived.id, assetId, session).payloadBase64).toBe(original.payloadBase64)
  expect(service.fileContent(archived.id, replacementId, session).payloadBase64).toBe(replacement.payloadBase64)
})
