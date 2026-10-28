import type { ConstructionMainOption, ConstructionMainSelection } from '../construction-scope/contract'
import type {
  ContractFormAttachment,
  ContractFormAttachmentChanges,
  F2SaveAction,
  ProjectContractFormDraft,
} from '../contract/forms'
import type { ContractSupplierOption } from '../contract/page'
import type { CommandResolution } from '../forms/command-recovery'
import type { OurSignatoryRecord } from '../our-signatory/contract'

export const SUBCONTRACT_CONTRACT_WRITE_CAPABILITY = 'subcontract-contract:write' as const

export interface SubcontractContractCommandContextDTO {
  workspaceId: string
  actorId: string
  capabilities: string[]
  projects: Array<{ id: string, label: string }>
  suppliers: ContractSupplierOption[]
  constructionMains?: ConstructionMainOption[]
  ourSignatories?: OurSignatoryRecord[]
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
  constructionMain?: ConstructionMainSelection
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
  constructionMain?: ConstructionMainSelection | null
}

export interface SubcontractContractCommandRepository {
  context: () => Promise<SubcontractContractCommandContextDTO>
  loadForm: (id: string) => Promise<SubcontractContractFormReadDTO>
  execute: (request: SubcontractContractCommandRequestDTO) => Promise<SubcontractContractCommandResultDTO>
  resolve: (commandId: string) => Promise<CommandResolution<SubcontractContractCommandResultDTO>>
}
