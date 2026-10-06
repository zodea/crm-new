import type {
  ContractFormAttachment,
  ContractFormAttachmentChanges,
  F2SaveAction,
  ProjectContractFormDraft,
} from '../contract/forms'
import type { CommandResolution } from '../forms/command-recovery'

export const CONSTRUCTION_CONTRACT_WRITE_CAPABILITY = 'construction-contract:write' as const

export interface ConstructionContractCommandContextDTO {
  workspaceId: string
  actorId: string
  capabilities: string[]
  projects: Array<{ id: string, label: string, customerId: string | null }>
  customers: Array<{ id: string, label: string }>
}

export interface ConstructionContractCommandRequestDTO {
  id?: string
  workspaceId: string
  actorId: string
  requiredCapability: typeof CONSTRUCTION_CONTRACT_WRITE_CAPABILITY
  commandId: string
  baseVersion: string | null
  action: F2SaveAction
  draft: ProjectContractFormDraft
  attachments: ContractFormAttachmentChanges
}

export interface ConstructionContractCommandResultDTO {
  id: string
  commandId: string
  version: string
  updatedAt: string
  attachmentIds: string[]
}

export interface ConstructionContractFormReadDTO {
  draft: ProjectContractFormDraft & { id: string }
  attachments: ContractFormAttachment[]
  version: string
  updatedAt: string
}

export interface ConstructionContractCommandRepository {
  context: () => Promise<ConstructionContractCommandContextDTO>
  loadForm: (id: string) => Promise<ConstructionContractFormReadDTO>
  execute: (request: ConstructionContractCommandRequestDTO) => Promise<ConstructionContractCommandResultDTO>
  resolve: (commandId: string) => Promise<CommandResolution<ConstructionContractCommandResultDTO>>
}
