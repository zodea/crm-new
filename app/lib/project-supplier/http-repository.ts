import type { ProblemDTO } from '../../types/read-model'
import type {
  ProjectSupplierReadRepository,
  ProjectSupplierWorkbenchQueryDTO,
} from './read-contract'
import { isProblemCodeDTO } from '../../types/read-model'
import { ProjectSupplierRepositoryProblem } from './read-contract'
import {
  decodeProjectSupplierWorkbenchRead,
  projectSupplierProblemFromUnknown,
  serializeProjectSupplierWorkbenchQuery,
} from './read-decoder'

export interface ProjectSupplierHttpFetchOptions {
  query?: Record<string, unknown>
}

export type ProjectSupplierHttpFetcher = (url: string, options?: ProjectSupplierHttpFetchOptions) => Promise<unknown>

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

async function read<T>(request: () => Promise<unknown>, decode: (value: unknown) => T): Promise<T> {
  try {
    return decode(await request())
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

export function createHttpProjectSupplierReadRepository(options: { fetcher: ProjectSupplierHttpFetcher }): ProjectSupplierReadRepository {
  return {
    get: (query: ProjectSupplierWorkbenchQueryDTO) => read(
      () => options.fetcher(
        `/api/read/project-suppliers/${encodeURIComponent(query.projectId)}/${encodeURIComponent(query.supplierId)}`,
        { query: serializeProjectSupplierWorkbenchQuery(query) },
      ),
      decodeProjectSupplierWorkbenchRead,
    ),
  }
}
