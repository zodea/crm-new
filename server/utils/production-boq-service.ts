import type { BoqCommand, BoqCommandResult, BoqScope, ProductionBoqChangeDocument, ProductionBoqRead } from '../../app/lib/boq/production-contract'
import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CommandRecoveryDescriptor } from '../../app/lib/forms/command-recovery'
import type { BusinessSession } from './business-session'
import type { BoqFileRecord, BoqLineRecord, BoqPriceRecord } from './production-boq-record'
import type { ProductionStorage } from './production-storage'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { parseBoqBuildingCommand } from '../../app/lib/boq/central-building-request'
import { boqRecoveryDescriptor } from '../../app/lib/boq/command-recovery'
import { parseBoqWorkbook } from '../../app/lib/boq/import'
import { loadProductionBoqBuilding } from './production-boq-building'
import { assertProductionBoq, boqDigest, boqFail, productionBoqAttachmentId, productionBoqContractReference, productionBoqHeadVersion, productionBoqOwnerInTransaction, productionBoqRequestSummary, readProductionBoqChanges, readProductionBoqQuantityFacts, readProductionBoqRows } from './production-boq-record'
import { parseProductionBoqCommand } from './production-boq-request'
import { validateProductionBoqState } from './production-boq-validation'
import { readProductionConstructionContractFacts } from './production-construction-contract-sources'
import { assertProductionOwnerDocumentCommandNamespace } from './production-owner-document-record'
import { quantityCanonical } from './production-quantity-record'

type Session = () => BusinessSession
const keyOf = (value: { workspaceId: string, actorId: string, commandId: string }) => [value.workspaceId, value.actorId, value.commandId]
const fileIdFor = (command: BoqCommand) => `boq-file-${boqDigest(keyOf(command)).slice(0, 24)}`
const originalIdFor = (command: BoqCommand) => `boq-original-${boqDigest(keyOf(command)).slice(0, 24)}`
const requestSummary = productionBoqRequestSummary

async function stageOriginal(tx: TransactionDb, file: { fileName: string, fileSize: number, mimeType: string, sha256: string }, bytes: Buffer, refId: string, ownerId: string, actorId: string) {
  const [same] = await tx.select<{ id: string, content: Uint8Array }>('SELECT f.id,b.content FROM file_refs f JOIN file_payloads b ON b.file_ref_id=f.id WHERE f.owner_type IN (\'boq_original\',\'boq_file\',\'boq_change_order\',\'owner_change_order\') AND b.sha256=? AND f.file_size=? AND f.mime_type=? ORDER BY f.id LIMIT 1', [file.sha256, file.fileSize, file.mimeType])
  if (same) {
    if (!Buffer.from(same.content).equals(bytes))
      return boqFail('unavailable', '同摘要原件正文不能互证，保留已有原件')
    return same.id
  }
  await tx.execute('INSERT INTO file_refs VALUES (?,?,?,?,?,?,?,?,?,?,NULL)', [refId, 'boq_original', ownerId, file.fileName, '', file.fileSize, file.mimeType, 'original_boq', actorId, new Date().toISOString()])
  await tx.execute('INSERT INTO file_payloads VALUES (?,?,?)', [refId, bytes, file.sha256])
  return refId
}

function originalBytes(command: BoqCommand) {
  if (command.action.kind !== 'import-file')
    return null
  const original = command.action.original
  const bytes = Buffer.from(original.payloadBase64, 'base64')
  if (!bytes.length || bytes.length !== original.fileSize || bytes.toString('base64') !== original.payloadBase64 || createHash('sha256').update(bytes).digest('hex') !== original.sha256)
    return boqFail('validation-failed', '清单原文件必须是完整原字节，大小和 SHA-256 不符不能采用')
  return bytes
}
async function history(tx: TransactionDb, command: BoqCommand, entity: string, id: string, before: unknown, after: unknown) {
  await tx.execute('INSERT INTO boq_history VALUES (?,?,?,?,?,?,?,?,?,?)', [`boq-history-${randomUUID()}`, command.projectId, command.contractId, entity, id, command.actorId, command.commandId, before === null ? null : quantityCanonical(before), quantityCanonical(after), new Date().toISOString()])
}
async function advance(tx: TransactionDb) {
  await tx.execute('UPDATE boq_revision SET revision=revision+1 WHERE singleton=1')
}
export const productionBoqRecoveryDescriptor = boqRecoveryDescriptor

async function readScope(tx: TransactionDb, actor: BusinessSession, scope: BoqScope): Promise<ProductionBoqRead> {
  await assertProductionBoq(tx, actor)
  if (scope.origin !== 'real')
    return boqFail('forbidden', '清单上游不能从其他来源回落')
  const parent = await productionBoqContractReference(tx, actor, scope.contractId)
  if (parent.projectId !== scope.projectId)
    return boqFail('relationship-mismatch', '施工主合同不属于所选真实项目')
  if (['draft', '草稿'].includes(parent.status))
    return boqFail('unavailable', '施工主合同尚为草稿，清单不得冒充实际可用上游')
  const [files, originals, prices, changes, effective] = await Promise.all([
    readProductionBoqRows<BoqFileRecord>(tx, 'boq_files', scope.projectId, scope.contractId),
    readProductionBoqRows<BoqLineRecord>(tx, 'boq_lines', scope.projectId, scope.contractId),
    readProductionBoqRows<BoqPriceRecord>(tx, 'item_unit_prices', scope.projectId, scope.contractId),
    readProductionBoqChanges(tx, scope.projectId, scope.contractId),
    readProductionBoqQuantityFacts(tx, scope.projectId, actor, { contractIds: [scope.contractId] }),
  ])
  return { ...actor, ...scope, sourceVersion: `boq-workspace:${boqDigest({ files, originals, prices, changes })}`, contractVersion: productionBoqHeadVersion(parent), files: files.map(row => ({ ...row.value, version: row.version })), lines: originals.map(({ value }) => {
    const fact = effective.lines.find(row => row.id === value.id)
    if (!fact)
      return boqFail('unavailable', '原清单行没有同域实际有效来源，不能回填原价作为当前价')
    return { ...value, ...fact, contractName: parent.name, contractNo: parent.no, version: boqDigest(value) }
  }), prices: prices.map(row => ({ ...row.value, version: row.version })), changes: changes.map(row => ({ id: row.id, name: row.name, no: row.no, status: row.status, amount: row.boqAmount ?? row.amount, version: String(row.version), approvedAt: row.approvalDate ?? null, document: row })), monthlySourceState: 'unavailable' }
}

export function createProductionBoqService(storage: ProductionStorage) {
  const active = new Map<string, { fingerprint: string, promise: Promise<BoqCommandResult> }>()
  function authorize(session: Session, write = false) {
    const actor = structuredClone(session())
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId || !['boq:read', 'construction-contract:read', 'project:list:read', 'owner-document:read'].every(capability => actor.capabilities.includes(capability)) || (write && !actor.capabilities.includes('boq:write')))
      return boqFail('forbidden', '当前身份无本正式施工清单上游权限')
    return actor
  }
  async function run<T>(session: Session, write: boolean, work: (tx: TransactionDb, actor: BusinessSession) => Promise<T>) {
    const actor = authorize(session, write)
    if (write)
      storage.assertBusinessWrite()
    return storage.withTransaction(async (tx) => {
      await assertProductionBoq(tx, actor)
      const result = await work(tx, actor)
      if (boqDigest(authorize(session, write)) !== boqDigest(actor))
        return boqFail('forbidden', '操作期间上游身份或权限变化，原编号与原件保留')
      return result
    })
  }
  async function execute(input: unknown, session: Session): Promise<BoqCommandResult> {
    const command = parseProductionBoqCommand(input)
    const actor = authorize(session, true)
    if (command.workspaceId !== actor.workspaceId || command.actorId !== actor.actorId)
      return boqFail('forbidden', '原清单命令与当前真实身份不同')
    if (['owner-change', 'reject-change', 'correct-building'].includes(command.action.kind) && !actor.capabilities.includes('owner-document:write'))
      return boqFail('forbidden', '当前无原变洽签写权限，不能登记新意图或原件')
    const bytes = originalBytes(command)
    const attachmentFiles = command.action.kind === 'owner-change' && 'attachments' in command.action.command ? command.action.command.attachments.add ?? [] : []
    const attachmentBodies = attachmentFiles.map((file) => {
      const body = Buffer.from(file.payloadBase64!, 'base64')
      if (!body.length || body.length !== file.fileSize || body.toString('base64') !== file.payloadBase64)
        return boqFail('validation-failed', '签证原件须是规范完整原字节，大小不符不能保存')
      return body
    })
    let attachmentRefs: string[] = []
    const summary = requestSummary(command)
    const fingerprint = boqDigest(summary)
    let originalRef = originalIdFor(command)
    const key = quantityCanonical(keyOf(command))
    const pending = active.get(key)
    if (pending) {
      if (pending.fingerprint !== fingerprint)
        return boqFail('conflict', '原清单提交仍在处理，不能改用另一正文')
      return pending.promise
    }
    const promise = (async () => {
      await run(session, true, async (tx) => {
        if (command.action.kind === 'owner-change')
          await assertProductionOwnerDocumentCommandNamespace(tx, actor, command.action.command.commandId, 'owner_change', { boqCommandId: command.commandId })
        if (command.action.kind === 'owner-change'
          && (await tx.select('SELECT command_id FROM owner_document_command_resolutions WHERE workspace_id=? AND actor_id=? AND command_id=?', [command.workspaceId, command.actorId, command.action.command.commandId])).length) {
          return boqFail('conflict', '原商务签证编号已封存未应用，不能通过清单入口迟到重建')
        }
        const parent = await productionBoqContractReference(tx, actor, command.contractId)
        if (parent.projectId !== command.projectId)
          return boqFail('relationship-mismatch', '真实主合同与项目不同')
        if ((await tx.select('SELECT command_id FROM boq_resolutions WHERE workspace_id=? AND actor_id=? AND command_id=?', keyOf(command))).length)
          return boqFail('conflict', '原清单编号已封存未应用，迟到请求不能重建')
        const [existing] = await tx.select<{ fingerprint: string, request_json: string }>('SELECT * FROM boq_command_intents WHERE workspace_id=? AND actor_id=? AND command_id=?', keyOf(command))
        if (existing && existing.fingerprint !== fingerprint)
          return boqFail('conflict', '原清单编号已保存不同正文或原件')
        if (existing) {
          if (command.action.kind === 'import-file')
            originalRef = JSON.parse(existing.request_json).action.original.fileRefId
          else if (attachmentFiles.length)
            attachmentRefs = JSON.parse(existing.request_json).action.command.attachments.add.map((file: { fileRefId: string }) => file.fileRefId)
          return
        }
        if (bytes && command.action.kind === 'import-file') {
          const file = command.action.original
          originalRef = await stageOriginal(tx, file, bytes, originalRef, fileIdFor(command), actor.actorId)
        }
        for (const [index, file] of attachmentFiles.entries()) {
          const id = productionBoqAttachmentId(command, index)
          const body = attachmentBodies[index]!
          attachmentRefs.push(await stageOriginal(tx, { fileName: file.fileName, fileSize: body.length, mimeType: file.mimeType ?? '', sha256: createHash('sha256').update(body).digest('hex') }, body, id, id, actor.actorId))
        }
        await tx.execute('INSERT INTO boq_command_intents VALUES (?,?,?,?,?,?,?,?)', [...keyOf(command), command.projectId, command.contractId, fingerprint, quantityCanonical(requestSummary(command, originalRef, attachmentRefs)), new Date().toISOString()])
      })
      return run(session, true, async (tx) => {
        if (command.action.kind === 'owner-change')
          await assertProductionOwnerDocumentCommandNamespace(tx, actor, command.action.command.commandId, 'owner_change', { boqCommandId: command.commandId })
        if (command.action.kind === 'owner-change'
          && (await tx.select('SELECT command_id FROM owner_document_command_resolutions WHERE workspace_id=? AND actor_id=? AND command_id=?', [command.workspaceId, command.actorId, command.action.command.commandId])).length) {
          return boqFail('conflict', '原商务签证编号已明确未应用，不能迟到重建')
        }
        const [sealed] = await tx.select('SELECT command_id FROM boq_resolutions WHERE workspace_id=? AND actor_id=? AND command_id=?', keyOf(command))
        if (sealed)
          return boqFail('conflict', '原清单编号已明确未应用，不能迟到重建')
        const [previous] = await tx.select<{ fingerprint: string, result_json: string }>('SELECT * FROM boq_commands WHERE workspace_id=? AND actor_id=? AND command_id=?', keyOf(command))
        if (previous) {
          if (previous.fingerprint !== fingerprint)
            return boqFail('conflict', '原清单回执对应另一正文')
          return JSON.parse(previous.result_json) as BoqCommandResult
        }
        const parent = await productionBoqContractReference(tx, actor, command.contractId)
        if (parent.projectId !== command.projectId || productionBoqHeadVersion(parent) !== command.contractVersion)
          return boqFail('stale-source', '所选真实主合同关系或版本已变化，请保留原输入核对')
        if (['draft', '草稿'].includes(parent.status))
          return boqFail('unavailable', '所选施工主合同尚为草稿，不能采用实际清单上游')
        const now = new Date().toISOString()
        let result: Omit<BoqCommandResult, 'sourceVersion'> = { ...actor, commandId: command.commandId, projectId: command.projectId, contractId: command.contractId, id: command.contractId, action: command.action.kind }
        if (command.action.kind === 'import-file') {
          const action = command.action
          const parsed = parseBoqWorkbook(new Uint8Array(bytes!).buffer, action.original.fileName)
          if (action.rows.some(row => !parsed.sheets.some(sheet => sheet.name === row.sourceSheet && sheet.rows.some(source => source.sourceRow === row.sourceRow))))
            return boqFail('relationship-mismatch', '已确认行必须指向同一完整原文件实际sheet与行，不能补造追溯')
          const fileId = fileIdFor(command)
          const file: BoqFileRecord = { id: fileId, projectId: command.projectId, contractId: command.contractId, fileRefId: originalRef, fileName: action.original.fileName, sha256: action.original.sha256, fileSize: action.original.fileSize, mimeType: action.original.mimeType, formatClass: action.formatClass, createdAt: now, updatedAt: now, deletedAt: null }
          await tx.execute('INSERT INTO boq_files VALUES (?,?,?,?,?,?,?,NULL)', [fileId, command.projectId, command.contractId, file.fileRefId, quantityCanonical(file), now, now])
          await history(tx, command, 'boq_files', fileId, null, file)
          const lineIds: string[] = []
          const priceIds: string[] = []
          for (const [index, row] of action.rows.entries()) {
            const binding = action.bindings[index]!
            if (binding.itemId) {
              const [item] = await tx.select<Record<string, unknown>>('SELECT * FROM items WHERE id=? AND project_id=? AND deleted_at IS NULL', [binding.itemId, command.projectId])
              if (!item || boqDigest(item) !== binding.itemVersion)
                return boqFail('stale-source', '本行明确分项已变化，不能改接同名分项')
            }
            const traceKey = `${file.fileName}·${row.sourceSheet}·${row.sourceRow}`
            if (action.formatClass === 'E') {
              const id = `boq-price-${randomUUID()}`
              const price: BoqPriceRecord = { id, projectId: command.projectId, contractId: command.contractId, fileId, itemId: binding.itemId, itemName: row.itemName, itemCode: row.itemCode, unit: row.unit, unitPrice: row.unitPrice, spec: row.spec, traceKey, sourceSheet: row.sourceSheet, sourceRow: row.sourceRow, createdAt: now, updatedAt: now, deletedAt: null }
              await tx.execute('INSERT INTO item_unit_prices VALUES (?,?,?,?,?,?,?, ?,NULL)', [id, command.projectId, command.contractId, fileId, binding.itemId, quantityCanonical(price), now, now])
              await history(tx, command, 'item_unit_prices', id, null, price)
              priceIds.push(id)
            }
            else {
              const id = `boq-line-${randomUUID()}`
              const line: BoqLineRecord = { id, projectId: command.projectId, contractId: command.contractId, fileId, changeId: null, itemId: binding.itemId, itemName: row.itemName, unit: row.unit, qty: row.qty, unitPrice: row.unitPrice, building: row.building || null, unitType: row.unitType || null, floorZone: row.floorZone || null, section: row.section, trade: row.trade, room: row.room, spec: row.spec, multiplier: row.multiplier, taxRate: row.taxRate, ownerSupplied: row.ownerSupplied, recognizedQty: row.qty, recognizedUnitPrice: row.unitPrice, traceKey, sourceSheet: row.sourceSheet, sourceRow: row.sourceRow, confirmedOriginal: true, createdAt: now, updatedAt: now, deletedAt: null }
              await tx.execute('INSERT INTO boq_lines VALUES (?,?,?,?,?,?,?,?,?,NULL)', [id, fileId, null, command.projectId, command.contractId, binding.itemId, quantityCanonical(line), now, now])
              await history(tx, command, 'boq_lines', id, null, line)
              lineIds.push(id)
            }
          }
          result = { ...result, id: fileId, fileId, lineIds, priceIds }
        }
        else if (command.action.kind === 'correct-building') {
          if (!actor.capabilities.includes('owner-document:write'))
            return boqFail('forbidden', '当前无原清单楼栋更正权限')
          const action = command.action
          const { context, core, evidence } = await loadProductionBoqBuilding(tx, actor, command)
          const line = context.lines.find(row => row.id === action.lineId)
          const building = context.buildings.find(row => row.id === action.buildingId)
          if (!line || !building || line.version !== action.version || building.version !== action.buildingVersion)
            return boqFail('stale-source', '所选原清单声明、资格或实际楼栋已变化，请保留原更正依据')
          if (line.readOnlyReason)
            return boqFail('conflict', line.readOnlyReason)
          const saved = core.correctBoqBuilding({ workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: command.commandId, projectId: command.projectId, contractId: command.contractId, origin: 'real', requiredCapability: 'owner-document:write', sourceVersion: context.sourceVersion, lineId: action.lineId, buildingId: action.buildingId, reason: action.reason }, actor, evidence)
          const [before] = await readProductionBoqRows<BoqLineRecord>(tx, 'boq_lines', command.projectId, command.contractId).then(rows => rows.filter(row => row.value.id === action.lineId))
          const next = { ...before!.value, building: saved.building, declaredBuildingId: saved.buildingId, updatedAt: now }
          await tx.execute('UPDATE boq_lines SET record_json=?,updated_at=? WHERE id=?', [quantityCanonical(next), now, next.id])
          await history(tx, command, 'boq_lines', next.id, before!.value, next)
          const audit = core.boqBuildingContext({ projectId: command.projectId, contractId: command.contractId, origin: 'real' }, actor, evidence).audit.find(row => row.id === saved.auditId)!
          await history(tx, command, 'boq_building_evidence', next.id, null, audit)
          result = { ...result, id: next.id, buildingResult: saved }
        }
        else if (command.action.kind === 'patch-line' || command.action.kind === 'delete-line') {
          const action = command.action
          const source = (await readProductionBoqRows<BoqLineRecord>(tx, 'boq_lines', command.projectId, command.contractId)).find(row => row.value.id === action.lineId)
          if (!source || source.version !== action.version)
            return boqFail('stale-source', '原清单行身份或实际版本已变化')
          if (!source.value.fileId || source.value.changeId)
            return boqFail('conflict', '已签证新增行须沿原变洽签处理，不可直接改原清单')
          const file = (await readProductionBoqRows<BoqFileRecord>(tx, 'boq_files', command.projectId, command.contractId)).find(row => row.value.id === source.value.fileId)
          if (!source.value.confirmedOriginal || !file || file.value.formatClass === 'E')
            return boqFail('conflict', '当前原清单来源资格已失效，不能凭历史行ID更正')
          if (action.kind === 'patch-line' && typeof action.patch.itemId === 'string') {
            const [item] = await tx.select<Record<string, unknown>>('SELECT * FROM items WHERE id=? AND project_id=? AND deleted_at IS NULL', [action.patch.itemId, command.projectId])
            if (!item || boqDigest(item) !== action.itemVersion)
              return boqFail('stale-source', '明确分项的项目、资格或实际版本已变化，不能按名称重接')
          }
          const next = { ...source.value, ...(action.kind === 'patch-line' ? action.patch : {}), updatedAt: now, ...(action.kind === 'delete-line' ? { deletedAt: now } : {}) }
          if (!next.itemName.trim() || [next.qty, next.unitPrice].some(value => value !== null && (!Number.isFinite(value) || value < 0)))
            return boqFail('validation-failed', '清单原量价及未知值不能补零或写无效数值')
          await tx.execute('UPDATE boq_lines SET item_id=?,record_json=?,updated_at=?,deleted_at=? WHERE id=?', [next.itemId, quantityCanonical(next), now, next.deletedAt, next.id])
          await history(tx, command, 'boq_lines', next.id, source.value, next)
          result = { ...result, id: next.id }
        }
        else if (command.action.kind === 'owner-change') {
          let attachmentIndex = 0
          const core = await productionBoqOwnerInTransaction(tx, actor, command.projectId, { createAttachmentId: () => productionBoqAttachmentId(command, attachmentIndex++) })
          const before = core.rows()
          const inner = command.action.command
          if (inner.action === 'save' || inner.action === 'submit') {
            if (inner.draft.projectId !== command.projectId || inner.draft.contractId !== command.contractId)
              return boqFail('relationship-mismatch', '甲方变洽签须明确属于原项目与施工主合同')
          }
          else if (!before.some(row => row.id === inner.id && row.projectId === command.projectId && row.contractId === command.contractId)) {
            return boqFail('relationship-mismatch', '原变洽签不属于该施工主合同')
          }
          const saved = await core.execute(command.action.command, actor)
          if (inner.action === 'delete') {
            const original = (await readProductionBoqChanges(tx, command.projectId, command.contractId)).find(row => row.id === saved.id)
            const removed = { ...original, deletedAt: now, updatedAt: now, version: Number(saved.version) }
            await tx.execute('UPDATE boq_change_records SET record_json=?,updated_at=?,deleted_at=? WHERE id=?', [quantityCanonical(removed), now, now, saved.id])
            await history(tx, command, 'boq_change_records', saved.id, original, removed)
          }
          for (const changed of core.rows()) {
            if (changed.contractId !== command.contractId || changed.projectId !== command.projectId)
              continue
            const old = before.find(row => row.id === changed.id)
            const original = (await readProductionBoqChanges(tx, command.projectId, command.contractId)).find(row => row.id === changed.id)
            const document: ProductionBoqChangeDocument = { ...original, ...changed, files: changed.files.map((file) => {
              const index = attachmentFiles.findIndex((_, index) => productionBoqAttachmentId(command, index) === file.id)
              const prior = original?.files.find(row => row.id === file.id)
              return index >= 0 ? { ...file, fileRefId: attachmentRefs[index]!, sha256: createHash('sha256').update(attachmentBodies[index]!).digest('hex') } : { ...prior, ...file }
            }) }
            if (old && boqDigest(old) === boqDigest(changed))
              continue
            await tx.execute('INSERT INTO boq_change_records VALUES (?,?,?,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET record_json=excluded.record_json,updated_at=excluded.updated_at', [changed.id, command.projectId, command.contractId, quantityCanonical(document), changed.createdAt, changed.updatedAt])
            await history(tx, command, 'boq_change_records', changed.id, original ?? null, document)
          }
          const originals = await readProductionBoqRows<BoqLineRecord>(tx, 'boq_lines', command.projectId, command.contractId, true)
          for (const added of core.boqRows().filter(row => row.contractId === command.contractId && row.source?.changeOrderId && !originals.some(original => original.value.id === row.id))) {
            const record: BoqLineRecord = { id: added.id, projectId: command.projectId, contractId: command.contractId, fileId: null, changeId: added.source!.changeOrderId!, itemId: null, itemName: added.itemName, unit: added.unit, qty: added.qty, unitPrice: added.unitPrice, building: null, unitType: null, floorZone: null, section: '', trade: '', room: '', spec: '', multiplier: null, taxRate: null, ownerSupplied: false, recognizedQty: null, recognizedUnitPrice: null, traceKey: '', sourceSheet: '', sourceRow: null, confirmedOriginal: false, createdAt: now, updatedAt: now, deletedAt: null }
            await tx.execute('INSERT INTO boq_lines VALUES (?,?,?,?,?,?,?,?,?,NULL)', [record.id, null, record.changeId, command.projectId, command.contractId, null, quantityCanonical(record), now, now])
            await history(tx, command, 'boq_lines', record.id, null, record)
          }
          result = { ...result, id: saved.id, changeId: saved.id, ownerResult: saved, ...(inner.action === 'delete' ? { deleted: true } : {}) }
        }
        else if (command.action.kind === 'reject-change') {
          const action = command.action
          const source = (await readProductionBoqChanges(tx, command.projectId, command.contractId)).find(row => row.id === action.changeId)
          if (!source || String(source.version) !== action.version || source.status !== 'submitted')
            return boqFail('conflict', '只有当前实际已上报的原变洽签可以退回')
          const next: ProductionBoqChangeDocument = { ...source, status: 'rejected', statusNote: action.note, updatedAt: now, version: source.version + 1 }
          await tx.execute('UPDATE boq_change_records SET record_json=?,updated_at=? WHERE id=?', [quantityCanonical(next), now, source.id])
          await history(tx, command, 'boq_change_records', source.id, source, next)
          result = { ...result, id: source.id, changeId: source.id }
        }
        else {
          return boqFail('unavailable', '采用批次恢复尚未完成原引用核查，不能调用危险恢复')
        }
        await advance(tx)
        const completed: BoqCommandResult = { ...result, sourceVersion: (await readScope(tx, actor, command)).sourceVersion }
        await tx.execute('INSERT INTO boq_commands VALUES (?,?,?,?,?,?)', [...keyOf(command), fingerprint, quantityCanonical(completed), now])
        return completed
      })
    })()
    active.set(key, { fingerprint, promise })
    try {
      return await promise
    }
    finally {
      if (active.get(key)?.promise === promise)
        active.delete(key)
    }
  }
  return {
    file: (scope: BoqScope & { ownerKind: 'boq-file' | 'owner-change', ownerId: string, fileId: string }, session: Session) => run(session, false, async (tx, actor) => {
      const parent = await productionBoqContractReference(tx, actor, scope.contractId)
      if (scope.origin !== 'real' || parent.projectId !== scope.projectId || ['draft', '草稿'].includes(parent.status))
        return boqFail('relationship-mismatch', '原件须来自当前真实项目和实际施工主合同')
      await validateProductionBoqState(tx)
      let refId: string
      let expected: { fileName: string, fileSize: number | null, mimeType: string, sha256: string | null }
      if (scope.ownerKind === 'boq-file') {
        const row = (await readProductionBoqRows<BoqFileRecord>(tx, 'boq_files', scope.projectId, scope.contractId)).find(row => row.value.id === scope.ownerId && row.value.fileRefId === scope.fileId)
        if (!row)
          return boqFail('not-found', '原清单文件不存在、已隐藏或不属于当前主合同')
        refId = row.value.fileRefId
        expected = row.value
      }
      else {
        const change = (await readProductionBoqChanges(tx, scope.projectId, scope.contractId)).find(row => row.id === scope.ownerId)
        const file = change?.files.find(row => row.id === scope.fileId && row.deletedAt === null)
        if (!file)
          return boqFail('not-found', '原签证附件不存在、已删除或不属于当前单据')
        refId = file.fileRefId ?? file.id
        expected = { ...file, sha256: file.sha256 ?? null }
      }
      const [body] = await tx.select<{ content: Uint8Array | null, sha256: string, mime_type: string, file_size: number, deleted_at: string | null }>('SELECT f.*,b.content,b.sha256 FROM file_refs f LEFT JOIN file_payloads b ON b.file_ref_id=f.id WHERE f.id=?', [refId])
      if (!body || body.deleted_at !== null || !(body.content instanceof Uint8Array))
        return boqFail('unavailable', '原历史只有附件描述或正文已不可用，请保留原历史并补传实际原件')
      const bytes = Buffer.from(body.content)
      if (bytes.length !== body.file_size || bytes.length !== expected.fileSize || body.mime_type !== expected.mimeType || createHash('sha256').update(bytes).digest('hex') !== body.sha256 || (expected.sha256 !== null && expected.sha256 !== body.sha256))
        return boqFail('unavailable', '原附件归属、完整原字节、大小或摘要无法互证')
      return { ...scope, workspaceId: actor.workspaceId, actorId: actor.actorId, fileName: expected.fileName, mimeType: expected.mimeType || 'application/octet-stream', sha256: body.sha256, bytes }
    }),
    building: (scope: import('../../app/lib/boq/central-building-contract').BoqBuildingQuery, session: Session) => run(session, false, async (tx, actor) => (await loadProductionBoqBuilding(tx, actor, scope)).context),
    async correctBuilding(input: unknown, session: Session) {
      const legacy = parseBoqBuildingCommand(input)
      if (!legacy.contractVersion || !legacy.lineVersion || !legacy.buildingVersion || legacy.origin !== 'real')
        return boqFail('stale-source', '正式更正需要原行与所选楼栋的实际消费版本，请重新读取原页')
      const result = await execute({ workspaceId: legacy.workspaceId, actorId: legacy.actorId, commandId: legacy.commandId, projectId: legacy.projectId, contractId: legacy.contractId, origin: 'real', requiredCapability: 'boq:write', contractVersion: legacy.contractVersion, action: { kind: 'correct-building', lineId: legacy.lineId, version: legacy.lineVersion, buildingId: legacy.buildingId, buildingVersion: legacy.buildingVersion, reason: legacy.reason, originalSourceVersion: legacy.sourceVersion } }, session)
      return result.buildingResult!
    },
    read: (scope: BoqScope, session: Session) => run(session, false, (tx, actor) => readScope(tx, actor, scope)),
    catalog: (session: Session) => run(session, false, async (tx, actor) => {
      const facts = await readProductionConstructionContractFacts(tx, actor)
      const lines = await readProductionBoqRows<BoqLineRecord>(tx, 'boq_lines')
      return { ...actor, ...facts, contracts: facts.contracts.map(contract => ({ ...contract, lineCount: lines.filter(row => row.value.contractId === contract.id).length })) }
    }),
    items: (scope: BoqScope, session: Session) => run(session, false, async (tx, actor) => {
      const parent = await productionBoqContractReference(tx, actor, scope.contractId)
      if (scope.origin !== 'real' || parent.projectId !== scope.projectId || ['draft', '草稿'].includes(parent.status))
        return boqFail('relationship-mismatch', '分项选择须来自实际项目和已可用施工主合同')
      return (await tx.select<Record<string, unknown>>('SELECT * FROM items WHERE project_id=? AND deleted_at IS NULL ORDER BY code,id', [scope.projectId])).map(row => ({ id: row.id, code: row.code, name: row.name, trade: row.trade, unit: row.unit, version: boqDigest(row) }))
    }),
    execute,
    async resolve(descriptor: CommandRecoveryDescriptor, session: Session) {
      const actor = authorize(session, true)
      if (descriptor.family !== 'boq' || descriptor.workspaceId !== actor.workspaceId || descriptor.actorId !== actor.actorId)
        return boqFail('forbidden', '原清单恢复身份不同')
      await active.get(quantityCanonical(keyOf(descriptor)))?.promise.catch(() => {})
      return run(session, true, async (tx) => {
        const [intent] = await tx.select<{ request_json: string }>('SELECT * FROM boq_command_intents WHERE workspace_id=? AND actor_id=? AND command_id=?', keyOf(descriptor))
        if (intent && quantityCanonical(productionBoqRecoveryDescriptor(JSON.parse(intent.request_json))) !== quantityCanonical(descriptor))
          return boqFail('conflict', '恢复动作或目标不是原提交范围')
        const [receipt] = await tx.select<{ result_json: string }>('SELECT * FROM boq_commands WHERE workspace_id=? AND actor_id=? AND command_id=?', keyOf(descriptor))
        if (receipt)
          return { outcome: 'applied' as const, result: JSON.parse(receipt.result_json) as BoqCommandResult }
        const [sealed] = await tx.select<{ descriptor_json: string }>('SELECT * FROM boq_resolutions WHERE workspace_id=? AND actor_id=? AND command_id=?', keyOf(descriptor))
        if (sealed && sealed.descriptor_json !== quantityCanonical(descriptor))
          return boqFail('conflict', '原清单编号已按其他范围封存')
        if (!sealed)
          await tx.execute('INSERT INTO boq_resolutions VALUES (?,?,?,?,?)', [...keyOf(descriptor), quantityCanonical(descriptor), new Date().toISOString()])
        return { outcome: 'not-applied' as const, commandId: descriptor.commandId }
      })
    },
  }
}
