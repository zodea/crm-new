import type { SupplierFormDraft } from '../master-data/forms'
import type { SupplierCredentialAudit, SupplierCredentialCommandResult, SupplierCredentialRecord, SupplierCredentialRequirementRecord, SupplierCredentialReviewProof, SupplierCredentialStatus, SupplierCredentialValidity } from './credential-contract'
import { credentialProblem } from './credential-contract'
import { canonicalCredentialCategory, credentialExpiryState, defaultCredentialRequirement, hasManualCredentialReviewProof, resolveAutomaticCredentialStatus, SUPPLIER_CREDENTIAL_CATEGORIES } from './credentials'

export interface StoredSupplierCredential extends Omit<SupplierCredentialRecord, 'file'> {
  fileRefId: string | null
  deletedAt: string | null
  deletionToken: string | null
  migrationBatchId: string | null
  legacyId: string | null
}

export interface StoredSupplierCredentialFile {
  id: string
  ownerType: 'supplier_credential'
  ownerId: string
  fileName: string
  fileSize: number
  mimeType: string
  payloadBase64: string | null
  sha256: string | null
  createdAt: string | null
  deletedAt: string | null
  migrationBatchId: string | null
  legacyId: string | null
}

export interface StoredSupplierCredentialRequirement extends SupplierCredentialRequirementRecord {
  id: string
  supplierId: string
  deletedAt: string | null
  migrationBatchId: string | null
  legacyId: string | null
}

export interface SupplierCredentialMasterAudit {
  id: string
  action: string
  outcome: string
  sourceCategory: string
  changedFields: string[]
  notePresent: boolean
  createdAt: string
  actorId: string | null
}

/** 专用领域状态仅由领域命令及受控迁移写入；正文不进入主档读模型。 */
export interface SupplierCredentialAggregate {
  supplierId: string
  version: number
  migrationBatchId: string | null
  legacySupplierId: string | null
  migrationSourceHash: string | null
  /** 本批确认后的日常变更不能在重新确认或恢复中被静默抹除。 */
  changedAfterMigration: boolean
  credentials: StoredSupplierCredential[]
  files: StoredSupplierCredentialFile[]
  requirements: StoredSupplierCredentialRequirement[]
  audits: SupplierCredentialAudit[]
  supplierAudits: SupplierCredentialMasterAudit[]
  review: SupplierCredentialReviewProof | null
  commands: Array<{ commandId: string, fingerprint: string, result: SupplierCredentialCommandResult }>
}

export function emptySupplierCredentialAggregate(supplierId: string): SupplierCredentialAggregate {
  return { supplierId, version: 0, migrationBatchId: null, legacySupplierId: null, migrationSourceHash: null, changedAfterMigration: false, credentials: [], files: [], requirements: [], audits: [], supplierAudits: [], review: null, commands: [] }
}

export function credentialRequirements(aggregate: SupplierCredentialAggregate): SupplierCredentialRequirementRecord[] {
  return SUPPLIER_CREDENTIAL_CATEGORIES.map((category) => {
    const found = aggregate.requirements.find(row => row.category === category && row.deletedAt === null)
    return found ? { id: found.id, category, requirement: found.requirement, reason: found.reason, updatedAt: found.updatedAt } : { id: null, category, requirement: defaultCredentialRequirement(category), reason: '', updatedAt: null }
  })
}

export function credentialRecords(aggregate: SupplierCredentialAggregate): SupplierCredentialRecord[] {
  return aggregate.credentials.filter(row => row.deletedAt === null).map((row) => {
    const file = aggregate.files.find(file => file.id === row.fileRefId && file.ownerId === row.id && file.deletedAt === null)
    const { fileRefId: _fileRefId, deletedAt: _deletedAt, deletionToken: _deletionToken, migrationBatchId: _migrationBatchId, legacyId: _legacyId, ...record } = row
    return { ...structuredClone(record), file: file ? { id: file.id, ownerType: file.ownerType, ownerId: file.ownerId, fileName: file.fileName, fileSize: file.fileSize, mimeType: file.mimeType, state: file.payloadBase64 === null ? 'missing' : 'available' } : null }
  })
}

export function automaticCredentialStatus(aggregate: SupplierCredentialAggregate, now: Date): 'incomplete' | 'reviewing' {
  return resolveAutomaticCredentialStatus(credentialRecords(aggregate).map(row => ({ ...row, hasAccessibleFile: row.file?.state === 'available' })), credentialRequirements(aggregate), now)
}

export function currentCredentialStatus(aggregate: SupplierCredentialAggregate, now: Date): SupplierCredentialStatus {
  const automatic = automaticCredentialStatus(aggregate, now)
  const review = aggregate.review
  if (automatic === 'reviewing' && review && hasManualCredentialReviewProof({ status: review.decision, reviewedAt: review.reviewedAt, reviewNote: review.note }) && !requiredOriginalExpiredSinceReview(aggregate, now))
    return review.decision
  return automatic
}

function requiredOriginalExpiredSinceReview(aggregate: SupplierCredentialAggregate, now: Date): boolean {
  const reviewedAt = new Date(aggregate.review!.reviewedAt)
  if (!Number.isFinite(reviewedAt.getTime()))
    return true
  const required = new Set(credentialRequirements(aggregate).filter(row => row.requirement === 'required').map(row => row.category))
  return credentialRecords(aggregate).some(row => required.has(row.category)
    && row.file?.state === 'available'
    && credentialExpiryState(row, reviewedAt) !== 'expired'
    && credentialExpiryState(row, now) === 'expired')
}

/** 过期会永久撤销旧凭证，不因日后换回有效资料而复活。 */
export function revalidateCredentialReview(aggregate: SupplierCredentialAggregate, now: Date): void {
  if (aggregate.review && currentCredentialStatus(aggregate, now) !== aggregate.review.decision)
    aggregate.review = null
}

export const CREDENTIAL_MASTER_FIELDS = ['name', 'uniqueCode', 'taxNo', 'legalRep', 'address', 'bank', 'bankAccount'] as const
export function credentialMasterChanged(before: SupplierFormDraft, after: SupplierFormDraft): boolean {
  return CREDENTIAL_MASTER_FIELDS.some(field => String(before[field] ?? '').trim() !== String(after[field] ?? '').trim())
}

/** 仅包括真正影响必需资料核验的当前事实，不把 OCR 候选、备注和可选资料放入。 */
export function credentialReviewBasis(aggregate: SupplierCredentialAggregate): string {
  const required = new Set(credentialRequirements(aggregate).filter(row => row.requirement === 'required').map(row => row.category))
  return JSON.stringify({
    required: [...required].sort(),
    records: credentialRecords(aggregate).filter(row => required.has(row.category)).map(row => ({ id: row.id, category: row.category, validFrom: row.validFrom, expiresAt: row.expiresAt, longTerm: row.longTerm, fileId: row.file?.id ?? null, accessible: row.file?.state === 'available' })).sort((a, b) => a.id.localeCompare(b.id)),
  })
}

function date(value: string): boolean {
  if (!value)
    return true
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function normalizeCredentialValidity(input: SupplierCredentialValidity): SupplierCredentialValidity {
  if (!SUPPLIER_CREDENTIAL_CATEGORIES.includes(input.category))
    throw credentialProblem('validation-failed', '请选择有效的证照类别')
  const result = { category: canonicalCredentialCategory(input.category), validFrom: input.validFrom.trim(), expiresAt: input.longTerm ? '' : input.expiresAt.trim(), longTerm: input.longTerm }
  if (!date(result.validFrom) || !date(result.expiresAt) || (result.validFrom && result.expiresAt && result.validFrom > result.expiresAt))
    throw credentialProblem('validation-failed', '请核对有效期，截止日期不能早于开始日期')
  return result
}
