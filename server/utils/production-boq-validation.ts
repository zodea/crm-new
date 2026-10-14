import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { BoqFileRecord, BoqLineRecord, BoqPriceRecord } from './production-boq-record'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readProductionBoqImportEvidence } from './production-boq-import-evidence'
import { boqDigest, boqFail, productionBoqAttachmentId, readProductionBoqChanges, readProductionBoqRows } from './production-boq-record'
import { parseProductionBoqCommand } from './production-boq-request'

function originalMetadataTime(value: unknown, missing: '' | null) {
  if (value === null)
    return missing
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    return boqFail('unavailable', '原附件时间证据无效，不能以当前日期替代')
  return new Date(value).toISOString()
}

/** Pure disk evidence validation. Staged original files also belong to their immutable original intent. */
export async function validateProductionBoqState(tx: Pick<TransactionDb, 'select'>) {
  const metadataOnlyFileIds = new Set<string>()
  const [identity] = await tx.select<{ workspace_id: string, owner_id: string }>('SELECT workspace_id,owner_id FROM production_metadata WHERE singleton=1')
  if (!identity)
    return boqFail('unavailable', '正式清单 workspace 证据缺失')
  const [participant] = await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=\'boq\'')
  if (participant?.schema_version !== 1)
    return boqFail('unavailable', '清单 owner 没有实际已登记版本')
  const files = await readProductionBoqRows<BoqFileRecord>(tx, 'boq_files', undefined, undefined, true)
  const lines = await readProductionBoqRows<BoqLineRecord>(tx, 'boq_lines', undefined, undefined, true)
  const prices = await readProductionBoqRows<BoqPriceRecord>(tx, 'item_unit_prices', undefined, undefined, true)
  const changes = await readProductionBoqChanges(tx, undefined, undefined, true)
  const sourceRecords = await readProductionBoqImportEvidence(tx)
  const sourceOriginals = new Map(sourceRecords.flatMap(record => record.evidence.fileProofs.map(file => [file.id, { file, evidence: record.evidence }] as const)))
  for (const source of sourceRecords) {
    if (!Array.isArray(source.evidence.payloadRefs) || source.evidence.payloadRefs.length !== source.evidence.rawDomain.file_payloads.length)
      return boqFail('unavailable', '原嵌入正文必须有逐原SQL列的完整共享引用，不能以null或空表替代')
    for (const ref of source.evidence.payloadRefs) {
      const raw = source.evidence.rawDomain.file_payloads.find(row => row.legacyId === ref.fileRefId)
      const column = raw?.columns.content as unknown as { sqliteType: string, sharedOriginal: string, payloadReference: unknown } | undefined
      const [body] = await tx.select<{ content: Uint8Array, sha256: string }>('SELECT content,sha256 FROM file_payloads WHERE file_ref_id=?', [ref.fileRefId])
      if (!raw || !column || column.sqliteType !== ref.sqliteType || column.sharedOriginal !== ref.fileRefId || boqDigest(column.payloadReference) !== boqDigest(ref) || ref.encoding !== 'base64' || raw.columns.encoding?.exactValue !== ref.encoding || !body || !(body.content instanceof Uint8Array) || body.content.length !== ref.byteLength || body.sha256 !== ref.sha256 || createHash('sha256').update(body.content).digest('hex') !== ref.sha256)
        return boqFail('unavailable', '原嵌入正文的SQLite类型/编码/稳定引用与唯一共享BLOB不能互证')
      const originalColumn = Buffer.from(Buffer.from(body.content).toString('base64'), 'utf8')
      if (originalColumn.length !== ref.columnByteLength || createHash('sha256').update(originalColumn).digest('hex') !== ref.columnSha256)
        return boqFail('unavailable', '不能从原共享正文重建原规范base64列，原字节或编码历史已变化')
    }
  }
  for (const row of [...files, ...lines, ...prices].map(row => row.value)) {
    const [parent] = await tx.select<{ project_id: string }>('SELECT project_id FROM construction_contract_records WHERE id=?', [row.contractId])
    if (!parent || parent.project_id !== row.projectId)
      return boqFail('unavailable', '原清单真实主合同与项目无法互证')
  }
  for (const { value } of lines) {
    if (value.fileId ? !files.some(file => file.value.id === value.fileId && file.value.contractId === value.contractId) : !changes.some(change => change.id === value.changeId && change.contractId === value.contractId && change.status === 'approved'))
      return boqFail('unavailable', '原清单行缺已确认原文件或已签证新增依据')
  }
  const intents = await tx.select<{ workspace_id: string, actor_id: string, command_id: string, project_id: string, contract_id: string, fingerprint: string, request_json: string }>('SELECT * FROM boq_command_intents')
  const originals = new Map<string, { sha256: string | null, fileSize: number | null, fileName: string, mimeType: string }>()
  const originalOwners = new Map<string, Map<string, { fileName: string, actorId: string }>>()
  const owner = (refId: string, id: string, fileName: string, actorId: string) => {
    const names = originalOwners.get(refId) ?? new Map()
    names.set(id, { fileName, actorId })
    originalOwners.set(refId, names)
  }
  for (const intent of intents) {
    const command = JSON.parse(intent.request_json)
    if (intent.workspace_id !== identity.workspace_id || intent.actor_id !== identity.owner_id || command.workspaceId !== intent.workspace_id || command.actorId !== intent.actor_id || command.commandId !== intent.command_id || command.projectId !== intent.project_id || command.contractId !== intent.contract_id)
      return boqFail('unavailable', '原清单 intent 的稳定身份或父归属损坏')
    // Rebuild known request bodies transiently for the same closed request parser; never persist a second original.
    const originalCommand = structuredClone(command)
    if (originalCommand.action.kind === 'import-file') {
      const { fileRefId, ...file } = originalCommand.action.original
      const [body] = await tx.select<{ content: Uint8Array }>('SELECT content FROM file_payloads WHERE file_ref_id=?', [fileRefId])
      if (!(body?.content instanceof Uint8Array))
        return boqFail('unavailable', '原清单固定意图缺完整共享正文')
      originalCommand.action.original = { ...file, payloadBase64: Buffer.from(body.content).toString('base64') }
    }
    else if (originalCommand.action.kind === 'owner-change' && originalCommand.action.command.attachments?.add) {
      for (const [index, file] of originalCommand.action.command.attachments.add.entries()) {
        const { fileRefId, sha256: _digest, ...metadata } = file
        const [body] = await tx.select<{ content: Uint8Array }>('SELECT content FROM file_payloads WHERE file_ref_id=?', [fileRefId])
        if (!(body?.content instanceof Uint8Array))
          return boqFail('unavailable', '原签证固定意图缺完整共享正文')
        originalCommand.action.command.attachments.add[index] = { ...metadata, payloadBase64: Buffer.from(body.content).toString('base64') }
      }
    }
    try {
      parseProductionBoqCommand(originalCommand)
    }
    catch { return boqFail('unavailable', '原清单固定意图包含未定义动作、嵌套字段或无效输入') }
    if (command.action.kind === 'import-file') {
      const { fileRefId, ...original } = command.action.original
      if (typeof fileRefId !== 'string' || Object.hasOwn(original, 'payloadBase64'))
        return boqFail('unavailable', '原件 intent 必须引用共享正文，不能嵌第二份原件')
      originals.set(fileRefId, original)
      owner(fileRefId, `boq-file-${boqDigest([command.workspaceId, command.actorId, command.commandId]).slice(0, 24)}`, original.fileName, command.actorId)
      if (boqDigest({ ...command, action: { ...command.action, original } }) !== intent.fingerprint)
        return boqFail('unavailable', '原清单固定意图摘要不同')
    }
    else if (command.action.kind === 'owner-change' && command.action.command.attachments?.add) {
      const added = command.action.command.attachments.add as Array<{ fileRefId: string, fileName: string, mimeType?: string, fileSize: number, sha256: string }>
      for (const [index, file] of added.entries()) {
        if (Object.hasOwn(file, 'payloadBase64') || typeof file.fileRefId !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.fileSize) || file.fileSize <= 0)
          return boqFail('unavailable', '原签证附件意图只能保完整正文摘要及共享引用')
        const prior = originals.get(file.fileRefId)
        if (prior && (prior.sha256 !== file.sha256 || prior.fileSize !== file.fileSize || prior.mimeType !== (file.mimeType ?? '')))
          return boqFail('unavailable', '原签证附件共享正文的大小、格式或摘要不同')
        originals.set(file.fileRefId, { ...file, mimeType: file.mimeType ?? '' })
        owner(file.fileRefId, productionBoqAttachmentId(command, index), file.fileName, command.actorId)
      }
      const summary = { ...command, action: { ...command.action, command: { ...command.action.command, attachments: { ...command.action.command.attachments, add: added.map(({ fileRefId: _ref, ...file }) => file) } } } }
      if (boqDigest(summary) !== intent.fingerprint)
        return boqFail('unavailable', '签证固定原意图摘要或完整共享引用不同')
    }
    else if (boqDigest(command) !== intent.fingerprint) {
      return boqFail('unavailable', '原上游动作正文摘要不同')
    }
  }
  const importIntents = await tx.select<{ workspace_id: string, actor_id: string, command_id: string, action: string, source_id: string, fingerprint: string, request_json: string }>('SELECT * FROM boq_import_intents')
  for (const intent of importIntents) {
    const command = JSON.parse(intent.request_json)
    if (intent.workspace_id !== identity.workspace_id || intent.actor_id !== identity.owner_id || command.workspaceId !== intent.workspace_id || command.actorId !== intent.actor_id || command.commandId !== intent.command_id || command.action !== intent.action || command.sourceSha256 !== intent.source_id || Object.hasOwn(command, 'source'))
      return boqFail('unavailable', '整批清单原意图身份、来源或动作不同，不能嵌整库正文')
    if (intent.action === 'adopt') {
      for (const row of command.originals) {
        if (Object.hasOwn(row.original, 'payloadBase64') || typeof row.fileRefId !== 'string')
          return boqFail('unavailable', '原迁入文件必须保共享原件引用，不能存第二份正文')
        const prior = originals.get(row.fileRefId)
        if (prior && (prior.sha256 !== row.original.sha256 || prior.fileSize !== row.original.fileSize || prior.mimeType !== row.original.mimeType))
          return boqFail('unavailable', '同一整批共享原件有不同原大小或摘要')
        originals.set(row.fileRefId, row.original)
        owner(row.fileRefId, row.fileId, row.original.fileName, intent.actor_id)
      }
      if (boqDigest({ ...command, originals: command.originals.map(({ fileRefId: _ref, ...row }: { fileRefId: string }) => row) }) !== intent.fingerprint)
        return boqFail('unavailable', '原整批清单意图摘要不同')
    }
    else if (boqDigest(command) !== intent.fingerprint) {
      return boqFail('unavailable', '原清单整批恢复意图摘要不同')
    }
  }
  for (const { file } of sourceOriginals.values()) {
    const prior = originals.get(file.id)
    if (prior && (prior.sha256 !== file.sha256 || prior.fileSize !== file.fileSize || prior.mimeType !== file.mimeType))
      return boqFail('unavailable', '原清单输入与已确认整批原件证据不同')
    originals.set(file.id, { sha256: file.sha256, fileSize: file.fileSize, fileName: file.fileName, mimeType: file.mimeType })
    if (file.originalMetadata === null)
      owner(file.id, file.logicalFileId, file.fileName, identity.owner_id)
  }
  for (const file of files) {
    const expected = { sha256: file.value.sha256, fileSize: file.value.fileSize, fileName: file.value.fileName, mimeType: file.value.mimeType }
    const prior = originals.get(file.value.fileRefId)
    if (prior && (prior.sha256 !== expected.sha256 || prior.fileSize !== expected.fileSize || prior.mimeType !== expected.mimeType))
      return boqFail('unavailable', '共享原件与确认采用文件摘要不同')
    originals.set(file.value.fileRefId, expected)
    owner(file.value.fileRefId, file.value.id, file.value.fileName, identity.owner_id)
  }
  for (const change of changes) {
    const [parent] = await tx.select<{ project_id: string }>('SELECT project_id FROM construction_contract_records WHERE id=?', [change.contractId])
    if (!parent || parent.project_id !== change.projectId)
      return boqFail('unavailable', '原变洽签真实主合同与项目无法互证')
    for (const file of change.files) {
      const ref = file.fileRefId ?? file.id
      if (file.fileRefId) {
        const prior = originals.get(ref)
        if (!prior || file.sha256 !== prior.sha256 || file.fileSize !== prior.fileSize || file.mimeType !== prior.mimeType || !originalOwners.get(ref)?.has(file.id))
          return boqFail('unavailable', '原签证附件须与本单原意图、完整共享正文和稳定ID互证')
      }
      else {
        const source = sourceOriginals.get(ref)
        if (!source || (source.file.logicalFileId !== change.sourceId && source.file.logicalFileId !== change.id && source.file.logicalFileId !== change.legacyLedgerId))
          return boqFail('unavailable', '原签证附件缺原来源ID与本单已确认关系')
      }
    }
  }
  const ownedFiles = await tx.select<{ id: string }>('SELECT id FROM file_refs WHERE owner_type=\'boq_original\'')
  if (ownedFiles.some(row => !originals.has(row.id)))
    return boqFail('unavailable', '施工清单原件没有原采用文件或固定原意图，不能当合法原件恢复')
  for (const [fileId, expected] of originals) {
    const [row] = await tx.select<{ owner_type: string, owner_id: string, file_name: string, uploader: string, category: string, file_size: number, mime_type: string, content: Uint8Array | null, sha256: string | null }>('SELECT f.*,b.content,b.sha256 FROM file_refs f LEFT JOIN file_payloads b ON b.file_ref_id=f.id WHERE f.id=?', [fileId])
    const originalOwner = row && originalOwners.get(fileId)?.get(row.owner_id)
    const source = sourceOriginals.get(fileId)
    const nativeMetadata = source?.file.originalMetadata
    const actualNativeMetadata = nativeMetadata && source?.evidence.rawDomain.file_refs.find(raw => raw.legacyId === fileId)
    const nativeOwner = row && nativeMetadata && actualNativeMetadata && ['owner_type', 'owner_id', 'file_name', 'mime_type', 'category', 'uploader', 'file_path', 'uploaded_at', 'deleted_at'].every(field => Object.hasOwn(nativeMetadata, field) && actualNativeMetadata.columns[field]?.exactValue === (nativeMetadata[field] == null ? null : String(nativeMetadata[field])) && (row as unknown as Record<string, unknown>)[field] === (field === 'uploaded_at' || field === 'deleted_at' ? originalMetadataTime(nativeMetadata[field], field === 'uploaded_at' ? '' : null) : String(nativeMetadata[field] ?? '')))
    if (!row || !(nativeOwner || (originalOwner && row.file_name === originalOwner.fileName && row.uploader === originalOwner.actorId && row.owner_type === 'boq_original' && row.category === 'original_boq')) || row.file_size !== (expected.fileSize ?? 0) || row.mime_type !== expected.mimeType)
      return boqFail('unavailable', '原施工清单文件元数据归属或大小不同')
    if (row.content === null) {
      const originalRow = nativeMetadata ? source?.evidence.rawDomain.file_refs.find(raw => raw.legacyId === fileId) : source?.evidence.rawDomain.boq_files.find(raw => raw.legacyId === source.file.logicalFileId)
      if (!source || source.file.bodyState !== 'metadata-only' || source.file.sha256 !== null || !source.evidence.metadataOnlyFileIds.includes(fileId) || !originalRow || originalRow.columns.file_path?.exactValue !== '' || source.evidence.rawDomain.file_payloads.some(raw => raw.legacyId === fileId))
        return boqFail('unavailable', '原文件缺正文且没有已确认历史缺件依据')
      metadataOnlyFileIds.add(fileId)
    }
    else if (!(row.content instanceof Uint8Array) || row.content.length !== expected.fileSize || createHash('sha256').update(Buffer.from(row.content)).digest('hex') !== expected.sha256 || row.sha256 !== expected.sha256) {
      return boqFail('unavailable', '原完整清单 BLOB 与 SHA-256 不能互证')
    }
  }
  const receipts = await tx.select<{ workspace_id: string, actor_id: string, command_id: string, fingerprint: string, result_json: string }>('SELECT * FROM boq_commands')
  const sealed = await tx.select<{ workspace_id: string, actor_id: string, command_id: string, descriptor_json: string }>('SELECT * FROM boq_resolutions')
  const same = (left: { workspace_id: string, actor_id: string, command_id: string }, right: typeof left) => left.workspace_id === right.workspace_id && left.actor_id === right.actor_id && left.command_id === right.command_id
  for (const row of receipts) {
    const intent = intents.find(intent => same(row, intent))
    const result = JSON.parse(row.result_json)
    if (!intent || row.fingerprint !== intent.fingerprint || result.commandId !== row.command_id || result.workspaceId !== row.workspace_id || result.actorId !== row.actor_id || result.projectId !== intent.project_id || result.contractId !== intent.contract_id || sealed.some(cancelled => same(row, cancelled)))
      return boqFail('unavailable', '原上游回执缺完整原意图或与未应用封存冲突')
    const command = JSON.parse(intent.request_json)
    const action = command.action
    const target = action.kind === 'import-file' ? `boq-file-${boqDigest([command.workspaceId, command.actorId, command.commandId]).slice(0, 24)}` : action.kind === 'owner-change' ? action.command.id : action.kind === 'reject-change' ? action.changeId : action.kind === 'restore-import' ? action.importId : action.lineId
    if (result.action !== action.kind || !result.id || (target && result.id !== target) || (action.kind === 'owner-change' && result.changeId !== result.id) || (action.kind === 'correct-building' && (!result.buildingResult || result.buildingResult.lineId !== action.lineId || result.buildingResult.buildingId !== action.buildingId || result.buildingResult.commandId !== command.commandId)) || (action.kind === 'import-file' && (result.fileId !== result.id || !files.some(file => file.value.id === result.id && file.value.projectId === command.projectId && file.value.contractId === command.contractId))))
      return boqFail('unavailable', '原清单回执的动作、真实目标及原子结果不能互证')
  }
  for (const row of sealed) {
    const descriptor = JSON.parse(row.descriptor_json)
    if (row.workspace_id !== identity.workspace_id || row.actor_id !== identity.owner_id || descriptor.workspaceId !== row.workspace_id || descriptor.actorId !== row.actor_id || descriptor.commandId !== row.command_id || descriptor.family !== 'boq')
      return boqFail('unavailable', '原清单恢复封存身份不同')
  }
  const importReceipts = await tx.select<{ workspace_id: string, actor_id: string, command_id: string, fingerprint: string, result_json: string }>('SELECT * FROM boq_import_commands')
  const importSealed = await tx.select<{ workspace_id: string, actor_id: string, command_id: string, descriptor_json: string }>('SELECT * FROM boq_import_resolutions')
  for (const receipt of importReceipts) {
    const intent = importIntents.find(row => same(receipt, row))
    const result = JSON.parse(receipt.result_json)
    if (!intent || intent.fingerprint !== receipt.fingerprint || result.workspaceId !== receipt.workspace_id || result.actorId !== receipt.actor_id || result.commandId !== receipt.command_id || result.sourceSha256 !== intent.source_id || importSealed.some(row => same(row, receipt)))
      return boqFail('unavailable', '整批原回执缺同身份/来源原意图或与未应用封存冲突')
  }
  for (const sealed of importSealed) {
    const descriptor = JSON.parse(sealed.descriptor_json)
    if (sealed.workspace_id !== identity.workspace_id || sealed.actor_id !== identity.owner_id || descriptor.workspaceId !== sealed.workspace_id || descriptor.actorId !== sealed.actor_id || descriptor.commandId !== sealed.command_id || descriptor.family !== 'boq-import' || !/^[a-f0-9]{64}$/.test(String(descriptor.scopeId)))
      return boqFail('unavailable', '整批清单恢复封存范围与原来源不同')
  }
  return { metadataOnlyFileIds }
}
