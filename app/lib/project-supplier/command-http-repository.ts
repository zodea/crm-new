import type { ProblemDTO } from '../../types/read-model'
import type {
  ProjectSupplierCommandRepository,
  ProjectSupplierImportCommandResultDTO,
  ProjectSupplierImportContextDTO,
} from './command-contract'
import type { ProjectSupplierHttpFetcher } from './http-repository'
import { isISODateTimeDTO, isProblemCodeDTO } from '../../types/read-model'
import { projectSupplierProblem, ProjectSupplierRepositoryProblem } from './read-contract'
import { projectSupplierProblemFromUnknown } from './read-decoder'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(message: string): never {
  throw new ProjectSupplierRepositoryProblem(projectSupplierProblem('internal-error', message))
}

function problemPayload(cause: unknown): ProblemDTO | null {
  if (!object(cause))
    return null
  const response = object(cause.response) ? cause.response : null
  const raw = response?._data ?? cause.data
  const candidate = object(raw) && object(raw.data) ? raw.data : raw
  if (!object(candidate) || !isProblemCodeDTO(candidate.code) || typeof candidate.message !== 'string'
    || typeof candidate.retryable !== 'boolean' || !object(candidate.fieldErrors)
    || !(candidate.traceId === null || typeof candidate.traceId === 'string')) {
    return null
  }
  return candidate as unknown as ProblemDTO
}

async function request<T>(work: () => Promise<unknown>, decode: (value: unknown) => T): Promise<T> {
  try {
    return decode(await work())
  }
  catch (cause) {
    if (cause instanceof ProjectSupplierRepositoryProblem)
      throw cause
    const remote = problemPayload(cause)
    if (remote)
      throw new ProjectSupplierRepositoryProblem(remote, { cause })
    throw projectSupplierProblemFromUnknown(cause)
  }
}

function context(value: unknown): ProjectSupplierImportContextDTO {
  if (!object(value) || !object(value.project)
    || typeof value.workspaceId !== 'string' || typeof value.actorId !== 'string'
    || !Array.isArray(value.capabilities) || !value.capabilities.every(item => typeof item === 'string')
    || typeof value.project.id !== 'string' || typeof value.project.name !== 'string'
    || !Array.isArray(value.suppliers) || !value.suppliers.every(supplier => object(supplier)
      && typeof supplier.id === 'string' && typeof supplier.name === 'string'
      && Array.isArray(supplier.aliases) && supplier.aliases.every(alias => typeof alias === 'string'))
    || !Array.isArray(value.existingSupplierIds) || !value.existingSupplierIds.every(id => typeof id === 'string')
    || typeof value.sourceVersion !== 'string') {
    return invalid('中央后台返回的项目分供方导入上下文无效')
  }
  return value as unknown as ProjectSupplierImportContextDTO
}

function result(value: unknown): ProjectSupplierImportCommandResultDTO {
  if (!object(value) || typeof value.commandId !== 'string' || typeof value.version !== 'string'
    || !isISODateTimeDTO(value.updatedAt)
    || !['relationshipCount', 'fileCount', 'createdSupplierCount', 'reusedRelationshipCount']
      .every(field => Number.isSafeInteger(value[field]) && Number(value[field]) >= 0)) {
    return invalid('中央后台返回的项目分供方导入结果无效')
  }
  return value as unknown as ProjectSupplierImportCommandResultDTO
}

export function createHttpProjectSupplierCommandRepository(options: { fetcher: ProjectSupplierHttpFetcher }): ProjectSupplierCommandRepository {
  return {
    loadImportContext: projectId => request(
      () => options.fetcher(`/api/read/project-suppliers/${encodeURIComponent(projectId)}/import-context`),
      context,
    ),
    importFiles: command => request(
      () => options.fetcher('/api/commands/project-suppliers/import', {
        method: 'POST',
        body: { ...command },
      }),
      result,
    ),
  }
}
