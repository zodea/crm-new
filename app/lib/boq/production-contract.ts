import type { OwnerCommercialDocumentCommandRequestDTO } from '../owner-document/central-command-contract'
import type { OwnerCommercialDocumentSource } from '../owner-document/central-repository'
import type { QuantityBoqLine } from '../quantity/central-boq'
import type { BoqFormatClass, BoqImportRow } from './import'
import type { BoqLinePatch } from './lines'

export interface BoqOriginalInput { fileName: string, mimeType: string, fileSize: number, sha256: string, payloadBase64: string }
export type ProductionBoqChangeDocument = Omit<OwnerCommercialDocumentSource, 'amount' | 'files'> & { amount: number | null, legacyLedgerId?: string | null, migrationBatchId?: string, files: Array<OwnerCommercialDocumentSource['files'][number] & { fileRefId?: string, sha256?: string }> }
export interface BoqIdentity { workspaceId: string, actorId: string, capabilities: readonly string[] }
export interface BoqScope { projectId: string, contractId: string, origin: 'real' }
export interface BoqSourceBinding { rowKey: string, itemId: string | null, itemVersion: string | null }
export type BoqAction
  = | { kind: 'import-file', original: BoqOriginalInput, formatClass: BoqFormatClass, rows: BoqImportRow[], bindings: BoqSourceBinding[] }
    | { kind: 'correct-building', lineId: string, version: string, buildingId: string, buildingVersion: string, reason: string, originalSourceVersion: string }
    | { kind: 'patch-line', lineId: string, version: string, patch: BoqLinePatch, itemVersion?: string }
    | { kind: 'delete-line', lineId: string, version: string }
    | { kind: 'restore-import', importId: string }
    | { kind: 'reject-change', changeId: string, version: string, note: string }
    | { kind: 'owner-change', command: Extract<OwnerCommercialDocumentCommandRequestDTO, { kind: 'owner_change' }> | OwnerCommercialDocumentCommandRequestDTO }

export interface BoqCommand extends BoqScope {
  workspaceId: string
  actorId: string
  commandId: string
  requiredCapability: 'boq:write'
  contractVersion: string
  action: BoqAction
}
export interface BoqCommandResult {
  workspaceId: string
  actorId: string
  commandId: string
  projectId: string
  contractId: string
  id: string
  action: BoqAction['kind']
  sourceVersion: string
  fileId?: string
  lineIds?: string[]
  priceIds?: string[]
  changeId?: string
  restored?: boolean
  deleted?: boolean
  buildingResult?: import('./central-building-contract').BoqBuildingResult
  ownerResult?: import('../owner-document/central-command-contract').OwnerCommercialDocumentCommandResultDTO
}
export interface ProductionBoqLine extends QuantityBoqLine {
  declaredBuildingId?: string
  projectId: string
  fileId: string | null
  changeId: string | null
  itemId: string | null
  section: string
  trade: string
  room: string
  spec: string
  multiplier: number | null
  taxRate: number | null
  ownerSupplied: boolean
  recognizedQty: number | null
  recognizedUnitPrice: number | null
  traceKey: string
  sourceSheet: string
  sourceRow: number | null
  version: string
  confirmedOriginal: boolean
}
export interface ProductionBoqFile { id: string, projectId: string, contractId: string, fileRefId: string, fileName: string, sha256: string | null, fileSize: number | null, formatClass: string, version: string, deletedAt: string | null, bodyState?: 'embedded' | 'metadata-only' }
export interface ProductionBoqPrice { id: string, projectId: string, contractId: string, fileId: string, itemId: string | null, itemName: string, itemCode: string, unit: string, unitPrice: number | null, spec: string, traceKey: string, sourceSheet: string, sourceRow: number | null, version: string }
export interface ProductionBoqRead extends BoqIdentity, BoqScope {
  sourceVersion: string
  contractVersion: string
  files: ProductionBoqFile[]
  lines: ProductionBoqLine[]
  prices: ProductionBoqPrice[]
  changes: Array<{ id: string, name: string, no: string, status: string, amount: number | null, version: string, approvedAt: string | null, document: ProductionBoqChangeDocument }>
  monthlySourceState: 'unavailable'
}
