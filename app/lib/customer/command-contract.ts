import type {
  CustomerFormDraft,
  FormAttachment,
  FormAttachmentChanges,
  MasterDataSaveAction,
} from '../master-data/forms'

export const CUSTOMER_WRITE_CAPABILITY = 'customer:write' as const

export interface CustomerCommandContextDTO {
  workspaceId: string
  actorId: string
  capabilities: string[]
}

export interface CustomerCommandRequestDTO {
  id?: string
  workspaceId: string
  actorId: string
  requiredCapability: typeof CUSTOMER_WRITE_CAPABILITY
  commandId: string
  baseVersion: string | null
  action: MasterDataSaveAction
  draft: CustomerFormDraft
  attachments: FormAttachmentChanges
}

export interface CustomerCommandResultDTO {
  id: string
  commandId: string
  version: string
  updatedAt: string
  attachmentIds: string[]
}

export interface CustomerFormReadDTO {
  draft: CustomerFormDraft & { id: string }
  attachments: FormAttachment[]
  version: string
  updatedAt: string
}

export interface CustomerCommandRepository {
  context: () => Promise<CustomerCommandContextDTO>
  loadForm: (id: string) => Promise<CustomerFormReadDTO>
  execute: (request: CustomerCommandRequestDTO) => Promise<CustomerCommandResultDTO>
}
