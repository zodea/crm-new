import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { SupplierFormDraft } from '../../app/lib/master-data/forms'
import type { SupplierCommandResultDTO } from '../../app/lib/supplier/command-contract'
import type { StoredSupplierCredentialFile, SupplierCredentialAggregate } from '../../app/lib/supplier/credential-domain'
import type { BusinessSession } from './business-session'
import type { SupplierCommandState } from './supplier-command-service'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { emptySupplierCredentialAggregate } from '../../app/lib/supplier/credential-domain'
import { hasManualCredentialReviewProof } from '../../app/lib/supplier/credentials'
import { supplierProblem, SupplierRepositoryProblem } from '../../app/lib/supplier/repository'
import { parseSupplierCommandRequest } from './supplier-command-request'

export function productionSupplierFailure(code: 'unavailable' | 'forbidden' | 'conflict' | 'not-found' | 'validation-failed', message: string): never {
  throw new SupplierRepositoryProblem(supplierProblem(code, message))
}
const corrupt = () => productionSupplierFailure('unavailable', '分供方磁盘记录或原件关系损坏，请停止写入并核对备份。')
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
function json<T>(value: string): T {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return corrupt()
    return parsed as T
  }
  catch { return corrupt() }
}
interface SupplierRow { id: string, draft_json: string, credential_status: string, version: number, updated_at: string, migration_batch_id: string | null, imported: number }
interface ScopeRow { supplier_id: string, version: number, metadata_json: string }
interface FactRow { id: string, supplier_id: string, record_json: string, file_ref_id?: string | null, credential_id?: string | null }
export interface SupplierReceiptRow { command_id: string, supplier_id: string, workspace_id: string, actor_id: string, kind: 'master' | 'credential', fingerprint: string, import_fingerprint: string | null, result_json: string }
const factTables = {
  credentials: 'supplier_credentials',
  requirements: 'supplier_credential_requirements',
  audits: 'supplier_credential_audits',
  supplierAudits: 'supplier_audits',
} as const

type ScopeMetadata = Omit<SupplierCredentialAggregate, keyof typeof factTables | 'files' | 'commands'>
function scopeMetadata(raw: string): ScopeMetadata {
  const value = json<ScopeMetadata>(raw)
  if (Object.keys(value).sort().join(',') !== 'changedAfterMigration,legacySupplierId,migrationBatchId,migrationSourceHash,review,supplierId,version'
    || typeof value.changedAfterMigration !== 'boolean'
    || [value.legacySupplierId, value.migrationBatchId, value.migrationSourceHash].some(item => item !== null && typeof item !== 'string')) {
    corrupt()
  }
  const review = value.review
  if (review !== null && (!review || typeof review !== 'object' || Array.isArray(review)
    || Object.keys(review).sort().join(',') !== 'actorId,decision,note,reviewedAt'
    || !['qualified', 'rejected'].includes(review.decision) || typeof review.note !== 'string'
    || typeof review.reviewedAt !== 'string' || !Number.isFinite(Date.parse(review.reviewedAt))
    || (review.actorId !== null && typeof review.actorId !== 'string')
    || !hasManualCredentialReviewProof({ status: review.decision, reviewedAt: review.reviewedAt, reviewNote: review.note }))) {
    corrupt()
  }
  return value
}

/** Rows are loaded only inside the single coordinator transaction, then discarded. */
export async function loadProductionSuppliers(tx: TransactionDb, actor: BusinessSession): Promise<SupplierCommandState> {
  const state: SupplierCommandState = { suppliers: new Map(), credentialScopes: new Map(), commands: new Map(), commandFingerprints: new Map(), importFingerprints: new Map(), importedIds: new Set(), sourceVersion: 0 }
  const revision = (await tx.select<{ revision: number }>('SELECT revision FROM supplier_revision WHERE singleton=1'))[0]?.revision
  if (!Number.isSafeInteger(revision) || revision! < 0)
    corrupt()
  state.sourceVersion = revision!
  for (const row of await tx.select<SupplierRow>('SELECT * FROM suppliers')) {
    const draft = json<SupplierFormDraft>(row.draft_json)
    if (!draft || draft.id !== row.id || typeof draft.name !== 'string' || !Number.isSafeInteger(row.version) || row.version < 1 || !Number.isFinite(Date.parse(row.updated_at)))
      corrupt()
    state.suppliers.set(row.id, { id: row.id, draft, credentialStatus: row.credential_status, version: row.version, updatedAt: row.updated_at, migrationBatchId: row.migration_batch_id })
    try {
      parseSupplierCommandRequest({ id: row.id, workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'supplier:write', commandId: 'validate-disk-record', baseVersion: String(row.version), action: 'draft', attachments: {}, draft }, row.id)
    }
    catch { corrupt() }
    if (row.imported === 1)
      state.importedIds.add(row.id)
  }
  for (const row of await tx.select<ScopeRow>('SELECT * FROM supplier_credential_scopes')) {
    const metadata = scopeMetadata(row.metadata_json)
    if (!state.suppliers.has(row.supplier_id) || metadata.supplierId !== row.supplier_id || metadata.version !== row.version || !Number.isSafeInteger(row.version) || row.version < 0) {
      corrupt()
    }
    state.credentialScopes.set(row.supplier_id, { ...emptySupplierCredentialAggregate(row.supplier_id), ...metadata })
  }
  if (state.credentialScopes.size !== state.suppliers.size)
    corrupt()
  for (const [key, table] of Object.entries(factTables) as Array<[keyof typeof factTables, string]>) {
    for (const row of await tx.select<FactRow>(`SELECT * FROM ${table}`)) {
      const aggregate = state.credentialScopes.get(row.supplier_id)
      const value = json<{ id: string, supplierId?: string, fileRefId?: string | null, credentialId?: string | null }>(row.record_json)
      if (!aggregate || !value || value.id !== row.id || (value.supplierId !== undefined && value.supplierId !== row.supplier_id))
        corrupt()
      if ((key === 'credentials' && (value.supplierId !== row.supplier_id || value.fileRefId !== row.file_ref_id)) || (key === 'audits' && value.credentialId !== row.credential_id))
        corrupt()
      ;(aggregate![key] as unknown[]).push(value)
    }
  }
  interface FileRow { file_ref_id: string, supplier_id: string, credential_id: string, metadata_json: string, owner_type: string, owner_id: string, file_name: string, file_size: number, mime_type: string, uploaded_at: string, deleted_at: string | null, content: Uint8Array | null, sha256: string | null }
  for (const row of await tx.select<FileRow>('SELECT s.*,f.owner_type,f.owner_id,f.file_name,f.file_size,f.mime_type,f.uploaded_at,f.deleted_at,p.content,p.sha256 FROM supplier_credential_files s JOIN file_refs f ON f.id=s.file_ref_id LEFT JOIN file_payloads p ON p.file_ref_id=f.id')) {
    const aggregate = state.credentialScopes.get(row.supplier_id)
    const metadata = json<{ migrationBatchId: string | null, legacyId: string | null, sha256: string | null }>(row.metadata_json)
    const credential = aggregate?.credentials.find(item => item.id === row.credential_id)
    if (!credential || row.owner_type !== 'supplier_credential' || row.owner_id !== credential.id || credential.fileRefId !== row.file_ref_id
      || !metadata || Object.keys(metadata).sort().join(',') !== 'legacyId,migrationBatchId,sha256' || Object.values(metadata).some(value => value !== null && typeof value !== 'string')
      || (metadata.sha256 !== null && !/^[a-f0-9]{64}$/.test(metadata.sha256)) || metadata.sha256 !== row.sha256
      || (metadata.sha256 === null && (!metadata.legacyId || !metadata.migrationBatchId || metadata.migrationBatchId !== aggregate?.migrationBatchId || !aggregate.migrationSourceHash))
      || (row.content !== null && (row.content.length !== row.file_size || digest(row.content) !== row.sha256))) {
      corrupt()
    }
    aggregate!.files.push({ id: row.file_ref_id, ownerType: 'supplier_credential', ownerId: row.owner_id, fileName: row.file_name, fileSize: row.file_size, mimeType: row.mime_type, createdAt: row.uploaded_at, deletedAt: row.deleted_at, ...metadata, payloadBase64: row.content === null ? null : Buffer.from(row.content).toString('base64'), sha256: row.sha256 })
  }
  for (const aggregate of state.credentialScopes.values()) {
    if (aggregate.credentials.some(row => row.fileRefId && !aggregate.files.some(file => file.id === row.fileRefId && file.ownerId === row.id)))
      corrupt()
  }
  for (const row of await tx.select<SupplierReceiptRow>('SELECT * FROM supplier_command_receipts')) {
    const aggregate = state.credentialScopes.get(row.supplier_id)
    const result = json<SupplierCommandResultDTO & { supplierId?: string }>(row.result_json)
    if (!aggregate || row.actor_id !== actor.actorId || row.workspace_id !== actor.workspaceId || !result || result.commandId !== row.command_id)
      corrupt()
    if (row.kind === 'master') {
      if (result.id !== row.supplier_id || !/^[1-9]\d*$/.test(result.version) || !Number.isSafeInteger(Number(result.version)) || !Number.isFinite(Date.parse(result.updatedAt)) || !Array.isArray(result.attachmentIds) || result.attachmentIds.length)
        corrupt()
      state.commands.set(row.command_id, result)
      state.commandFingerprints.set(row.command_id, row.fingerprint)
      if (row.import_fingerprint !== null)
        state.importFingerprints.set(row.command_id, row.import_fingerprint)
    }
    else {
      const credentialResult = result as unknown as SupplierCredentialAggregate['commands'][number]['result']
      if (result.supplierId !== row.supplier_id || !/^[1-9]\d*$/.test(credentialResult.supplierVersion) || !/^\d+$/.test(credentialResult.credentialVersion) || !Number.isSafeInteger(Number(credentialResult.supplierVersion)) || !Number.isSafeInteger(Number(credentialResult.credentialVersion)))
        corrupt()
      aggregate!.commands.push({ commandId: row.command_id, fingerprint: row.fingerprint, result: result as unknown as SupplierCredentialAggregate['commands'][number]['result'] })
    }
  }
  return state
}

async function saveFile(tx: TransactionDb, supplierId: string, file: StoredSupplierCredentialFile, actor: BusinessSession) {
  const found = (await tx.select<{ owner_type: string, owner_id: string }>('SELECT owner_type,owner_id FROM file_refs WHERE id=?', [file.id]))[0]
  if (found && (found.owner_type !== 'supplier_credential' || found.owner_id !== file.ownerId))
    corrupt()
  if (!found) {
    await tx.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size,mime_type,uploader,uploaded_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?)', [file.id, file.ownerType, file.ownerId, file.fileName, file.fileSize, file.mimeType, actor.actorId, file.createdAt, file.deletedAt])
    if (file.payloadBase64 !== null) {
      const bytes = Buffer.from(file.payloadBase64, 'base64')
      if (bytes.toString('base64') !== file.payloadBase64 || bytes.length !== file.fileSize || digest(bytes) !== file.sha256)
        corrupt()
      await tx.execute('INSERT INTO file_payloads(file_ref_id,content,sha256) VALUES(?,?,?)', [file.id, bytes, file.sha256])
    }
    await tx.execute('INSERT INTO supplier_credential_files VALUES(?,?,?,?)', [file.id, supplierId, file.ownerId, JSON.stringify({ migrationBatchId: file.migrationBatchId, legacyId: file.legacyId, sha256: file.sha256 })])
  }
  else {
    await tx.execute('UPDATE file_refs SET deleted_at=? WHERE id=?', [file.deletedAt, file.id])
  }
}

/** Facts, immutable originals, audit and original receipt commit together. No cache is published. */
export async function saveProductionSuppliers(tx: TransactionDb, state: SupplierCommandState, before: SupplierCommandState, actor: BusinessSession) {
  for (const supplier of state.suppliers.values()) {
    const aggregate = state.credentialScopes.get(supplier.id) ?? corrupt()
    const old = before.credentialScopes.get(supplier.id)
    if (JSON.stringify(supplier) === JSON.stringify(before.suppliers.get(supplier.id)) && JSON.stringify(aggregate) === JSON.stringify(old))
      continue
    await tx.execute('INSERT INTO suppliers VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET draft_json=excluded.draft_json,credential_status=excluded.credential_status,version=excluded.version,updated_at=excluded.updated_at,migration_batch_id=excluded.migration_batch_id,imported=excluded.imported', [supplier.id, JSON.stringify(supplier.draft), supplier.credentialStatus, supplier.version, supplier.updatedAt, supplier.migrationBatchId ?? null, state.importedIds.has(supplier.id) ? 1 : 0])
    const { credentials, requirements, audits, supplierAudits, files, commands, ...metadata } = aggregate
    await tx.execute('INSERT INTO supplier_credential_scopes VALUES(?,?,?) ON CONFLICT(supplier_id) DO UPDATE SET version=excluded.version,metadata_json=excluded.metadata_json', [supplier.id, aggregate.version, JSON.stringify(metadata)])
    for (const row of credentials)
      await tx.execute('INSERT INTO supplier_credentials VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET file_ref_id=excluded.file_ref_id,record_json=excluded.record_json', [row.id, supplier.id, row.fileRefId, JSON.stringify(row)])
    for (const file of files) await saveFile(tx, supplier.id, file, actor)
    for (const row of requirements)
      await tx.execute('INSERT INTO supplier_credential_requirements VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET record_json=excluded.record_json', [row.id, supplier.id, JSON.stringify(row)])
    for (const row of audits.filter(row => !old?.audits.some(item => item.id === row.id)))
      await tx.execute('INSERT INTO supplier_credential_audits VALUES(?,?,?,?)', [row.id, supplier.id, row.credentialId, JSON.stringify(row)])
    for (const row of supplierAudits.filter(row => !old?.supplierAudits.some(item => item.id === row.id)))
      await tx.execute('INSERT INTO supplier_audits VALUES(?,?,?)', [row.id, supplier.id, JSON.stringify(row)])
    for (const row of commands.filter(row => !old?.commands.some(item => item.commandId === row.commandId)))
      await tx.execute('INSERT INTO supplier_command_receipts VALUES(?,?,?,?,?,?,?,?)', [row.commandId, supplier.id, actor.workspaceId, actor.actorId, 'credential', row.fingerprint, null, JSON.stringify(row.result)])
  }
  for (const [commandId, result] of state.commands) {
    if (!before.commands.has(commandId))
      await tx.execute('INSERT INTO supplier_command_receipts VALUES(?,?,?,?,?,?,?,?)', [commandId, result.id, actor.workspaceId, actor.actorId, 'master', state.commandFingerprints.get(commandId), state.importFingerprints.get(commandId) ?? null, JSON.stringify(result)])
  }
  await tx.execute('UPDATE supplier_revision SET revision=? WHERE singleton=1', [state.sourceVersion])
}
