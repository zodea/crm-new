import type { DataOriginDTO, ProblemCodeDTO } from '../../types/read-model'
import type { OcrRuntimeRequestOptions } from '../recognize/engine'
import type { CredentialOcrDecision, CredentialOcrFieldChoice, CredentialOcrFieldKey, ParsedCredentialOcr } from './credential-ocr'
import type { SupplierCredentialCategory, SupplierCredentialRequirement } from './credentials'
import { supplierProblem, SupplierRepositoryProblem } from './read-contract'

export const SUPPLIER_CREDENTIAL_READ_CAPABILITY = 'supplier-credential:read' as const
export const SUPPLIER_CREDENTIAL_WRITE_CAPABILITY = 'supplier-credential:write' as const
export type SupplierCredentialStatus = 'incomplete' | 'reviewing' | 'qualified' | 'rejected'

export interface SupplierCredentialValidity {
  category: SupplierCredentialCategory
  validFrom: string
  expiresAt: string
  longTerm: boolean
}

export interface SupplierCredentialFile {
  id: string
  ownerType: 'supplier_credential'
  ownerId: string
  fileName: string
  fileSize: number
  mimeType: string
  state: 'available' | 'missing'
}

export interface SupplierCredentialRecord extends SupplierCredentialValidity {
  id: string
  supplierId: string
  file: SupplierCredentialFile | null
  /** 历史路径仅是无法读取的迁移线索。 */
  legacyFilePath: string
  ocrResult: Record<string, unknown>
  ocrConfidence: number | null
  ocrConfirmedResult: Record<string, unknown>
  ocrConfirmedAt: string | null
  ocrReviewStatus: 'not_started' | 'pending' | 'confirmed'
  verifiedAt: string | null
  addedAt: string | null
  updatedAt: string | null
  /** 新识别的原件边界；历史 OCR 原文保留原义，不自动生成确认。 */
  recognition?: SupplierCredentialRecognition | null
}

export interface SupplierCredentialRecognition {
  id: string
  fileId: string
  sha256: string
  recognizedAt: string
  result: Record<string, unknown>
  parsed: ParsedCredentialOcr
  historical?: boolean
}

export interface SupplierCredentialOcrConfirmation {
  recognitionId: string
  choices: CredentialOcrFieldChoice[]
  category: SupplierCredentialCategory
  longTerm: boolean
  decisions: { category: CredentialOcrDecision, longTerm: CredentialOcrDecision }
}

export interface SupplierCredentialRequirementRecord {
  id: string | null
  category: SupplierCredentialCategory
  requirement: SupplierCredentialRequirement
  reason: string
  updatedAt: string | null
}

export interface SupplierCredentialReviewProof {
  decision: 'qualified' | 'rejected'
  reviewedAt: string
  actorId: string | null
  note: string
}

export interface SupplierCredentialAudit {
  id: string
  credentialId: string | null
  action: string
  categoryBefore: string
  categoryAfter: string
  changedFields: string[]
  validFromBefore: string
  validFromAfter: string
  expiresAtBefore: string
  expiresAtAfter: string
  longTermBefore: boolean | null
  longTermAfter: boolean | null
  confidence: number | null
  createdAt: string
  actorId: string | null
  /** 只允许恢复当前这次删除；旧审计不是永久恢复授权。 */
  deletionToken: string | null
  canRestore: boolean
}

export interface SupplierCredentialSnapshot {
  dataOrigin: DataOriginDTO
  supplierId: string
  supplierName: string
  supplierVersion: string
  credentialVersion: string
  workspaceId: string
  actorId: string
  capabilities: string[]
  asOf: string
  businessDate: string
  status: SupplierCredentialStatus
  review: SupplierCredentialReviewProof | null
  credentials: SupplierCredentialRecord[]
  requirements: SupplierCredentialRequirementRecord[]
  audits: SupplierCredentialAudit[]
  masterValues?: Partial<Record<CredentialOcrFieldKey, string>>
}

export interface SupplierCredentialUpload extends SupplierCredentialValidity {
  fileName: string
  mimeType: string
  fileSize: number
  payloadBase64: string
}

export type SupplierCredentialAction
  = | { action: 'upload', draft: SupplierCredentialUpload }
    | { action: 'edit', credentialId: string, draft: SupplierCredentialValidity }
    | { action: 'requirement', draft: { category: SupplierCredentialCategory, requirement: SupplierCredentialRequirement, reason: string } }
    | { action: 'review', draft: { decision: 'qualified' | 'rejected', note: string } }
    | { action: 'delete', credentialId: string }
    | { action: 'restore', credentialId: string, auditId: string, deletionToken: string }
    | { action: 'ocr-recognize', credentialId: string, options: OcrRuntimeRequestOptions }
    | { action: 'ocr-confirm', credentialId: string, draft: SupplierCredentialOcrConfirmation }

export type SupplierCredentialCommand = SupplierCredentialAction & {
  commandId: string
  supplierId: string
  origin: DataOriginDTO
  workspaceId: string
  actorId: string
  requiredCapability: typeof SUPPLIER_CREDENTIAL_WRITE_CAPABILITY
  baseSupplierVersion: string
  baseCredentialVersion: string
}

export interface SupplierCredentialCommandResult {
  commandId: string
  supplierId: string
  credentialId: string | null
  auditId: string | null
  deletionToken: string | null
  supplierVersion: string
  credentialVersion: string
}

export interface SupplierCredentialFileQuery {
  supplierId: string
  credentialId: string
  fileId: string
  origin: DataOriginDTO
}

export type SupplierCredentialFileContent = SupplierCredentialFileQuery & SupplierCredentialFile & (
  | { state: 'available', payloadBase64: string, sha256: string }
  | { state: 'missing', reason: 'missing-payload' }
)

export interface SupplierCredentialRepository {
  read: (supplierId: string, origin: DataOriginDTO, options?: { signal?: AbortSignal }) => Promise<SupplierCredentialSnapshot>
  execute: (command: SupplierCredentialCommand) => Promise<SupplierCredentialCommandResult>
  file: (query: SupplierCredentialFileQuery, options?: { signal?: AbortSignal }) => Promise<SupplierCredentialFileContent>
}

export function credentialProblem(code: ProblemCodeDTO, message: string): SupplierRepositoryProblem {
  return new SupplierRepositoryProblem(supplierProblem(code, message, code === 'unavailable'))
}

/** 只用于查过原收据、且能证明该命令未发布任何更改的识别失败或写前拒绝。 */
export class SupplierCredentialNotAppliedProblem extends SupplierRepositoryProblem {
  constructor(readonly commandId: string, message: string, code: 'unavailable' | 'conflict' | 'not-found' | 'validation-failed' = 'unavailable') {
    super(supplierProblem(code, message, code === 'unavailable'))
    Object.assign(this.problem, { commandId, commandOutcome: 'not-applied' })
  }
}
