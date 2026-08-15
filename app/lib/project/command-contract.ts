import type {
  FormAttachment,
  FormAttachmentChanges,
  MasterDataSaveAction,
  ProjectFormDraft,
} from '../master-data/forms'

export const PROJECT_WRITE_CAPABILITY = 'project:write' as const

export interface ProjectCommandContextDTO {
  workspaceId: string
  actorId: string
  capabilities: string[]
}

export interface ProjectCommandRequestDTO {
  id?: string
  workspaceId: string
  actorId: string
  requiredCapability: typeof PROJECT_WRITE_CAPABILITY
  commandId: string
  baseVersion: string | null
  action: MasterDataSaveAction
  draft: ProjectFormDraft
  attachments: FormAttachmentChanges
}

export interface ProjectCommandResultDTO {
  id: string
  commandId: string
  version: string
  updatedAt: string
  attachmentIds: string[]
}

export interface ProjectFormReadDTO {
  draft: ProjectFormDraft & { id: string }
  attachments: FormAttachment[]
  version: string
  updatedAt: string
}

export interface ProjectCommandRepository {
  context: () => Promise<ProjectCommandContextDTO>
  loadForm: (id: string) => Promise<ProjectFormReadDTO>
  execute: (request: ProjectCommandRequestDTO) => Promise<ProjectCommandResultDTO>
}
