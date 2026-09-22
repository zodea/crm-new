import type { FileRefRecord } from '../../app/lib/forms/file-refs'
import type { CoreMigrationServerEntityDTO, CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type { ReceiptDraft, ReceiptRecord, ReceiptReferenceFacts } from '../../app/lib/receipt/contract'
import { emptyReceiptDraft, receiptProblem } from '../../app/lib/receipt/contract'
import { validateReceiptDraft } from '../../app/lib/receipt/domain'
import { prepareReceiptAttachments } from './receipt-attachments'
import { assertUniqueReceiptBankSerial } from './receipt-constraints'

export interface StoredReceipt extends ReceiptRecord { migrationBatchId: string | null }

function attribute(entity: CoreMigrationServerEntityDTO, key: string): string {
  const value = entity.attributes[key]
  if (value === undefined || value === null)
    return ''
  if (typeof value !== 'string')
    throw receiptProblem('validation-failed', `迁入收款字段 ${key} 必须为文本`)
  return value
}

function referencesFor(snapshot: CoreMigrationSnapshotDTO, existing: ReceiptReferenceFacts): ReceiptReferenceFacts {
  const projects = new Map(existing.projects.map(row => [row.id, row]))
  const customers = new Map(existing.customers.map(row => [row.id, row]))
  const contracts = new Map(existing.contracts.map(row => [row.id, row]))
  for (const row of snapshot.entities) {
    if (row.deletedAt !== null)
      continue
    if (row.entityType === 'projects')
      projects.set(row.id, { id: row.id, name: row.name, customerId: row.references.customerId ?? null })
    if (row.entityType === 'customers')
      customers.set(row.id, { id: row.id, name: row.name })
    if (row.entityType === 'construction_contracts')
      contracts.set(row.id, { id: row.id, name: row.name, no: attribute(row, 'no'), projectId: row.references.projectId ?? null, customerId: row.references.customerId ?? null, amount: row.amount, status: attribute(row, 'status') })
  }
  return { projects: [...projects.values()], customers: [...customers.values()], contracts: [...contracts.values()] }
}

function migratedFiles(entity: CoreMigrationServerEntityDTO, payloads: Map<string, string>): FileRefRecord[] {
  const json = attribute(entity, 'attachmentsJson')
  let raw: unknown
  try {
    raw = json ? JSON.parse(json) : []
  }
  catch { throw receiptProblem('validation-failed', '迁入收款附件格式无效') }
  if (!Array.isArray(raw))
    throw receiptProblem('validation-failed', '迁入收款附件格式无效')
  return raw.map((file: Record<string, unknown>): FileRefRecord => {
    if (!file || typeof file.id !== 'string' || !file.id || typeof file.fileName !== 'string' || !file.fileName.trim()
      || !Number.isSafeInteger(file.fileSize) || Number(file.fileSize) < 0) {
      throw receiptProblem('validation-failed', '迁入收款附件标识、名称或大小无效')
    }
    if (file.ownerType !== undefined && file.ownerType !== 'receipt_registration')
      throw receiptProblem('relationship-mismatch', '迁入附件不属于收款登记')
    if (file.ownerId !== undefined && file.ownerId !== entity.legacyId && file.ownerId !== entity.id)
      throw receiptProblem('relationship-mismatch', '迁入附件不属于当前收款')
    if (file.payloadEncoding !== undefined && file.payloadEncoding !== null && file.payloadEncoding !== 'base64')
      throw receiptProblem('validation-failed', '迁入附件正文编码不受支持')
    if (file.payloadBase64 !== undefined && file.payloadBase64 !== null) {
      const prepared = prepareReceiptAttachments({ ownerId: entity.id, records: [], payloads: new Map(), changes: { add: [{ fileName: file.fileName, fileSize: Number(file.fileSize), payloadBase64: file.payloadBase64 as string }] }, now: '', actorId: '', createId: () => String(file.id) })
      payloads.set(file.id, prepared.payloads.get(file.id)!)
    }
    return {
      id: file.id,
      ownerType: 'receipt_registration',
      ownerId: entity.id,
      fileName: file.fileName,
      filePath: typeof file.filePath === 'string' ? file.filePath : '',
      fileSize: Number(file.fileSize),
      mimeType: typeof file.mimeType === 'string' ? file.mimeType : '',
      category: typeof file.category === 'string' ? file.category : '',
      uploader: typeof file.uploader === 'string' ? file.uploader : '',
      uploadedAt: typeof file.uploadedAt === 'string' ? file.uploadedAt : '',
      deletedAt: typeof file.deletedAt === 'string' ? file.deletedAt : null,
    }
  })
}

export function prepareReceiptMigration(current: Map<string, StoredReceipt>, currentPayloads: Map<string, string>, snapshot: CoreMigrationSnapshotDTO, referenceFacts: ReceiptReferenceFacts) {
  const batchId = snapshot.authority === 'central' ? snapshot.activeBatchId : null
  const entities = batchId ? snapshot.entities.filter(row => row.entityType === 'receipt_registrations' && row.deletedAt === null) : []
  const ids = new Set(entities.map(row => row.id))
  const records = new Map(current)
  const payloads = new Map(currentPayloads)
  for (const [id, row] of records) {
    if (row.migrationBatchId && (row.migrationBatchId !== batchId || !ids.has(id)))
      records.delete(id)
  }
  const references = referencesFor(snapshot, referenceFacts)
  for (const entity of entities) {
    if (entity.batchId !== batchId)
      throw receiptProblem('relationship-mismatch', '迁入收款批次不一致')
    const existing = records.get(entity.id)
    if (existing) {
      if (existing.migrationBatchId !== batchId)
        throw receiptProblem('conflict', '迁入收款身份与已有中央记录冲突')
      continue
    }
    const draft = emptyReceiptDraft()
    for (const key of Object.keys(draft) as (keyof ReceiptDraft)[]) {
      if (['projectId', 'customerId', 'contractId', 'amount'].includes(key))
        continue
      Object.assign(draft, { [key]: attribute(entity, key) })
    }
    draft.no = draft.no || entity.name
    draft.projectId = entity.references.projectId ?? null
    draft.customerId = entity.references.customerId ?? null
    draft.contractId = entity.references.contractId ?? null
    draft.amount = entity.amount
    validateReceiptDraft(draft, ['draft', '草稿'].includes(draft.status) ? 'draft' : 'save', references)
    records.set(entity.id, {
      id: entity.id,
      dataOrigin: 'real',
      draft,
      migrationBatchId: batchId,
      version: '1',
      createdAt: attribute(entity, 'createdAt'),
      updatedAt: attribute(entity, 'updatedAt'),
      createdBy: attribute(entity, 'createdBy'),
      updatedBy: attribute(entity, 'updatedBy'),
      attachments: migratedFiles(entity, payloads),
    })
  }
  const fileIds = new Set<string>()
  assertUniqueReceiptBankSerial(records.values())
  for (const row of records.values()) {
    for (const file of row.attachments) {
      if (fileIds.has(file.id))
        throw receiptProblem('conflict', '迁入附件稳定编号重复')
      fileIds.add(file.id)
    }
  }
  for (const id of payloads.keys()) {
    if (!fileIds.has(id))
      payloads.delete(id)
  }
  return { records, payloads, changed: records.size !== current.size || [...records].some(([id, row]) => current.get(id) !== row) }
}
