import type {
  ContractFormAttachment,
  ContractFormAttachmentChanges,
  F2SaveAction,
  ProjectContractFormDraft,
} from '../contract/forms'

export const SUBCONTRACT_CONTRACT_WRITE_CAPABILITY = 'subcontract-contract:write' as const

export interface SubcontractContractCommandContextDTO {
  workspaceId: string
  actorId: string
  capabilities: string[]
  projects: Array<{ id: string, label: string }>
  suppliers: Array<{ id: string, label: string }>
}

export interface SubcontractContractCommandRequestDTO {
  id?: string
  workspaceId: string
  actorId: string
  requiredCapability: typeof SUBCONTRACT_CONTRACT_WRITE_CAPABILITY
  commandId: string
  baseVersion: string | null
  action: F2SaveAction
  draft: ProjectContractFormDraft
  attachments: ContractFormAttachmentChanges
}

export interface SubcontractContractCommandResultDTO {
  id: string
  commandId: string
  version: string
  updatedAt: string
  attachmentIds: string[]
}

export interface SubcontractContractFormReadDTO {
  draft: ProjectContractFormDraft & { id: string }
  attachments: ContractFormAttachment[]
  version: string
  updatedAt: string
}

export interface SubcontractContractCommandRepository {
  context: () => Promise<SubcontractContractCommandContextDTO>
  loadForm: (id: string) => Promise<SubcontractContractFormReadDTO>
  execute: (request: SubcontractContractCommandRequestDTO) => Promise<SubcontractContractCommandResultDTO>
}
