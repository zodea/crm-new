import type {
  ContractFormAttachment,
  ContractFormAttachmentChanges,
  ContractLineItemDraft,
  F2SaveAction,
  ProjectContractFormDraft,
} from '../contract/forms'
import type { ContractSupplierOption } from '../contract/page'
import type { OurSignatoryRecord, OurSignatorySnapshot } from '../our-signatory/contract'

export const MATERIAL_CONTRACT_WRITE_CAPABILITY = 'material-contract:write' as const

export interface MaterialContractCommandContextDTO {
  workspaceId: string
  actorId: string
  capabilities: string[]
  projects: Array<{ id: string, label: string }>
  suppliers: ContractSupplierOption[]
  ourSignatories?: OurSignatoryRecord[]
  originalContracts?: Array<{ id: string, no: string, label: string, projectId: string | null, supplierId: string | null, lineItems: ContractLineItemDraft[], ourSignatorySnapshot?: OurSignatorySnapshot | null }>
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
  /** 原提交顺序对应的稳定身份；读回较新版本时仍不按位置猜测。 */
  lineIds?: string[]
  deductionIds?: string[]
  warnings?: string[]
}

export interface MaterialContractFormReadDTO {
  draft: ProjectContractFormDraft & { id: string }
  attachments: ContractFormAttachment[]
  version: string
  updatedAt: string
}

export type MaterialContractCommandResolutionDTO
  = | { outcome: 'applied', result: MaterialContractCommandResultDTO }
    | { outcome: 'not-applied', commandId: string }

export interface MaterialContractCommandRepository {
  context: () => Promise<MaterialContractCommandContextDTO>
  loadForm: (id: string) => Promise<MaterialContractFormReadDTO>
  execute: (request: MaterialContractCommandRequestDTO) => Promise<MaterialContractCommandResultDTO>
  resolve: (commandId: string) => Promise<MaterialContractCommandResolutionDTO>
}
