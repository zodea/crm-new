import type { BoqCommand } from '../../app/lib/boq/production-contract'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { ensureQuantityExternalReferences } from '../../app/lib/quantity/central-reference'
import { readProductionBoqQuantityFacts } from '../../server/utils/production-boq-record'
import { createProductionBoqService, productionBoqRecoveryDescriptor } from '../../server/utils/production-boq-service'
import { validateProductionBoqState } from '../../server/utils/production-boq-validation'
import { createProductionConstructionContractService } from '../../server/utils/production-construction-contract-service'
import { createProductionCustomerService } from '../../server/utils/production-customer-service'
import { createProductionOurSignatoryService } from '../../server/utils/production-our-signatory-service'
import { createProductionProjectService } from '../../server/utils/production-project-service'
import { createProductionQuantityService } from '../../server/utils/production-quantity-service'
import { validateProductionQuantityState } from '../../server/utils/production-quantity-validation'
import { createProductionStorage } from '../../server/utils/production-storage'
import { runColdProcess } from '../helpers/cold-process'

it('真实Node原上游master+完整BOQbytes同盘读写，原号重放/原件保全/false0与E独立源', async () => {
  const base = resolve('.tmp/opt02-boq')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/node-smoke-`)
  const storage = createProductionStorage({ directory, workspaceId: 'boq-workspace', ownerId: 'boq-owner', purpose: 'verification' })
  const actor = { workspaceId: 'boq-workspace', actorId: 'boq-owner', capabilities: ['customer:list:read', 'customer:write', 'project:list:read', 'project:write', 'construction-contract:read', 'construction-contract:write', 'our-signatory:read', 'our-signatory:write', 'boq:read', 'boq:write', 'owner-document:read', 'owner-document:write'] }
  const session = () => structuredClone(actor)
  try {
    const customer = await createProductionCustomerService(storage).execute({ commandId: 'boq-customer-original', workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'customer:write', baseVersion: null, action: 'draft', draft: { name: 'BOQ真实甲方' }, attachments: {} }, session)
    const project = await createProductionProjectService(storage).execute({ commandId: 'boq-project-original', workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'project:write', baseVersion: null, action: 'draft', draft: { name: 'BOQ真实项目', code: 'BOQ-ORIG', customerId: customer.id }, attachments: {} }, session)
    const signatory = await createProductionOurSignatoryService(storage).execute({ commandId: 'boq-signatory-original', workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'our-signatory:write', baseVersion: null, draft: { name: 'BOQ我方真实公司', taxNo: 'BOQ-ID', registeredAddress: null, legalRepresentative: null, verificationNote: '实际签约文件', status: 'active' } }, session)
    const parent = await createProductionConstructionContractService(storage).execute({ commandId: 'boq-construction-original', workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'construction-contract:write', baseVersion: null, action: 'save', draft: { name: 'BOQ施工主合同', no: 'BOQ-CONTRACT', projectId: project.id, customerId: customer.id, content: '真实施工范围', signDate: '2026-10-07', amount: null, taxRate: 0, ourSignatoryId: signatory.id, ourSignatoryVersion: signatory.version, status: '履约中' }, attachments: {} }, session)
    const owner = createProductionBoqService(storage)
    const scope = { projectId: project.id, contractId: parent.id, origin: 'real' as const }
    const initial = await owner.read(scope, session)
    expect(initial.lines).toEqual([])
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['分项名称', '单位', '工程量', '合同单价'], ['腻子', '㎡', 0, 12]]), '真实清单')
    const bytes = Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const row = { section: '装修', trade: '油漆工', itemCode: '', itemName: '腻子', unit: '㎡', qty: 0, totalQty: null, unitPrice: 12, amount: 0, building: '1栋', unitType: '', multiplier: null, room: '', floorZone: '', spec: '', taxRate: null, ownerSupplied: false, sourceSheet: '真实清单', sourceRow: 2 }
    const command: BoqCommand = { ...scope, workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'boq-file-original', requiredCapability: 'boq:write', contractVersion: initial.contractVersion, action: { kind: 'import-file', original: { fileName: '原清单.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileSize: bytes.length, sha256, payloadBase64: bytes.toString('base64') }, formatClass: 'D', rows: [row], bindings: [{ rowKey: '0', itemId: null, itemVersion: null }] } }
    const saved = await owner.execute(command, session)
    expect(await owner.execute(command, session)).toEqual(saved)
    const actual = await owner.read(scope, session)
    expect(actual.lines).toEqual([expect.objectContaining({ id: saved.lineIds![0], qty: 0, unitPrice: 12, recognizedQty: 0, approvedDeltaQty: 0 })])
    expect(await owner.resolve(productionBoqRecoveryDescriptor(command), session)).toEqual({ outcome: 'applied', result: saved })
    const [file] = await storage.select<{ content: Uint8Array, sha256: string }>('SELECT body.content,body.sha256 FROM file_payloads body JOIN boq_files f ON f.file_ref_id=body.file_ref_id WHERE f.id=?', [saved.fileId])
    expect(Buffer.from(file!.content).equals(bytes)).toBe(true)
    expect(file!.sha256).toBe(sha256)
    expect((await owner.file({ ...scope, ownerKind: 'boq-file', ownerId: saved.fileId!, fileId: actual.files[0]!.fileRefId }, session)).bytes.equals(bytes)).toBe(true)
    await expect(owner.file({ ...scope, ownerKind: 'boq-file', ownerId: 'another-owner', fileId: actual.files[0]!.fileRefId }, session)).rejects.toMatchObject({ problem: { code: 'not-found' } })
    await expect(owner.file({ ...scope, ownerKind: 'boq-file', ownerId: saved.fileId!, fileId: actual.files[0]!.fileRefId }, () => ({ ...actor, capabilities: actor.capabilities.filter(value => value !== 'owner-document:read') }))).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    const [intent] = await storage.select<{ request_json: string }>('SELECT request_json FROM boq_command_intents WHERE command_id=?', [command.commandId])
    expect(intent!.request_json).not.toContain(command.action.kind === 'import-file' ? command.action.original.payloadBase64 : '')
    const facts = await storage.withTransaction(tx => readProductionBoqQuantityFacts(tx, project.id, actor, { lineIds: saved.lineIds }))
    expect(facts.lines).toEqual([expect.objectContaining({ id: saved.lineIds![0], qty: 0, effectiveUnitPrice: 12 })])
    const changeDraft = { projectId: project.id, contractId: parent.id, no: 'BOQ-QTY-CHANGE', name: '真实已批调量', documentType: 'change_negotiation', applicationDate: '2026-10-07', reason: '原施工明确增量依据', note: '保真实零再增2', lines: [{ id: 'change-line-1', operation: 'qty', boqLineId: saved.lineIds![0], deltaQty: 2, newUnitPrice: null }] }
    const changeCommand = (commandId: string, action: 'save' | 'submit' | 'approve', id: string | null, version: string | null): BoqCommand => ({ ...command, commandId, action: { kind: 'owner-change', command: action === 'approve'
      ? { workspaceId: actor.workspaceId, actorId: actor.actorId, commandId, requiredCapability: 'owner-document:write', kind: 'owner_change', id: id!, baseVersion: version, action, approvedAt: '2026-10-07' }
      : { workspaceId: actor.workspaceId, actorId: actor.actorId, commandId, requiredCapability: 'owner-document:write', kind: 'owner_change', id, baseVersion: version, action, draft: structuredClone(changeDraft), attachments: {} } } })
    const draft = await owner.execute(changeCommand('boq-change-save', 'save', null, null), session)
    expect((await owner.read(scope, session)).lines[0]?.approvedDeltaQty).toBe(0)
    const submitted = await owner.execute(changeCommand('boq-change-submit', 'submit', draft.changeId!, '1'), session)
    expect(submitted.changeId).toBe(draft.changeId)
    expect((await owner.read(scope, session)).lines[0]?.approvedDeltaQty).toBe(0)
    await owner.execute(changeCommand('boq-change-approve', 'approve', draft.changeId!, '2'), session)
    const after = await owner.read(scope, session)
    expect(after.lines).toEqual([expect.objectContaining({ qty: 0, recognizedQty: 0, approvedDeltaQty: 2, effectiveUnitPrice: 12 })])
    expect(after.changes[0]?.document.lines[0]).toMatchObject({ contractQty: 0, contractUnitPrice: 12, deltaQty: 2, amount: 24 })
    const revision = changeCommand('boq-price-save', 'save', null, null)
    if (revision.action.kind === 'owner-change' && revision.action.command.action === 'save')
      revision.action.command.draft = { ...changeDraft, no: 'BOQ-PRICE-CHANGE', name: '真实已批调价', lines: [{ id: 'change-line-1', operation: 'price', boqLineId: saved.lineIds![0], deltaQty: null, newUnitPrice: 10 }] }
    const priceDraft = await owner.execute(revision, session)
    const priceSubmit = { ...revision, commandId: 'boq-price-submit' }
    if (priceSubmit.action.kind === 'owner-change' && priceSubmit.action.command.action === 'save')
      priceSubmit.action = { kind: 'owner-change', command: { ...priceSubmit.action.command, commandId: priceSubmit.commandId, id: priceDraft.changeId!, baseVersion: '1', action: 'submit' } }
    await owner.execute(priceSubmit, session)
    const priceApprove = changeCommand('boq-price-approve', 'approve', priceDraft.changeId!, '2')
    await owner.execute(priceApprove, session)
    expect((await owner.read(scope, session)).lines[0]).toMatchObject({ qty: 0, unitPrice: 12, approvedDeltaQty: 2, effectiveUnitPrice: 10 })
    const priceOnly: BoqCommand = { ...command, commandId: 'boq-independent-e-price', action: { ...command.action, kind: 'import-file', formatClass: 'E' } }
    const e = await owner.execute(priceOnly, session)
    expect(e.lineIds).toEqual([])
    expect(e.priceIds).toHaveLength(1)
    const afterE = await owner.read(scope, session)
    expect(afterE.lines.map(row => row.id)).toEqual(saved.lineIds)
    expect(afterE.prices).toEqual([expect.objectContaining({ id: e.priceIds![0], unitPrice: 12 })])
    expect(await storage.select('SELECT file_ref_id FROM file_payloads')).toHaveLength(1)
    expect((await owner.catalog(session)).contracts.find(row => row.id === parent.id)?.lineCount).toBe(1)
    const readonly = await storage.withTransaction(tx => validateProductionBoqState({ select: tx.select, execute: async () => {
      throw new Error('readonly validation attempted a mutation')
    } }))
    expect([...readonly.metadataOnlyFileIds]).toEqual([])
    await expect(storage.withTransaction(async (tx) => {
      await tx.execute('UPDATE file_refs SET owner_id=? WHERE id=(SELECT file_ref_id FROM boq_files WHERE id=?)', ['another-boq-file', saved.fileId])
      await validateProductionBoqState(tx)
    })).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await expect(storage.withTransaction(async (tx) => {
      await tx.execute('UPDATE file_payloads SET content=?', [Buffer.from('altered original')])
      await validateProductionBoqState(tx)
    })).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    expect(Buffer.from((await storage.select<{ content: Uint8Array }>('SELECT content FROM file_payloads'))[0]!.content).equals(bytes)).toBe(true)
    actor.capabilities.push('quantity:read', 'quantity:write', 'crew:list:read', 'worker:list:read')
    const quantity = createProductionQuantityService(storage).forSession(session)
    const query = { projectId: project.id, origin: 'real' as const, includeDemo: false }
    const region = await quantity.region(query)
    const building = await quantity.execute({ projectId: query.projectId, origin: 'real', workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'quantity:write', commandId: 'boq-actual-building', baseVersion: region.sourceVersion, action: { kind: 'create-building', draft: { code: '1', name: '实际1栋' } } })
    const buildingContext = await owner.building(scope, session)
    const correction = { ...scope, workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'boq-building-original-command', requiredCapability: 'owner-document:write' as const, sourceVersion: buildingContext.sourceVersion, contractVersion: buildingContext.contractVersion!, lineId: saved.lineIds![0]!, lineVersion: buildingContext.lines.find(line => line.id === saved.lineIds![0])!.version!, buildingId: building.id, buildingVersion: buildingContext.buildings.find(row => row.id === building.id)!.version!, reason: '原书面楼栋确认，关联稳定实际ID' }
    const sibling = await quantity.region(query)
    await quantity.execute({ projectId: query.projectId, origin: 'real', workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'quantity:write', commandId: 'boq-unrelated-building', baseVersion: sibling.sourceVersion, action: { kind: 'create-building', draft: { code: '2', name: '未选择另一栋' } } })
    const currentLine = (await owner.read(scope, session)).lines.find(row => row.id === saved.lineIds![0])!
    await owner.execute({ ...command, commandId: 'boq-unconsumed-price-before-building', action: { kind: 'patch-line', lineId: currentLine.id, version: currentLine.version, patch: { unitPrice: 19 } } }, session)
    const corrected = await owner.correctBuilding(correction, session)
    expect(corrected).toMatchObject({ commandId: correction.commandId, buildingId: building.id, lineId: currentLine.id, building: '1' })
    expect(await owner.correctBuilding(correction, session)).toEqual(corrected)
    expect((await owner.building(scope, session)).audit).toContainEqual(expect.objectContaining({ commandId: correction.commandId, buildingId: building.id, source: expect.objectContaining({ confirmed: true }) }))
    expect((await owner.read(scope, session)).lines.find(row => row.id === currentLine.id)).toMatchObject({ unitPrice: 19, declaredBuildingId: building.id })
    const changeId = draft.changeId!
    const attachment = Buffer.from('真实签证原件完整字节\u0000\uFFFD', 'utf8')
    const addAttachment: BoqCommand = { ...command, commandId: 'boq-daily-original-attachment', action: { kind: 'owner-change', command: { workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'boq-daily-original-attachment', requiredCapability: 'owner-document:write', kind: 'owner_change', id: changeId, baseVersion: (await owner.read(scope, session)).changes.find(row => row.id === changeId)!.version, action: 'attachments', attachments: { add: [{ fileName: '已签原件.pdf', mimeType: 'application/pdf', fileSize: attachment.length, category: 'owner_directive', payloadBase64: attachment.toString('base64') }] } } } }
    const attached = await owner.execute(addAttachment, session)
    expect(await owner.execute(addAttachment, session)).toEqual(attached)
    const document = (await owner.read(scope, session)).changes.find(row => row.id === changeId)!.document
    expect(document.status).toBe('approved')
    const attachedFile = document.files[0]!
    expect((await owner.file({ ...scope, ownerKind: 'owner-change', ownerId: changeId, fileId: attachedFile.id }, session)).bytes.equals(attachment)).toBe(true)
    const [storedIntent] = await storage.select<{ request_json: string }>('SELECT request_json FROM boq_command_intents WHERE command_id=?', [addAttachment.commandId])
    expect(storedIntent!.request_json).not.toContain('payloadBase64')
    expect(storedIntent!.request_json).not.toContain(attachment.toString('base64'))
    expect(JSON.parse(storedIntent!.request_json).action.command.attachments.add[0]).toMatchObject({ fileRefId: attachedFile.fileRefId, sha256: attachedFile.sha256 })
    const attachmentsCommand = (commandId: string, attachments: object, baseVersion: string): BoqCommand => ({ ...command, commandId, action: { kind: 'owner-change', command: { workspaceId: actor.workspaceId, actorId: actor.actorId, commandId, requiredCapability: 'owner-document:write', kind: 'owner_change', id: changeId, baseVersion, action: 'attachments', attachments } } })
    const duplicate = attachmentsCommand('boq-second-logical-attachment', { add: [{ fileName: '同原件另描述.pdf', mimeType: 'application/pdf', fileSize: attachment.length, payloadBase64: attachment.toString('base64') }] }, String(document.version))
    await owner.execute(duplicate, session)
    const withTwo = (await owner.read(scope, session)).changes.find(row => row.id === changeId)!.document
    expect(withTwo.files).toHaveLength(2)
    expect(withTwo.files[1]!.fileRefId).toBe(attachedFile.fileRefId)
    expect(await storage.select('SELECT * FROM file_payloads')).toHaveLength(2)
    await owner.execute(attachmentsCommand('boq-original-attachment-hide', { removeIds: [attachedFile.id] }, String(withTwo.version)), session)
    await expect(owner.file({ ...scope, ownerKind: 'owner-change', ownerId: changeId, fileId: attachedFile.id }, session)).rejects.toMatchObject({ problem: { code: 'not-found' } })
    expect((await owner.file({ ...scope, ownerKind: 'owner-change', ownerId: changeId, fileId: withTwo.files[1]!.id }, session)).bytes.equals(attachment)).toBe(true)
    const hidden = (await owner.read(scope, session)).changes.find(row => row.id === changeId)!.document
    const restoreCommand = attachmentsCommand('boq-original-attachment-restore', { restoreIds: [attachedFile.id] }, String(hidden.version))
    const restoredAttachment = await owner.execute(restoreCommand, session)
    expect((await owner.file({ ...scope, ownerKind: 'owner-change', ownerId: changeId, fileId: attachedFile.id }, session)).bytes.equals(attachment)).toBe(true)
    await expect(owner.execute(attachmentsCommand('boq-malformed-attachment', { add: [{ fileName: 'fake.pdf', fileSize: 1, payloadBase64: 'YWJj', unexpected: true }] }, String(hidden.version)), session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    const nested = changeCommand('boq-unclosed-draft', 'save', null, null)
    if (nested.action.kind === 'owner-change' && nested.action.command.action === 'save')
      nested.action.command.draft.unexpected = 'silent data'
    await expect(owner.execute(nested, session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    const nestedLine = changeCommand('boq-unclosed-line', 'save', null, null)
    if (nestedLine.action.kind === 'owner-change' && nestedLine.action.command.action === 'save')
      nestedLine.action.command.draft.lines![0]!.contractQty = 999
    await expect(owner.execute(nestedLine, session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(storage.withTransaction(async (tx) => {
      const wrong = { ...restoredAttachment, action: 'patch-line' }
      await tx.execute('UPDATE boq_commands SET result_json=? WHERE command_id=?', [JSON.stringify(wrong), restoreCommand.commandId])
    })).rejects.toThrow('Original BOQ evidence is immutable')
    await expect(storage.withTransaction(tx => validateProductionBoqState({ async select<T>(sql: string, params?: unknown[]) {
      const rows = await tx.select<Record<string, unknown>>(sql, params)
      if (sql === 'SELECT * FROM boq_commands')
        return rows.map(row => row.command_id === restoreCommand.commandId ? { ...row, result_json: JSON.stringify({ ...restoredAttachment, action: 'patch-line' }) } : row) as T[]
      return rows as T[]
    } }))).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await storage.withTransaction(tx => validateProductionBoqState(tx))
    await storage.withTransaction(async (tx) => {
      const proof = await readProductionBoqQuantityFacts(tx, project.id, actor, { lineIds: saved.lineIds })
      expect(proof.lines[0]?.eligible).toBe(true)
      await ensureQuantityExternalReferences(tx, { contracts: [{ id: parent.id, projectId: project.id }], lines: proof.lines.map(row => ({ id: row.id, projectId: project.id, contractId: row.contractId })) })
      await validateProductionQuantityState({ select: tx.select, execute: async () => {
        throw new Error('readonly locator validation mutated')
      } })
    })
    await expect(storage.withTransaction(async (tx) => {
      await tx.execute('INSERT INTO quantity_boq_references VALUES (?,?,?)', ['unproven-current-boq', project.id, parent.id])
      await validateProductionQuantityState(tx)
    })).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    const itemWorkspace = await quantity.templates(query)
    await quantity.execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, projectId: project.id, origin: 'real', requiredCapability: 'quantity:write', commandId: 'boq-real-item-owner-template', baseVersion: itemWorkspace.sourceVersion, action: { kind: 'save-template', draft: { id: null, projectId: project.id, code: 'BOQ-ITEM', name: '实际分项资格模板', copiedFromTemplateId: null, expectedUpdatedAt: null, sortOrder: 0, rooms: [{ key: 'whole', id: null, code: '__whole_unit__', name: '整户范围', kind: 'whole_unit', sortOrder: 0 }], newItems: [{ key: 'item', code: 'BOQ-ITEM', name: '同项目真实分项', section: '装修', trade: '油漆工', unit: '㎡', sortOrder: 0 }], lines: [{ key: 'line', id: null, roomKey: 'whole', itemId: 'item', recognizedContractQty: null, contractQty: null, provisionalQty: 0, fieldFormula: '', fieldQty: null, note: '', sortOrder: 0 }] } } })
    const selectedItem = (await owner.items(scope, session)).find(item => item.code === 'BOQ-ITEM')!
    const selectedLine = (await owner.read(scope, session)).lines.find(row => row.id === currentLine.id)!
    const bindItem: BoqCommand = { ...command, commandId: 'boq-real-patch-item-proof', action: { kind: 'patch-line', lineId: selectedLine.id, version: selectedLine.version, itemVersion: selectedItem.version, patch: { itemId: selectedItem.id } } }
    await expect(owner.execute({ ...bindItem, commandId: 'boq-patch-item-missing-version', action: { ...bindItem.action, itemVersion: undefined } }, session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(owner.execute({ ...bindItem, commandId: 'boq-patch-item-wrong-version', action: { ...bindItem.action, itemVersion: 'another-item-version' } }, session)).rejects.toMatchObject({ problem: { code: 'stale-source' } })
    await storage.execute('UPDATE items SET deleted_at=? WHERE id=?', ['2026-10-07T10:00:00.000Z', selectedItem.id])
    await expect(owner.execute({ ...bindItem, commandId: 'boq-patch-item-hidden-source' }, session)).rejects.toMatchObject({ problem: { code: 'stale-source' } })
    await storage.execute('UPDATE items SET deleted_at=NULL WHERE id=?', [selectedItem.id])
    await owner.execute(bindItem, session)
    expect((await owner.read(scope, session)).lines.find(row => row.id === selectedLine.id)?.itemId).toBe(selectedItem.id)
    const coldDirectory = resolve(directory, 'cold-daily')
    await mkdir(coldDirectory)
    await storage.backupTo(resolve(coldDirectory, 'ruihang.sqlite'))
    const output = resolve(directory, 'cold-daily.json')
    await runColdProcess('production-boq-cold', [coldDirectory, JSON.stringify(actor), JSON.stringify(scope), JSON.stringify(productionBoqRecoveryDescriptor(restoreCommand)), output])
    const cold = JSON.parse(await readFile(output, 'utf8'))
    expect(cold.resolution).toEqual({ outcome: 'applied', result: restoredAttachment })
    expect(cold.downloaded).toContainEqual({ ownerId: changeId, fileId: attachedFile.id, sha256: attachedFile.sha256, bytes: attachment.length })
    expect((await readFile(cold.originals.find((row: { fileRefId: string }) => row.fileRefId === attachedFile.fileRefId).path)).equals(attachment)).toBe(true)
  }
  finally { await storage.close() }
}, 30_000)
