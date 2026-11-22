import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { OwnerCommercialDocumentCommandRequestDTO, OwnerCommercialDocumentCommandResultDTO } from '../../app/lib/owner-document/central-command-contract'
import type { OwnerCommercialDocumentKind, OwnerCommercialDocumentSource } from '../../app/lib/owner-document/central-repository'
import type { BusinessSession } from './business-session'
import type { MigrationRawRow } from './migration-domain-evidence'
import type { OwnerCommercialDocumentSnapshot } from './owner-commercial-document-command-test-instance'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { ownerCommercialDocumentProblem, OwnerCommercialDocumentRepositoryProblem } from '../../app/lib/owner-document/central-repository'
import { subcontractSettlementAmounts } from '../../app/lib/owner-document/subcontract-settlement'
import { isStableRouteIdentity } from '../../app/lib/util/stable-route-identity'
import { commandFingerprint, commandJournalKey } from './command-journal'
import { contractOriginalBytes } from './contract-original'
import { parseOwnerCommercialDocumentCommandRequest } from './owner-commercial-document-command-request'
import { createOwnerCommercialDocumentCommandTestInstance } from './owner-commercial-document-command-test-instance'
import { businessApplications } from './production-finance-payment-detail'
import { PRODUCTION_OWNER_DOCUMENT_HEAD_TABLES } from './production-owner-document-schema'

export const ownerDocumentDigest = commandFingerprint
export function ownerDocumentFailure(code: Parameters<typeof ownerCommercialDocumentProblem>[0], message: string): never {
  throw new OwnerCommercialDocumentRepositoryProblem(ownerCommercialDocumentProblem(code, message, code === 'unavailable'))
}
export const ownerDocumentKey = (value: { workspaceId: string, actorId: string, commandId: string }) => [value.workspaceId, value.actorId, value.commandId]
export const productionOwnerDocumentId = (value: { workspaceId: string, actorId: string, commandId: string, kind: OwnerCommercialDocumentKind }) => `business-${value.kind}-${ownerDocumentDigest(ownerDocumentKey(value)).slice(0, 24)}`
export const productionOwnerDocumentFileId = (value: { workspaceId: string, actorId: string, commandId: string }, index: number) => `business-file-${ownerDocumentDigest([...ownerDocumentKey(value), index]).slice(0, 24)}`
export const productionOwnerDocumentOwnerType = (kind: OwnerCommercialDocumentKind) => ({ owner_change: 'owner_change_order', owner_report: 'monthly_statement', acceptance: 'project_acceptance', final_settlement: 'owner_final_settlement', owner_penalty: 'owner_penalty', sub_change: 'subcontract_change_order', sub_settlement: 'expenditure_settlement', project_penalty: 'penalty_record' }[kind])

export async function assertProductionOwnerDocument(tx: Pick<TransactionDb, 'select'>, actor?: BusinessSession) {
  const [identity] = await tx.select<{ workspace_id: string, owner_id: string }>('SELECT workspace_id,owner_id FROM production_metadata WHERE singleton=1')
  const [participant] = await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=\'owner-documents\'')
  if (!identity || ![1, 2, 3].includes(participant?.schema_version ?? 0))
    ownerDocumentFailure('unavailable', '商务 owner 尚未完成实际已登记连续升级，不能用开发数据代替')
  if (actor && (identity.workspace_id !== actor.workspaceId || identity.owner_id !== actor.actorId))
    ownerDocumentFailure('forbidden', '商务 owner 与当前可信工作区或操作者不同')
  return { ...identity, schemaVersion: participant!.schema_version }
}

export function parseOwnerDocumentStoredJson<T>(value: string): T {
  try {
    return JSON.parse(value) as T
  }
  catch { return ownerDocumentFailure('unavailable', '商务原 JSON 已损坏，保留磁盘原图并停止操作') }
}
export interface ProductionOwnerDocumentStoredRow { id: string, project_id: string | null, contract_id: string | null, supplier_id: string | null, crew_id?: string | null, period_no?: string | null, record_json: string, version: number, deleted_at: string | null }
export async function readProductionOwnerDocumentRows(tx: Pick<TransactionDb, 'select'>, includeDeleted = false, withSharedSettlements = true) {
  const documents: OwnerCommercialDocumentSource[] = []
  const deleted = new Set<string>()
  for (const [kind, table] of Object.entries(PRODUCTION_OWNER_DOCUMENT_HEAD_TABLES)) {
    for (const row of await tx.select<ProductionOwnerDocumentStoredRow>(`SELECT * FROM ${table} ORDER BY id`)) {
      const source = parseOwnerDocumentStoredJson<OwnerCommercialDocumentSource>(row.record_json)
      if (source.kind !== kind || source.id !== row.id || source.version !== row.version || source.projectId !== row.project_id
        || source.contractId !== row.contract_id || (source.supplierId ?? null) !== row.supplier_id || (source.crewId ?? null) !== row.crew_id
        || (source.periodNo || null) !== (row.period_no || null) || ((source as { deletedAt?: string | null }).deletedAt ?? null) !== row.deleted_at) {
        ownerDocumentFailure('unavailable', '商务原文身份、版本与真实父归属无法互证')
      }
      if (row.deleted_at !== null)
        deleted.add(`${kind}\u001F${row.id}`)
      if (includeDeleted || row.deleted_at === null)
        documents.push(source)
    }
  }
  for (const row of withSharedSettlements ? await tx.select<ProductionOwnerDocumentStoredRow>('SELECT *,settlement_period AS period_no FROM expenditure_settlements WHERE document_owner=\'business\' ORDER BY id') : []) {
    const source = parseOwnerDocumentStoredJson<OwnerCommercialDocumentSource>(row.record_json)
    if (source.kind !== 'sub_settlement' || source.id !== row.id || source.version !== row.version || source.projectId !== row.project_id
      || source.contractId !== row.contract_id || (source.supplierId ?? null) !== row.supplier_id || ((source as { deletedAt?: string | null }).deletedAt ?? null) !== row.deleted_at) {
      ownerDocumentFailure('unavailable', '共享分包结算原文与真实唯一头无法互证')
    }
    if (row.deleted_at !== null)
      deleted.add(`sub_settlement\u001F${row.id}`)
    if (includeDeleted || row.deleted_at === null)
      documents.push(source)
  }
  return { documents, deleted }
}

/** Fixed request summaries point to the one shared original BLOB; never store another editable document. */
export async function productionOwnerDocumentIntent(tx: TransactionDb, command: OwnerCommercialDocumentCommandRequestDTO, actor: BusinessSession) {
  const fileRefs: string[] = []
  const summary = structuredClone(command) as OwnerCommercialDocumentCommandRequestDTO & { originalFileRefs?: string[] }
  if ('attachments' in summary && 'attachments' in command) {
    if ((command.attachments.add ?? []).length)
      summary.attachments.add = []
    for (const [index, file] of (command.attachments.add ?? []).entries()) {
      const bytes = contractOriginalBytes(file, { required: true, fail: message => ownerDocumentFailure('validation-failed', message) })!
      const id = productionOwnerDocumentFileId(command, index)
      const ownerId = command.id ?? productionOwnerDocumentId(command)
      const now = new Date().toISOString()
      const metadata = { id, fileName: file.fileName.trim(), fileSize: bytes.length, mimeType: file.mimeType?.trim() ?? '', category: file.category?.trim() ?? '', uploader: actor.actorId, uploadedAt: now, deletedAt: null }
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      await tx.execute('INSERT INTO file_refs VALUES(?,?,?,?,?,?,?,?,?,?,NULL)', [id, productionOwnerDocumentOwnerType(command.kind), ownerId, metadata.fileName, '', bytes.length, metadata.mimeType, metadata.category, actor.actorId, now])
      await tx.execute('INSERT INTO file_payloads VALUES(?,?,?)', [id, bytes, sha256])
      await tx.execute('INSERT INTO owner_document_files VALUES(?,?,?,?,\'embedded\',?)', [id, command.kind, ownerId, JSON.stringify(metadata), sha256])
      const { payloadBase64: _bytes, ...original } = file
      summary.attachments.add!.push(original)
      fileRefs.push(id)
    }
  }
  if (fileRefs.length)
    summary.originalFileRefs = fileRefs
  return summary
}

export async function restoreProductionOwnerDocumentIntent(tx: Pick<TransactionDb, 'select'>, requestJson: string): Promise<OwnerCommercialDocumentCommandRequestDTO> {
  const summary = parseOwnerDocumentStoredJson<OwnerCommercialDocumentCommandRequestDTO & { originalFileRefs?: string[] }>(requestJson)
  const refs = summary.originalFileRefs
  delete summary.originalFileRefs
  if (refs !== undefined) {
    if (!Array.isArray(refs) || !refs.every(isStableRouteIdentity) || !('attachments' in summary) || refs.length !== (summary.attachments.add ?? []).length)
      ownerDocumentFailure('unavailable', '原商务提交的共享原件引用不完整')
    for (const [index, id] of refs.entries()) {
      const [body] = await tx.select<{ content: Uint8Array, sha256: string }>('SELECT content,sha256 FROM file_payloads WHERE file_ref_id=?', [id])
      if (!body || !(body.content instanceof Uint8Array) || createHash('sha256').update(body.content).digest('hex') !== body.sha256)
        ownerDocumentFailure('unavailable', '原提交共享原件缺失或损坏，不能覆盖原编号')
      summary.attachments.add![index]!.payloadBase64 = Buffer.from(body.content).toString('base64')
    }
  }
  try {
    return parseOwnerCommercialDocumentCommandRequest(summary)
  }
  catch { return ownerDocumentFailure('unavailable', '固定商务原意图不能解析，请保留原命令') }
}

interface OwnerDocumentImportEvidence {
  workspaceId: string
  actorId: string
  commandId: string
  sourceSha256: string
  schemaVersion: number
  documents: OwnerCommercialDocumentSource[]
  metadataOnlyFileIds: string[]
  payloadRefs: { fileRefId: string, encoding: string, sqliteType: string, sha256: string, byteLength: number, columnSha256: string, columnByteLength: number }[]
  rawDomain: Record<string, MigrationRawRow[]>
  sourceSchemas: Record<string, { sql: string, columns: { name: string }[] }>
  domainEvidenceDigest: string
  mappings: { sourceTable: string, legacyId: string, kind: OwnerCommercialDocumentKind, documentId: string, projectId: string | null, contractId: string | null }[]
  penaltyDeductions: OwnerCommercialDocumentSnapshot['penaltyDeductions']
  penaltyRectifications: OwnerCommercialDocumentSnapshot['penaltyRectifications']
}

/** A self-consistent JSON document is not proof of a complete SQLite adoption. */
async function readOwnerDocumentImportEvidence(tx: Pick<TransactionDb, 'select'>, identity: { workspace_id: string, owner_id: string }) {
  const rows = await tx.select<{ id: string, workspace_id: string, actor_id: string, command_id: string, source_sha256: string, evidence_json: string, evidence_sha256: string }>('SELECT * FROM owner_document_imports')
  const results = []
  const invalid = (): never => ownerDocumentFailure('unavailable', '商务采用基线缺完整原SQLite证据、稳定映射或固定原意图与回执')
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
  for (const row of rows) {
    const evidence = parseOwnerDocumentStoredJson<OwnerDocumentImportEvidence>(row.evidence_json)
    if (!object(evidence) || ownerDocumentDigest(evidence) !== row.evidence_sha256 || row.workspace_id !== identity.workspace_id || row.actor_id !== identity.owner_id
      || evidence.workspaceId !== row.workspace_id || evidence.actorId !== row.actor_id || evidence.commandId !== row.command_id || evidence.sourceSha256 !== row.source_sha256
      || !/^[a-f0-9]{64}$/.test(row.source_sha256) || !Number.isSafeInteger(evidence.schemaVersion) || evidence.schemaVersion < 47 || evidence.schemaVersion > 60
      || !object(evidence.rawDomain) || !object(evidence.sourceSchemas) || !Array.isArray(evidence.documents) || evidence.documents.length === 0 || evidence.documents.some(document => !object(document) || !Array.isArray(document.files)) || !Array.isArray(evidence.mappings) || evidence.mappings.some(mapping => !object(mapping))
      || !Array.isArray(evidence.metadataOnlyFileIds) || !Array.isArray(evidence.payloadRefs) || !Array.isArray(evidence.penaltyDeductions) || !Array.isArray(evidence.penaltyRectifications)
      || evidence.metadataOnlyFileIds.some(id => !isStableRouteIdentity(id)) || evidence.payloadRefs.some(ref => !object(ref))
      || ownerDocumentDigest({ rawDomain: evidence.rawDomain, sourceSchemas: evidence.sourceSchemas }) !== evidence.domainEvidenceDigest
      || Object.keys(evidence.rawDomain).sort().join(',') !== Object.keys(evidence.sourceSchemas).sort().join(',')) {
      invalid()
    }
    for (const table of [...Object.values(PRODUCTION_OWNER_DOCUMENT_HEAD_TABLES), 'expenditure_settlements', 'monthly_statement_lines', 'project_acceptance_lifecycle_events', 'penalty_settlement_deductions', 'file_refs', 'file_payloads', 'operation_logs']) {
      if (!Array.isArray(evidence.rawDomain[table]))
        invalid()
    }
    for (const [table, records] of Object.entries(evidence.rawDomain)) {
      const schema = evidence.sourceSchemas[table]
      if (!Array.isArray(records) || !schema || typeof schema.sql !== 'string' || !schema.sql || !Array.isArray(schema.columns) || !schema.columns.length
        || schema.columns.some(column => !object(column) || typeof column.name !== 'string') || records.some(record => !object(record) || typeof record.legacyId !== 'string') || new Set(records.map(record => record.legacyId)).size !== records.length) {
        invalid()
      }
      for (const raw of records) {
        if (!object(raw) || typeof raw.legacyId !== 'string' || !object(raw.columns)
          || Object.keys(raw.columns).sort().join(',') !== schema!.columns.map(column => column.name).sort().join(',')) {
          invalid()
        }
        for (const [name, column] of Object.entries(raw.columns)) {
          if (!object(column) || !['null', 'integer', 'real', 'text', 'blob'].includes(column.sqliteType))
            invalid()
          if (table === 'file_payloads' && name === 'content')
            continue
          if (column.sqliteType === 'null' ? column.exactValue !== null || column.rawHex !== null : typeof column.exactValue !== 'string')
            invalid()
          if (['text', 'blob'].includes(column.sqliteType) && (typeof column.rawHex !== 'string' || !/^(?:[A-F0-9]{2})*$/.test(column.rawHex)))
            invalid()
        }
      }
    }
    const [intent] = await tx.select<{ action: string, scope_id: string, fingerprint: string, request_json: string }>('SELECT * FROM owner_document_import_intents WHERE workspace_id=? AND actor_id=? AND command_id=?', [row.workspace_id, row.actor_id, row.command_id])
    const [receipt] = await tx.select<{ fingerprint: string, request_json: string, result_json: string }>('SELECT * FROM owner_document_import_commands WHERE workspace_id=? AND actor_id=? AND command_id=?', [row.workspace_id, row.actor_id, row.command_id])
    const request = intent ? parseOwnerDocumentStoredJson<Record<string, unknown>>(intent.request_json) : null
    const result = receipt ? parseOwnerDocumentStoredJson<{ workspaceId: string, actorId: string, commandId: string, sourceSha256: string, importId: string, documentIds: string[], restored: boolean }>(receipt.result_json) : null
    if (!intent || !receipt || !request || !result || intent.action !== 'adopt' || intent.scope_id !== row.source_sha256
      || intent.fingerprint !== ownerDocumentDigest(request) || receipt.fingerprint !== intent.fingerprint
      || ownerDocumentDigest(parseOwnerDocumentStoredJson(receipt.request_json)) !== intent.fingerprint
      || request.workspaceId !== row.workspace_id || request.actorId !== row.actor_id || request.commandId !== row.command_id || request.sourceSha256 !== row.source_sha256
      || result.workspaceId !== row.workspace_id || result.actorId !== row.actor_id || result.commandId !== row.command_id || result.sourceSha256 !== row.source_sha256 || result.importId !== row.id || result.restored !== false
      || !Array.isArray(result.documentIds) || result.documentIds.length !== evidence.documents.length || new Set(result.documentIds).size !== result.documentIds.length
      || evidence.documents.some(document => !result.documentIds.includes(document.id)) || evidence.mappings.length !== evidence.documents.length) {
      invalid()
    }
    for (const document of evidence.documents) {
      const table = document.kind === 'sub_settlement' ? 'expenditure_settlements' : PRODUCTION_OWNER_DOCUMENT_HEAD_TABLES[document.kind as keyof typeof PRODUCTION_OWNER_DOCUMENT_HEAD_TABLES]
      const mapping = evidence.mappings.find(mapping => mapping.kind === document.kind && mapping.documentId === document.id)
      const raw = mapping && evidence.rawDomain[table]?.find(raw => raw.legacyId === mapping.legacyId)
      const bindings = mapping ? await tx.select<{ source_table: string, legacy_id: string, project_id: string | null, contract_id: string | null }>('SELECT * FROM owner_document_import_bindings WHERE import_id=? AND kind=? AND document_id=?', [row.id, document.kind, document.id]) : []
      if (!table || !mapping || mapping.sourceTable !== table || mapping.projectId !== document.projectId || mapping.contractId !== document.contractId
        || !raw || bindings.length !== 1 || bindings[0]!.source_table !== table || bindings[0]!.legacy_id !== mapping.legacyId || bindings[0]!.project_id !== mapping.projectId || bindings[0]!.contract_id !== mapping.contractId) {
        invalid()
      }
    }
    if (evidence.payloadRefs.length !== evidence.rawDomain.file_payloads!.length)
      invalid()
    for (const ref of evidence.payloadRefs) {
      const raw = evidence.rawDomain.file_payloads!.find(raw => raw.legacyId === ref.fileRefId)
      const column = raw?.columns.content as unknown as { sqliteType: string, sharedOriginal: string, payloadReference: unknown } | undefined
      const [body] = await tx.select<{ content: Uint8Array, sha256: string }>('SELECT * FROM file_payloads WHERE file_ref_id=?', [ref.fileRefId])
      if (!column || column.sqliteType !== ref.sqliteType || column.sharedOriginal !== ref.fileRefId || ownerDocumentDigest(column.payloadReference) !== ownerDocumentDigest(ref)
        || ref.encoding !== 'base64' || raw!.columns.encoding?.exactValue !== ref.encoding || !body || !(body.content instanceof Uint8Array)
        || body.content.length !== ref.byteLength || body.sha256 !== ref.sha256 || createHash('sha256').update(body.content).digest('hex') !== ref.sha256) {
        invalid()
      }
      const originalColumn = Buffer.from(Buffer.from(body!.content).toString('base64'), 'utf8')
      if (originalColumn.length !== ref.columnByteLength || createHash('sha256').update(originalColumn).digest('hex') !== ref.columnSha256)
        invalid()
    }
    results.push({ ...row, evidence })
  }
  return results
}

export async function readProductionOwnerDocumentState(tx: TransactionDb, actor?: BusinessSession) {
  const identity = await assertProductionOwnerDocument(tx, actor)
  const [revision] = await tx.select<{ revision: number, metadata_json: string }>('SELECT * FROM owner_document_revision WHERE singleton=1')
  if (!revision || !Number.isSafeInteger(revision.revision) || revision.revision < 1)
    ownerDocumentFailure('unavailable', '商务实际版本缺失或损坏')
  const metadata = parseOwnerDocumentStoredJson<Pick<OwnerCommercialDocumentSnapshot, 'migrationKeys' | 'migrationSnapshotFingerprint'>>(revision.metadata_json)
  const { documents, deleted } = await readProductionOwnerDocumentRows(tx, true, identity.schemaVersion >= 2)
  const intents = await tx.select<{ workspace_id: string, actor_id: string, command_id: string, kind: OwnerCommercialDocumentKind, target_id: string | null, fingerprint: string, request_json: string, created_at: string }>('SELECT * FROM owner_document_command_intents ORDER BY workspace_id,actor_id,command_id')
  const originalCommands = new Map<string, OwnerCommercialDocumentCommandRequestDTO>()
  const snapshot: OwnerCommercialDocumentSnapshot = { schemaVersion: 1, documents, commands: [], commandFingerprints: [], sealedCommands: [], commandKinds: [], penaltyDeductions: [], penaltyRectifications: [], migrationKeys: metadata.migrationKeys, migrationSnapshotFingerprint: metadata.migrationSnapshotFingerprint, sourceVersion: revision.revision }
  for (const intent of intents) {
    const command = await restoreProductionOwnerDocumentIntent(tx, intent.request_json)
    if (intent.workspace_id !== identity.workspace_id || intent.actor_id !== identity.owner_id || command.commandId !== intent.command_id
      || command.workspaceId !== intent.workspace_id || command.actorId !== intent.actor_id || command.kind !== intent.kind || command.id !== intent.target_id
      || ownerDocumentDigest(command) !== intent.fingerprint) {
      ownerDocumentFailure('unavailable', '商务原意图身份、目标及原文指纹不能互证')
    }
    const key = commandJournalKey(command.commandId, { workspaceId: command.workspaceId, actorId: command.actorId } as BusinessSession, 'owner-commercial-document')
    originalCommands.set(key, command)
    snapshot.commandFingerprints.push([key, intent.fingerprint])
    snapshot.commandKinds.push([key, intent.kind])
  }
  for (const row of await tx.select<{ workspace_id: string, actor_id: string, command_id: string, kind: OwnerCommercialDocumentKind, fingerprint: string, result_json: string }>('SELECT * FROM owner_document_command_receipts ORDER BY workspace_id,actor_id,command_id')) {
    const intent = intents.find(intent => intent.workspace_id === row.workspace_id && intent.actor_id === row.actor_id && intent.command_id === row.command_id)
    if (!intent || row.kind !== intent.kind || row.fingerprint !== intent.fingerprint)
      ownerDocumentFailure('unavailable', '商务原回执缺对应固定原意图')
    snapshot.commands.push([commandJournalKey(row.command_id, { workspaceId: row.workspace_id, actorId: row.actor_id } as BusinessSession, 'owner-commercial-document'), parseOwnerDocumentStoredJson(row.result_json)])
  }
  for (const row of await tx.select<{ workspace_id: string, actor_id: string, command_id: string, kind: OwnerCommercialDocumentKind, descriptor_json: string }>('SELECT * FROM owner_document_command_resolutions')) {
    if (row.workspace_id !== identity.workspace_id || row.actor_id !== identity.owner_id)
      ownerDocumentFailure('unavailable', '商务原恢复身份不同')
    const descriptor = parseOwnerDocumentStoredJson<{ kind: string, commandId: string }>(row.descriptor_json)
    if (descriptor.kind !== row.kind || descriptor.commandId !== row.command_id)
      ownerDocumentFailure('unavailable', '商务恢复类型或原编号不能互证')
    snapshot.sealedCommands.push(commandJournalKey(row.command_id, { workspaceId: row.workspace_id, actorId: row.actor_id } as BusinessSession, 'owner-commercial-document'))
  }
  for (const row of await tx.select<{ id: string, penalty_id: string, settlement_id: string, record_json: string }>('SELECT * FROM penalty_settlement_deductions ORDER BY id')) {
    const source = parseOwnerDocumentStoredJson<OwnerCommercialDocumentSnapshot['penaltyDeductions'][number]>(row.record_json)
    if (source.id !== row.id || source.penaltyId !== row.penalty_id || source.settlementId !== row.settlement_id)
      ownerDocumentFailure('unavailable', '原抵扣稳定身份与双来源关系不同')
    snapshot.penaltyDeductions.push(source)
  }
  for (const row of await tx.select<{ id: string, penalty_id: string, record_json: string }>('SELECT * FROM penalty_rectification_events ORDER BY id')) {
    const source = parseOwnerDocumentStoredJson<OwnerCommercialDocumentSnapshot['penaltyRectifications'][number]>(row.record_json)
    if (source.id !== row.id || source.penaltyId !== row.penalty_id)
      ownerDocumentFailure('unavailable', '原整改稳定身份与罚扣不同')
    snapshot.penaltyRectifications.push(source)
  }
  const externalSettlements = await tx.select<{ id: string, projectId: string | null, supplierId: string | null, contractId: string | null, amount: number | null, status: string }>(`SELECT id,project_id AS projectId,supplier_id AS supplierId,contract_id AS contractId,total_amount AS amount,CASE WHEN status='已确认' THEN 'confirmed' ELSE status END AS status FROM expenditure_settlements ${identity.schemaVersion >= 2 ? 'WHERE document_owner=\'other\'' : ''}`)
  createOwnerCommercialDocumentCommandTestInstance({ strictSources: true, snapshot, penaltySettlementReferences: externalSettlements })
  const files = await tx.select<{ file_ref_id: string, kind: OwnerCommercialDocumentKind, owner_id: string, original_metadata_json: string, body_state: string, sha256: string | null }>('SELECT * FROM owner_document_files ORDER BY file_ref_id')
  const importEvidence = await readOwnerDocumentImportEvidence(tx, identity)
  for (const event of snapshot.penaltyDeductions) {
    const key = commandJournalKey(event.commandId, { workspaceId: identity.workspace_id, actorId: event.actorId } as BusinessSession, 'owner-commercial-document')
    const command = originalCommands.get(key)
    const receipt = snapshot.commands.find(([candidate]) => candidate === key)?.[1]
    const original = command?.action === 'deduct-penalty' && command.id === event.penaltyId && command.settlementId === event.settlementId
      && command.amount === event.amount && command.note.trim() === event.note && receipt?.updatedAt === event.occurredAt
    const imported = importEvidence.some(source => source.evidence.penaltyDeductions.some(original => ownerDocumentDigest(original) === ownerDocumentDigest(event)))
    if (!original && !imported)
      ownerDocumentFailure('unavailable', '独立抵扣缺原执行意图与回执或完整SQLite采用证明')
  }
  const metadataOnlyFileIds = new Set<string>()
  for (const binding of files) {
    const original = parseOwnerDocumentStoredJson<OwnerCommercialDocumentSource['files'][number]>(binding.original_metadata_json)
    const proof = importEvidence.find(source => source.evidence.documents?.some(document => document.kind === binding.kind && document.id === binding.owner_id && document.files.some(file => file.id === binding.file_ref_id && ownerDocumentDigest(file) === ownerDocumentDigest(original))))?.evidence
    const raw = proof?.rawDomain?.file_refs?.find(row => row.legacyId === binding.file_ref_id)
    const rawValue = (name: string) => {
      const columns = raw?.columns as Record<string, { sqliteType: string, exactValue?: unknown }> | undefined
      return columns && Object.hasOwn(columns, name) && Object.hasOwn(columns[name]!, 'exactValue') ? columns[name]!.exactValue : undefined
    }
    const [file] = await tx.select<{ id: string, owner_type: string, owner_id: string, file_name: string, file_size: number, mime_type: string, category: string, uploader: string, uploaded_at: string, deleted_at: string | null, content: Uint8Array | null, sha256: string | null }>('SELECT f.*,b.content,b.sha256 FROM file_refs f LEFT JOIN file_payloads b ON b.file_ref_id=f.id WHERE f.id=?', [binding.file_ref_id])
    if (!file || original.id !== binding.file_ref_id || file.owner_type !== productionOwnerDocumentOwnerType(binding.kind) || file.owner_id !== binding.owner_id
      || file.file_name !== original.fileName || (original.fileSize === null ? !(binding.body_state === 'metadata-only' && file.file_size === 0 && rawValue('file_size') === null) : file.file_size !== original.fileSize) || file.mime_type !== original.mimeType || file.category !== original.category || file.uploader !== original.uploader
      || (original.uploadedAt === null ? !(file.uploaded_at === '' && rawValue('uploaded_at') === null) : file.uploaded_at !== original.uploadedAt)) {
      ownerDocumentFailure('unavailable', '商务原件元数据与实际owner、原字节归属不同')
    }
    const document = documents.find(row => row.kind === binding.kind && row.id === binding.owner_id)
    const adopted = document?.files.find(row => row.id === binding.file_ref_id)
    const staged = intents.some(intent => intent.kind === binding.kind && (intent.target_id ?? productionOwnerDocumentId({ workspaceId: intent.workspace_id, actorId: intent.actor_id, commandId: intent.command_id, kind: intent.kind })) === binding.owner_id
      && (parseOwnerDocumentStoredJson<{ originalFileRefs?: string[] }>(intent.request_json).originalFileRefs ?? []).includes(binding.file_ref_id))
    if ((!adopted && !staged) || (adopted && (ownerDocumentDigest({ ...adopted, deletedAt: null }) !== ownerDocumentDigest({ ...original, deletedAt: null }) || file.deleted_at !== adopted.deletedAt)))
      ownerDocumentFailure('unavailable', '商务原件没有原单据或固定原意图，不能当作合法原件')
    if (binding.body_state === 'embedded' ? !(file.content instanceof Uint8Array) || file.content.length !== original.fileSize || createHash('sha256').update(file.content).digest('hex') !== binding.sha256 || file.sha256 !== binding.sha256 : file.content !== null || binding.sha256 !== null)
      ownerDocumentFailure('unavailable', '商务原件完整正文、真实大小或摘要损坏')
    if (binding.body_state === 'metadata-only') {
      if (!proof?.metadataOnlyFileIds?.includes(binding.file_ref_id) || !raw || rawValue('file_path') !== ''
        || proof.rawDomain?.file_payloads?.some(row => row.legacyId === binding.file_ref_id)) {
        ownerDocumentFailure('unavailable', '商务缺正文须有精确原SQLite缺件证明，不能据空BLOB猜缺件')
      }
      metadataOnlyFileIds.add(binding.file_ref_id)
    }
  }
  for (const document of documents) {
    if (document.files.some(file => !files.some(binding => binding.file_ref_id === file.id && binding.owner_id === document.id && binding.kind === document.kind)))
      ownerDocumentFailure('unavailable', '商务原头引用了未登记或错误owner的原件')
  }
  const histories = await tx.select<{ id: string, kind: OwnerCommercialDocumentKind, document_id: string, actor_id: string | null, command_id: string, before_json: string | null, after_json: string }>('SELECT * FROM owner_document_history ORDER BY kind,document_id,json_extract(after_json,\'$.version\')')
  for (const event of snapshot.penaltyRectifications) {
    const imported = importEvidence.some(source => source.evidence.penaltyRectifications.some(original => ownerDocumentDigest(original) === ownerDocumentDigest(event)))
    const corresponding = histories.filter(history => history.kind === 'project_penalty' && history.document_id === event.penaltyId && history.actor_id === event.actorId).filter((history) => {
      const key = commandJournalKey(history.command_id, { workspaceId: identity.workspace_id, actorId: event.actorId } as BusinessSession, 'owner-commercial-document')
      const command = originalCommands.get(key)
      const receipt = snapshot.commands.find(([candidate]) => candidate === key)?.[1]
      const after = parseOwnerDocumentStoredJson<OwnerCommercialDocumentSource>(history.after_json)
      return command?.action === 'rectify-penalty' && command.id === event.penaltyId && command.note.trim() === event.note && command.deadline === event.deadline
        && receipt?.updatedAt === event.occurredAt && after.penaltyFacts?.rectificationNote === event.note && after.penaltyFacts.deadline === event.deadline
    })
    if (!imported && (corresponding.length !== 1 || snapshot.penaltyRectifications.filter(other => other.penaltyId === event.penaltyId && other.actorId === event.actorId && other.occurredAt === event.occurredAt && other.note === event.note && other.deadline === event.deadline).length !== 1))
      ownerDocumentFailure('unavailable', '独立整改缺唯一原执行意图、回执和历史或完整SQLite采用证明')
  }
  const latest = new Map<string, OwnerCommercialDocumentSource>()
  for (const event of histories) {
    const after = parseOwnerDocumentStoredJson<OwnerCommercialDocumentSource>(event.after_json)
    const before = event.before_json === null ? null : parseOwnerDocumentStoredJson<OwnerCommercialDocumentSource>(event.before_json)
    if (after.id !== event.document_id || after.kind !== event.kind || !Number.isSafeInteger(after.version) || after.version < 1
      || (before && (before.id !== after.id || before.kind !== after.kind || after.version !== before.version + 1))) {
      ownerDocumentFailure('unavailable', '商务不可变审计的稳定身份或连续版本损坏')
    }
    const identity = `${after.kind}\u001F${after.id}`
    const tail = latest.get(identity)
    if (tail && (!before || after.version !== tail.version + 1 || ownerDocumentDigest(before) !== ownerDocumentDigest(tail)))
      ownerDocumentFailure('unavailable', '商务审计版本缺步、重复或原前文与上一节点不同')
    const intent = intents.find(row => row.command_id === event.command_id && row.actor_id === event.actor_id)
    const receipt = intent ? snapshot.commands.find(([key]) => key === commandJournalKey(intent.command_id, { workspaceId: intent.workspace_id, actorId: intent.actor_id } as BusinessSession, 'owner-commercial-document'))?.[1] : null
    if (intent && receipt) {
      const command = originalCommands.get(commandJournalKey(intent.command_id, { workspaceId: intent.workspace_id, actorId: intent.actor_id } as BusinessSession, 'owner-commercial-document'))!
      const target = command.id ?? productionOwnerDocumentId(command)
      const primary = command.kind === after.kind && target === after.id
      const secondary = command.action === 'deduct-penalty' && after.kind === 'sub_settlement' && command.settlementId === after.id
      if ((!primary && !secondary) || receipt.id !== target || receipt.updatedAt !== after.updatedAt
        || (primary && (Number(receipt.version) !== after.version || receipt.deleted !== ((after as { deletedAt?: string }).deletedAt !== undefined)))
        || (secondary && (!before || String(before.version) !== command.settlementVersion
          || ownerDocumentDigest({ ...after, version: before.version, updatedAt: before.updatedAt }) !== ownerDocumentDigest(before)))) {
        ownerDocumentFailure('unavailable', '商务普通审计没有对应原意图目标及回执')
      }
      if (command.baseVersion !== null && (!before || String(before.version) !== command.baseVersion) && primary)
        ownerDocumentFailure('unavailable', '商务审计前文不是原命令实际采用版本')
      if (!tail && (before !== null || after.version !== 1))
        ownerDocumentFailure('unavailable', '商务新建审计必须从实际首版本开始')
    }
    else {
      const imported = importEvidence.find(row => row.command_id === event.command_id && row.actor_id === event.actor_id && row.evidence.documents?.some(document => document.kind === after.kind && document.id === after.id && ownerDocumentDigest(document) === ownerDocumentDigest(after)))
      if (!tail && before === null && imported) {
        latest.set(identity, after)
        continue
      }
      const [restored] = await tx.select<{ import_id: string, restored_at: string }>('SELECT * FROM owner_document_import_restores WHERE command_id=? AND actor_id=?', [event.command_id, event.actor_id])
      const proof = restored && importEvidence.find(row => row.id === restored.import_id)
      const [restoreIntent] = proof ? await tx.select<{ action: string, scope_id: string, fingerprint: string, request_json: string }>('SELECT * FROM owner_document_import_intents WHERE workspace_id=? AND actor_id=? AND command_id=?', [proof.workspace_id, event.actor_id, event.command_id]) : []
      const [restoreReceipt] = proof ? await tx.select<{ fingerprint: string, request_json: string, result_json: string }>('SELECT * FROM owner_document_import_commands WHERE workspace_id=? AND actor_id=? AND command_id=?', [proof.workspace_id, event.actor_id, event.command_id]) : []
      const result = restoreReceipt ? parseOwnerDocumentStoredJson<{ importId: string, sourceSha256: string, restored: boolean, documentIds: string[] }>(restoreReceipt.result_json) : null
      if (!tail || !before || !proof || !restoreIntent || !restoreReceipt || restoreIntent.action !== 'restore' || restoreIntent.scope_id !== proof.source_sha256
        || restoreIntent.fingerprint !== ownerDocumentDigest(parseOwnerDocumentStoredJson(restoreIntent.request_json)) || restoreReceipt.fingerprint !== restoreIntent.fingerprint
        || ownerDocumentDigest(parseOwnerDocumentStoredJson(restoreReceipt.request_json)) !== restoreIntent.fingerprint
        || !result || result.importId !== proof.id || result.sourceSha256 !== proof.source_sha256 || result.restored !== true || !Array.isArray(result.documentIds) || !result.documentIds.includes(after.id)
        || (after as { deletedAt?: string }).deletedAt !== restored!.restored_at || after.updatedAt !== restored!.restored_at
        || ownerDocumentDigest({ ...after, version: before.version, updatedAt: before.updatedAt, ...((before as { deletedAt?: string }).deletedAt === undefined ? { deletedAt: undefined } : { deletedAt: (before as { deletedAt?: string }).deletedAt }) }) !== ownerDocumentDigest(before)) {
        ownerDocumentFailure('unavailable', '商务首个历史节点或整批恢复节点缺完整原SQLite采用基线与固定原命令回执')
      }
    }
    latest.set(identity, after)
  }
  for (const document of documents) {
    const tail = latest.get(`${document.kind}\u001F${document.id}`)
    if (!tail || ownerDocumentDigest(tail) !== ownerDocumentDigest(document))
      ownerDocumentFailure('unavailable', '商务当前原文与不可变审计尾不能互证')
  }
  const active = (kind: OwnerCommercialDocumentKind, id: string) => !deleted.has(`${kind}\u001F${id}`)
  const legacyCommandIds = new Set(importEvidence.flatMap(source => Object.entries(source.evidence.rawDomain).filter(([table]) => /^owner_document_(?:command|import)/.test(table)).flatMap(([, rows]) => rows.flatMap(row => typeof row.columns.command_id?.exactValue === 'string' ? [row.columns.command_id.exactValue] : []))))
  return {
    snapshot: { ...snapshot, documents: snapshot.documents.filter(row => active(row.kind, row.id)), penaltyDeductions: snapshot.penaltyDeductions.filter(row => active('project_penalty', row.penaltyId) && active('sub_settlement', row.settlementId)), penaltyRectifications: snapshot.penaltyRectifications.filter(row => active('project_penalty', row.penaltyId)), migrationKeys: snapshot.migrationKeys.filter(key => !deleted.has(key)) },
    allDocuments: documents,
    allPenaltyDeductions: snapshot.penaltyDeductions,
    allPenaltyRectifications: snapshot.penaltyRectifications,
    deleted,
    files,
    externalSettlements,
    intents,
    metadataOnlyFileIds,
    legacyCommandIds,
  }
}
export const validateProductionOwnerDocumentState = readProductionOwnerDocumentState

/** BOQ owns change facts; all commercial kinds still share one original command namespace. */
export async function assertProductionOwnerDocumentCommandNamespace(tx: TransactionDb, actor: BusinessSession, commandId: string, kind: OwnerCommercialDocumentKind, options: { legacyCommandIds?: ReadonlySet<string>, boqCommandId?: string } = {}) {
  const [owned] = await tx.select<{ kind: OwnerCommercialDocumentKind }>('SELECT kind FROM owner_document_command_intents WHERE workspace_id=? AND actor_id=? AND command_id=?', [actor.workspaceId, actor.actorId, commandId])
  const boq = await tx.select<{ command_id: string }>(`SELECT command_id FROM boq_command_intents WHERE workspace_id=? AND actor_id=?
    AND json_extract(request_json,'$.action.kind')='owner-change'
    AND json_extract(request_json,'$.action.command.commandId')=?`, [actor.workspaceId, actor.actorId, commandId])
  if ((owned && (owned.kind !== kind || kind === 'owner_change')) || (boq.length && kind !== 'owner_change')
    || (options.boqCommandId && boq.some(row => row.command_id !== options.boqCommandId))) {
    ownerDocumentFailure('conflict', '原商务编号已属于另一动作或事实接缝，不能跨单据重复应用')
  }
  if (boq.length > 1)
    ownerDocumentFailure('unavailable', '同一商务原编号存在多份固定签证意图，请保留原证据核对')
  if (!owned && !boq.length) {
    const legacy = options.legacyCommandIds ?? (await readProductionOwnerDocumentState(tx, actor)).legacyCommandIds
    if (legacy.has(commandId))
      ownerDocumentFailure('conflict', '原Native商务编号属于保全来源历史，不能冒用为新的正式提交')
  }
}

/** F3 consumes the existing shared settlement and exact cash allocations, never a copied settlement. */
export async function listProductionOwnerSettlementReferences(tx: TransactionDb, actor: BusinessSession) {
  if (!actor.capabilities.includes('subcontract-document:read'))
    failReference()
  const state = await readProductionOwnerDocumentState(tx, actor)
  const hiddenProjects = new Set((await tx.select<{ id: string }>('SELECT id FROM projects WHERE deleted_at IS NOT NULL')).map(row => row.id))
  const settlements = state.snapshot.documents.filter(row => row.kind === 'sub_settlement' && (!row.projectId || !hiddenProjects.has(row.projectId)))
  return Promise.all(settlements.map(async (source) => {
    const payments = await businessApplications(tx, actor, source)
    const amounts = subcontractSettlementAmounts(source, { contractAmount: null, settlements, deductions: state.snapshot.penaltyDeductions.map(row => ({ ...row, active: true })), ...payments })
    return { id: source.id, no: source.no, name: source.name, document_owner: 'business' as const, project_id: source.projectId, supplier_id: source.supplierId ?? null, contract_id: source.contractId, worker_id: null, payee_name_snapshot: source.supplierName ?? null, total_amount: amounts.netSettlement === null ? null : Number(amounts.netSettlement), status: source.status, deleted_at: null, version: String(source.version), source_revision: `owner-documents-${state.snapshot.sourceVersion}`, original_expense_line_ids: [], unavailable_reason: payments.applications === null ? '当前申请或余款资格不可证明，保留已确认现金且不能释放新付款额度' : null }
  }))
}
function failReference(): never {
  return ownerDocumentFailure('forbidden', '无正式分包结算来源读取权限')
}
export async function readProductionOwnerSettlementReference(tx: TransactionDb, actor: BusinessSession, id: string) {
  const row = (await listProductionOwnerSettlementReferences(tx, actor)).find(row => row.id === id) ?? null
  if (row?.unavailable_reason)
    ownerDocumentFailure('unavailable', row.unavailable_reason)
  return row
}

/** Older BOQ receipts recover from their exact after-event, never from the current mutable head. */
export async function productionOwnerDocumentBoqResult(tx: Pick<TransactionDb, 'select'>, result: { id: string, commandId: string, deleted?: boolean, ownerResult?: OwnerCommercialDocumentCommandResultDTO }, actor: BusinessSession) {
  if (result.ownerResult)
    return result.ownerResult
  const rows = await tx.select<{ after_json: string }>('SELECT after_json FROM boq_history WHERE entity_type=\'boq_change_records\' AND entity_id=? AND command_id=? AND actor_id=? ORDER BY created_at,id', [result.id, result.commandId, actor.actorId])
  if (rows.length !== 1)
    ownerDocumentFailure('unavailable', '原签证回执缺唯一原命令历史，不能用当前文书替代原结果')
  const source = parseOwnerDocumentStoredJson<OwnerCommercialDocumentSource>(rows[0]!.after_json)
  if (source.id !== result.id || !Number.isSafeInteger(source.version) || source.version < 1)
    ownerDocumentFailure('unavailable', '原签证历史身份或版本与原回执不同')
  return { id: source.id, commandId: result.commandId, version: String(source.version), updatedAt: source.updatedAt, attachmentIds: source.files.filter(file => file.deletedAt === null).map(file => file.id), deleted: result.deleted === true }
}
