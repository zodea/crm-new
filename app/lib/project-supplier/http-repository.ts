import type { ProblemDTO } from '../../types/read-model'
import type {
  ProjectSupplierReadRepository,
  ProjectSupplierWorkbenchQueryDTO,
} from './read-contract'
import { problemFromHttpFailure } from '../read-model/problem'
import { decodeProjectSupplierFileContent } from './file-content'
import { ProjectSupplierRepositoryProblem } from './read-contract'
import {
  decodeProjectSupplierWorkbenchRead,
  projectSupplierProblemFromUnknown,
  serializeProjectSupplierWorkbenchQuery,
} from './read-decoder'

export interface ProjectSupplierHttpFetchOptions {
  query?: Record<string, unknown>
  method?: 'GET' | 'POST'
  body?: Record<string, unknown>
  signal?: AbortSignal
  timeout?: number
}

export type ProjectSupplierHttpFetcher = (url: string, options?: ProjectSupplierHttpFetchOptions) => Promise<unknown>

function problemPayload(cause: unknown): ProblemDTO | null {
  return problemFromHttpFailure(cause)
}

async function read<T>(request: () => Promise<unknown>, decode: (value: unknown) => T | Promise<T>): Promise<T> {
  try {
    return await decode(await request())
  }
  catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError')
      throw cause
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
    getContent: (query, input) => read(
      () => options.fetcher(
        `/api/read/project-suppliers/${encodeURIComponent(query.projectId)}/${encodeURIComponent(query.supplierId)}/files/${encodeURIComponent(query.fileId)}`,
        {
          query: {
            ...serializeProjectSupplierWorkbenchQuery(query),
            relationId: query.relationId,
            ownerType: query.ownerType,
            ownerId: query.ownerId,
          },
          signal: input?.signal,
          timeout: 30_000,
        },
      ),
      value => decodeProjectSupplierFileContent(value, query, input?.signal),
    ),
    get: (query: ProjectSupplierWorkbenchQueryDTO) => read(
      () => options.fetcher(
        `/api/read/project-suppliers/${encodeURIComponent(query.projectId)}/${encodeURIComponent(query.supplierId)}`,
        { query: serializeProjectSupplierWorkbenchQuery(query) },
      ),
      value => decodeProjectSupplierWorkbenchRead(value, query),
    ),
  }
}
