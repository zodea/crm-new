import type { ProjectSupplierImportResult } from './read-contract'

export const PROJECT_SUPPLIER_WRITE_CAPABILITY = 'project-supplier:write' as const
export const PROJECT_SUPPLIER_FILE_CATEGORIES = [
  '合同',
  '请款',
  '收票',
  '付款',
  '结算',
  '资质',
  '其他',
] as const

export interface ProjectSupplierImportFileDTO {
  fileName: string
  fileSize: number
  mimeType: string
  category: string
  payloadBase64: string
}

export interface ProjectSupplierImportGroupDTO {
  supplierId: string | null
  supplierName: string
  files: ProjectSupplierImportFileDTO[]
}

export interface ProjectSupplierImportCommandRequestDTO {
  projectId: string
  workspaceId: string
  actorId: string
  requiredCapability: typeof PROJECT_SUPPLIER_WRITE_CAPABILITY
  commandId: string
  baseVersion: string
  groups: ProjectSupplierImportGroupDTO[]
}

export interface ProjectSupplierImportCommandResultDTO extends ProjectSupplierImportResult {
  commandId: string
  version: string
  updatedAt: string
}

export interface ProjectSupplierImportContextDTO {
  workspaceId: string
  actorId: string
  capabilities: string[]
  project: { id: string, name: string }
  suppliers: Array<{ id: string, name: string, aliases: string[] }>
  existingSupplierIds: string[]
  sourceVersion: string
}

export interface ProjectSupplierCommandRepository {
  loadImportContext: (projectId: string) => Promise<ProjectSupplierImportContextDTO>
  importFiles: (request: ProjectSupplierImportCommandRequestDTO) => Promise<ProjectSupplierImportCommandResultDTO>
}
