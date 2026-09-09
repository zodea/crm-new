import type {
  FormAttachment,
  FormAttachmentChanges,
  MasterDataSaveAction,
  ProjectFormDraft,
} from '../master-data/forms'
import type { ProjectImportSource } from './import'

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
  /** Excel 导入来源；只允许新建 save，沿同一中央项目事实源保存。 */
  importSource?: ProjectImportSource
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
  importSource?: ProjectImportSource
}

export interface ProjectCommandRepository {
  context: () => Promise<ProjectCommandContextDTO>
  loadForm: (id: string) => Promise<ProjectFormReadDTO>
  execute: (request: ProjectCommandRequestDTO) => Promise<ProjectCommandResultDTO>
}
