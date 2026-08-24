import type {
  ContractFormAttachment,
  ContractFormAttachmentChanges,
  F2SaveAction,
  ProjectContractFormDraft,
} from '../contract/forms'

export const MATERIAL_CONTRACT_WRITE_CAPABILITY = 'material-contract:write' as const

export interface MaterialContractCommandContextDTO {
  workspaceId: string
  actorId: string
  capabilities: string[]
  projects: Array<{ id: string, label: string }>
  suppliers: Array<{ id: string, label: string }>
}

export interface MaterialContractCommandRequestDTO {
  id?: string
  workspaceId: string
  actorId: string
  requiredCapability: typeof MATERIAL_CONTRACT_WRITE_CAPABILITY
  commandId: string
  baseVersion: string | null
  action: F2SaveAction
  draft: ProjectContractFormDraft
  attachments: ContractFormAttachmentChanges
}

export interface MaterialContractCommandResultDTO {
  id: string
  commandId: string
  version: string
  updatedAt: string
  attachmentIds: string[]
}

export interface MaterialContractFormReadDTO {
  draft: ProjectContractFormDraft & { id: string }
  attachments: ContractFormAttachment[]
  version: string
  updatedAt: string
}

export interface MaterialContractCommandRepository {
  context: () => Promise<MaterialContractCommandContextDTO>
  loadForm: (id: string) => Promise<MaterialContractFormReadDTO>
  execute: (request: MaterialContractCommandRequestDTO) => Promise<MaterialContractCommandResultDTO>
}
