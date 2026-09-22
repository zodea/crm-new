import type { DataOriginDTO } from '../../types/read-model'
import type { DeliveryAmountSource } from '../delivery/review'
import { projectProblem, ProjectRepositoryProblem } from '../project/repository'

export const DELIVERY_READ_CAPABILITY = 'delivery:read' as const
export const DELIVERY_WRITE_CAPABILITY = 'delivery:write' as const
export interface DeliveryDraftLine {
  id?: string
  materialName: string
  spec: string
  unit: string
  qty: number | null
  unitPrice: number | null
  amount?: number | null
  amountSource?: DeliveryAmountSource
  note: string
}
export interface DeliveryDraft {
  projectId: string
  supplierId: string | null
  orderNo: string
  deliveryDate: string
  note: string
  rawSiteText: string
  reviewFlag: string
  confirmations: { noOrderNoConfirmed?: boolean, pricePendingConfirmed?: boolean, amountReviewed?: boolean }
  lines: DeliveryDraftLine[]
}
export interface DeliverySourceUpload {
  fileName: string
  mimeType: string
  fileSize: number
  payloadBase64: string
}
export interface DeliveryAssetMetadata {
  id: string
  uploadBatchId: string
  fileName: string
  mimeType: string
  fileSize: number
  sha256: string
  createdAt: string
  createdBy: string
}
export interface DeliveryCentralLine extends DeliveryDraftLine {
  id: string
  deliveryRecordId: string
  amount: number | null
  amountSource: DeliveryAmountSource
  currentValueConfirmed: boolean
  sortOrder: number
}
export type DeliveryPrintDisposition = 'pending' | 'printed' | 'excluded'
export interface DeliveryCentralRecord {
  id: string
  dataOrigin: DataOriginDTO
  version: string
  uploadBatchId: string
  assetId: string | null
  projectId: string
  supplierId: string | null
  projectName: string
  supplierName: string
  orderNo: string
  deliveryDate: string
  note: string
  rawSiteText: string
  reviewFlag: string
  lines: DeliveryCentralLine[]
  fileName: string
  filePath: string
  hasSourceFile: boolean
  ocrStatus: string
  reviewStatus: 'reviewed' | 'unreviewed'
  currentValuesConfirmed: boolean
  naturalKeyDuplicate: boolean
  archived: boolean
  stored: boolean
  printBatchId: string
  printDisposition: DeliveryPrintDisposition
  printedAt: string
  printExcludedAt: string
  totalAmount: number
  createdAt: string
  updatedAt: string
  createdBy: string
  updatedBy: string
  deletedAt: string | null
  migrationBatchId: string | null
  legacyAudit: string | null
}
export type DeliveryRevisionAction = 'archive' | 'revise' | 'source' | 'print' | 'delete' | 'restore' | 'undo' | 'migration'
export interface DeliveryRevision {
  id: string
  recordId: string
  version: string
  action: DeliveryRevisionAction
  reason: string
  actorId: string
  createdAt: string
  before: DeliveryCentralRecord | null
  after: DeliveryCentralRecord
  changes: Array<{ field: string, before: unknown, after: unknown }>
}
export interface DeliveryReferenceFacts {
  projects: Array<{ id: string, name: string, dataOrigin: DataOriginDTO }>
  suppliers: Array<{ id: string, name: string, dataOrigin: DataOriginDTO, aliases?: readonly string[] }>
}
export interface DeliveryContext extends DeliveryReferenceFacts {
  workspaceId: string
  actorId: string
  capabilities: readonly string[]
}
interface DeliveryCommandEnvelope {
  commandId: string
  workspaceId: string
  actorId: string
  requiredCapability: typeof DELIVERY_WRITE_CAPABILITY
  origin: DataOriginDTO
}
export interface DeliveryArchiveCommand extends DeliveryCommandEnvelope {
  action: 'archive'
  baseVersion: null
  draft: DeliveryDraft
  uploadBatchId: string | null
  source: DeliverySourceUpload | null
}
interface DeliveryExistingCommand extends DeliveryCommandEnvelope { id: string, baseVersion: string }
export type DeliveryCommand = DeliveryArchiveCommand
  | (DeliveryExistingCommand & { action: 'revise', reason: string, draft: DeliveryDraft })
  | (DeliveryExistingCommand & { action: 'source', reason: string, source: DeliverySourceUpload })
  | (DeliveryExistingCommand & { action: 'delete' | 'restore', reason: string })
  | (DeliveryExistingCommand & { action: 'undo', revisionId: string, reason: string })
  | (DeliveryCommandEnvelope & { action: 'print', targets: Array<{ id: string, baseVersion: string }>, disposition: Exclude<DeliveryPrintDisposition, 'pending'> })
export interface DeliveryCommandResult {
  id: string
  version: string
  commandId: string
  revisionId: string
  updatedAt: string
}
export interface DeliveryList {
  records: DeliveryCentralRecord[]
  sourceVersion: string
  capabilities: readonly string[]
}
export interface DeliveryFileContent extends DeliveryAssetMetadata { payloadBase64: string }

export function deliveryProblem(code: Parameters<typeof projectProblem>[0], message: string): ProjectRepositoryProblem {
  return new ProjectRepositoryProblem(projectProblem(code, message))
}
