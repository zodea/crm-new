import type {
  ProjectSupplierImportCommandRequestDTO,
  ProjectSupplierImportFileDTO,
  ProjectSupplierImportGroupDTO,
} from '../../app/lib/project-supplier/command-contract'
import type { BusinessSession } from './business-session'
import { PROJECT_SUPPLIER_WRITE_CAPABILITY } from '../../app/lib/project-supplier/command-contract'
import { projectSupplierProblem, ProjectSupplierRepositoryProblem } from '../../app/lib/project-supplier/repository'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(message: string): never {
  throw new ProjectSupplierRepositoryProblem(projectSupplierProblem('validation-failed', message))
}

function file(value: unknown): value is ProjectSupplierImportFileDTO {
  return object(value)
    && typeof value.fileName === 'string'
    && typeof value.fileSize === 'number'
    && typeof value.mimeType === 'string'
    && typeof value.category === 'string'
    && typeof value.payloadBase64 === 'string'
}

function group(value: unknown): value is ProjectSupplierImportGroupDTO {
  return object(value)
    && (value.supplierId === null || typeof value.supplierId === 'string')
    && typeof value.supplierName === 'string'
    && Array.isArray(value.files)
    && value.files.every(file)
}

export function parseProjectSupplierImportCommandRequest(value: unknown): ProjectSupplierImportCommandRequestDTO {
  if (!object(value) || !Array.isArray(value.groups) || !value.groups.every(group))
    return fail('项目分供方导入命令内容无效')
  if (typeof value.projectId !== 'string' || typeof value.workspaceId !== 'string'
    || typeof value.actorId !== 'string' || value.requiredCapability !== PROJECT_SUPPLIER_WRITE_CAPABILITY
    || typeof value.commandId !== 'string' || typeof value.baseVersion !== 'string') {
    return fail('项目分供方导入命令信封无效')
  }
  return value as unknown as ProjectSupplierImportCommandRequestDTO
}

export function assertProjectSupplierWriteCapability(session: BusinessSession): void {
  if (!session.capabilities.includes(PROJECT_SUPPLIER_WRITE_CAPABILITY)) {
    throw new ProjectSupplierRepositoryProblem(
      projectSupplierProblem('forbidden', '无项目分供方导入权限'),
    )
  }
}
