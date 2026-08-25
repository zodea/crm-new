import type { FileRefChanges, FileRefRecord } from '../forms/file-refs'
import type { OwnerCommercialDocumentKind } from './central-repository'
import type {
  OwnerDocumentBoqLine,
  OwnerDocumentDraft,
  OwnerDocumentLookupOption,
  OwnerReportAuditDraft,
} from './forms'

export const OWNER_COMMERCIAL_DOCUMENT_READ_CAPABILITY = 'owner-document:read' as const
export const OWNER_COMMERCIAL_DOCUMENT_WRITE_CAPABILITY = 'owner-document:write' as const

export interface OwnerCommercialDocumentCommandContextDTO {
  workspaceId: string
  actorId: string
  capabilities: string[]
  projects: Array<{ id: string, label: string, customerId: string | null }>
  customers: OwnerDocumentLookupOption[]
  contracts: Array<OwnerDocumentLookupOption & { projectId: string, customerId: string | null }>
}

interface OwnerCommercialDocumentCommandEnvelopeDTO {
  workspaceId: string
  actorId: string
  requiredCapability: typeof OWNER_COMMERCIAL_DOCUMENT_WRITE_CAPABILITY
  commandId: string
  kind: OwnerCommercialDocumentKind
  id: string | null
  baseVersion: string | null
}

export interface OwnerCommercialDocumentSaveCommandDTO extends OwnerCommercialDocumentCommandEnvelopeDTO {
  action: 'save' | 'submit'
  draft: OwnerDocumentDraft
  attachments: FileRefChanges
}

export interface OwnerCommercialDocumentApproveCommandDTO extends OwnerCommercialDocumentCommandEnvelopeDTO {
  action: 'approve'
  kind: 'owner_change'
  id: string
  approvedAt: string
}

export interface OwnerCommercialDocumentAuditCommandDTO extends OwnerCommercialDocumentCommandEnvelopeDTO {
  action: 'audit'
  kind: 'owner_report'
  id: string
  audit: Pick<OwnerReportAuditDraft, 'lines'>
}

export interface OwnerCommercialDocumentAttachmentsCommandDTO extends OwnerCommercialDocumentCommandEnvelopeDTO {
  action: 'attachments'
  id: string
  attachments: FileRefChanges
}

export interface OwnerCommercialDocumentDeleteCommandDTO extends OwnerCommercialDocumentCommandEnvelopeDTO {
  action: 'delete'
  id: string
}

export type OwnerCommercialDocumentCommandRequestDTO
  = | OwnerCommercialDocumentSaveCommandDTO
    | OwnerCommercialDocumentApproveCommandDTO
    | OwnerCommercialDocumentAuditCommandDTO
    | OwnerCommercialDocumentAttachmentsCommandDTO
    | OwnerCommercialDocumentDeleteCommandDTO

export interface OwnerCommercialDocumentCommandResultDTO {
  id: string
  commandId: string
  version: string
  updatedAt: string
  attachmentIds: string[]
  deleted: boolean
}

export interface OwnerCommercialDocumentFormReadDTO {
  kind: OwnerCommercialDocumentKind
  id: string
  draft: OwnerDocumentDraft & { id: string }
  attachments: FileRefRecord[]
  version: string
  updatedAt: string
}

export interface OwnerCommercialDocumentCommandRepository {
  context: () => Promise<OwnerCommercialDocumentCommandContextDTO>
  loadForm: (kind: OwnerCommercialDocumentKind, id: string) => Promise<OwnerCommercialDocumentFormReadDTO>
  boqLines: (projectId: string, contractId: string, periodNo?: string) => Promise<OwnerDocumentBoqLine[]>
  execute: (request: OwnerCommercialDocumentCommandRequestDTO) => Promise<OwnerCommercialDocumentCommandResultDTO>
}
