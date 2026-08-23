import type {
  FormAttachmentChanges,
  MasterDataSaveAction,
  SupplierFormDraft,
} from '../master-data/forms'

export const SUPPLIER_WRITE_CAPABILITY = 'supplier:write' as const

export interface SupplierCommandContextDTO {
  workspaceId: string
  actorId: string
  capabilities: string[]
}

export interface SupplierCommandRequestDTO {
  id?: string
  workspaceId: string
  actorId: string
  requiredCapability: typeof SUPPLIER_WRITE_CAPABILITY
  commandId: string
  baseVersion: string | null
  action: MasterDataSaveAction
  draft: SupplierFormDraft
  attachments: FormAttachmentChanges
}

export interface SupplierCommandResultDTO {
  id: string
  commandId: string
  version: string
  updatedAt: string
  attachmentIds: string[]
}

export interface SupplierFormReadDTO {
  draft: SupplierFormDraft & { id: string }
  attachments: []
  version: string
  updatedAt: string
}

export interface SupplierCommandRepository {
  context: () => Promise<SupplierCommandContextDTO>
  loadForm: (id: string) => Promise<SupplierFormReadDTO>
  execute: (request: SupplierCommandRequestDTO) => Promise<SupplierCommandResultDTO>
}
