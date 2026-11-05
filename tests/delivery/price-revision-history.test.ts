import type { DeliveryDraft } from '~/lib/delivery-record/contract'
import { expect, it } from 'vitest'
import { createDeliveryCommandService } from '../../server/utils/delivery-command-service'

it('多行价格修订和撤回保留快照与单据原因，删除重加不能冒认原行', () => {
  const session = { workspaceId: 'history-workspace', actorId: 'history-owner', capabilities: ['delivery:read', 'delivery:write', 'project:list:read', 'supplier:list:read'] }
  const references = { projects: [{ id: 'p1', name: '合成项目', dataOrigin: 'real' as const }], suppliers: [{ id: 's1', name: '合成分供方', dataOrigin: 'real' as const }] }
  let sequence = 0
  const service = createDeliveryCommandService({ references: () => references, createId: () => `history-${++sequence}`, now: () => '2026-09-11T02:00:00.000Z' })
  const envelope = { workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'delivery:write' as const, origin: 'real' as const }
  const draft: DeliveryDraft = { projectId: 'p1', supplierId: 's1', orderNo: 'HISTORY-1', deliveryDate: '2026-09-11', note: '', rawSiteText: '', reviewFlag: '', confirmations: {}, lines: [{ materialName: '钢筋', spec: '', unit: '吨', qty: 2, unitPrice: 10, amount: 20, amountSource: 'calculated', note: '' }, { materialName: '水泥', spec: '', unit: '吨', qty: 2, unitPrice: 20, amount: 40, amountSource: 'calculated', note: '' }] }
  const payloadBase64 = btoa('%PDF-1.7\nsynthetic revision history\n%%EOF')
  const original = { fileName: '合成原件.pdf', mimeType: 'application/pdf', fileSize: atob(payloadBase64).length, payloadBase64 }
  const archived = service.execute({ ...envelope, commandId: 'history-archive', action: 'archive', baseVersion: null, uploadBatchId: 'history-upload', source: original, draft }, session)
  const initial = service.detail(archived.id, session)
  const [firstId, secondId] = initial.lines.map(line => line.id)
  expect(firstId).toBeTruthy()
  expect(secondId).toBeTruthy()
  expect(firstId).not.toBe(secondId)
  const firstDraft: DeliveryDraft = { ...draft, lines: [{ ...draft.lines[0]!, id: firstId, unitPrice: 12, amount: 24 }, { ...draft.lines[1]!, id: secondId }] }
  const first = service.execute({ ...envelope, commandId: 'history-revise-first', action: 'revise', id: archived.id, baseVersion: archived.version, reason: '修订单据第一行价格', draft: firstDraft }, session)
  const secondDraft: DeliveryDraft = { ...firstDraft, lines: [firstDraft.lines[0]!, { ...firstDraft.lines[1]!, unitPrice: 25, amount: 50 }] }
  const second = service.execute({ ...envelope, commandId: 'history-revise-second', action: 'revise', id: archived.id, baseVersion: first.version, reason: '修订单据第二行价格', draft: secondDraft }, session)
  const undoPrice = service.execute({ ...envelope, commandId: 'history-undo-price', action: 'undo', id: archived.id, baseVersion: second.version, revisionId: second.revisionId, reason: '撤回第二行改价' }, session)
  const redone = service.execute({ ...envelope, commandId: 'history-revise-second-again', action: 'revise', id: archived.id, baseVersion: undoPrice.version, reason: '重新核对第二行价格', draft: secondDraft }, session)
  const note = service.execute({ ...envelope, commandId: 'history-revise-note', action: 'revise', id: archived.id, baseVersion: redone.version, reason: '修订单据备注', draft: { ...secondDraft, note: '更正备注' } }, session)
  const undone = service.execute({ ...envelope, commandId: 'history-undo-note', action: 'undo', id: archived.id, baseVersion: note.version, revisionId: note.revisionId, reason: '撤回备注修订' }, session)

  const beforeRemoval = service.history(archived.id, session)
  expect(beforeRemoval).toHaveLength(7)
  expect(beforeRemoval[1]).toMatchObject({ action: 'revise', reason: '修订单据第一行价格', before: { lines: [{ id: firstId, unitPrice: 10 }, { id: secondId, unitPrice: 20 }] }, after: { lines: [{ id: firstId, unitPrice: 12 }, { id: secondId, unitPrice: 20 }] } })
  expect(beforeRemoval[2]).toMatchObject({ action: 'revise', reason: '修订单据第二行价格', before: { lines: [{ id: firstId, unitPrice: 12 }, { id: secondId, unitPrice: 20 }] }, after: { lines: [{ id: firstId, unitPrice: 12 }, { id: secondId, unitPrice: 25 }] } })
  expect(beforeRemoval[3]).toMatchObject({ action: 'undo', reason: '撤回第二行改价', before: { lines: [{ id: firstId, unitPrice: 12 }, { id: secondId, unitPrice: 25 }] }, after: { lines: [{ id: firstId, unitPrice: 12 }, { id: secondId, unitPrice: 20 }] } })
  expect(beforeRemoval[4]).toMatchObject({ action: 'revise', reason: '重新核对第二行价格', before: { lines: [{ id: firstId, unitPrice: 12 }, { id: secondId, unitPrice: 20 }] }, after: { lines: [{ id: firstId, unitPrice: 12 }, { id: secondId, unitPrice: 25 }] } })
  expect(beforeRemoval[5]).toMatchObject({ action: 'revise', reason: '修订单据备注', before: { note: '', lines: [{ id: firstId, unitPrice: 12 }, { id: secondId, unitPrice: 25 }] }, after: { note: '更正备注', lines: [{ id: firstId, unitPrice: 12 }, { id: secondId, unitPrice: 25 }] } })
  expect(beforeRemoval[6]).toMatchObject({ action: 'undo', reason: '撤回备注修订', before: { note: '更正备注' }, after: { note: '', lines: [{ id: firstId, unitPrice: 12 }, { id: secondId, unitPrice: 25 }] } })

  const removed = service.execute({ ...envelope, commandId: 'history-remove-first', action: 'revise', id: archived.id, baseVersion: undone.version, reason: '移除第一行', draft: { ...secondDraft, lines: [secondDraft.lines[1]!] } }, session)
  const readded = service.execute({ ...envelope, commandId: 'history-add-first', action: 'revise', id: archived.id, baseVersion: removed.version, reason: '另加同名材料', draft: { ...secondDraft, lines: [secondDraft.lines[1]!, { ...draft.lines[0]! }] } }, session)
  const current = service.detail(archived.id, session)
  const replacementId = current.lines[1]!.id
  expect(replacementId).not.toBe(firstId)
  expect(replacementId).not.toBe(secondId)
  expect(current).toMatchObject({ version: readded.version, lines: [{ id: secondId, unitPrice: 25 }, { id: replacementId, materialName: '钢筋', unitPrice: 10 }] })
  const history = service.history(archived.id, session)
  expect(history).toHaveLength(9)
  expect(history[7]).toMatchObject({ reason: '移除第一行', before: { lines: [{ id: firstId }, { id: secondId }] }, after: { lines: [{ id: secondId }] } })
  expect(history[8]).toMatchObject({ reason: '另加同名材料', before: { lines: [{ id: secondId }] }, after: { lines: [{ id: secondId }, { id: replacementId }] } })
  expect(service.version(archived.id, first.version, session)).toMatchObject({ lines: [{ id: firstId, unitPrice: 12 }, { id: secondId, unitPrice: 20 }] })
  expect(service.fileContent(archived.id, initial.assetId!, session).payloadBase64).toBe(payloadBase64)
  expect(current.lines.every(line => !Object.hasOwn(line, 'originalOcrUnitPrice'))).toBe(true)
})
