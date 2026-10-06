import type { ProblemDTO } from '../../types/read-model'
import type {
  ConstructionContractReadRepository,
} from './read-contract'
import { decodeContractOriginalContent } from '../forms/original-content'
import { problemFromHttpFailure } from '../read-model/problem'
import { ConstructionContractRepositoryProblem } from './read-contract'
import {
  constructionContractProblemFromUnknown,
  decodeConstructionContractDetailRead,
  decodeConstructionContractListPage,
  serializeConstructionContractDetailQuery,
  serializeConstructionContractListQuery,
} from './read-decoder'

export interface ConstructionContractHttpFetchOptions {
  signal?: AbortSignal
  method?: 'GET' | 'POST' | 'PUT'
  query?: Record<string, unknown>
  body?: Record<string, any>
}

export type ConstructionContractHttpFetcher = (
  url: string,
  options?: ConstructionContractHttpFetchOptions,
) => Promise<unknown>

function problemPayload(cause: unknown): ProblemDTO | null {
  return problemFromHttpFailure(cause)
}

export async function readConstructionContractHttp<T>(request: () => Promise<unknown>, decode: (value: unknown) => T | Promise<T>): Promise<T> {
  try {
    return await decode(await request())
  }
  catch (cause) {
    if (cause instanceof ConstructionContractRepositoryProblem)
      throw cause
    const remote = problemPayload(cause)
    if (remote)
      throw new ConstructionContractRepositoryProblem(remote, { cause })
    throw constructionContractProblemFromUnknown(cause)
  }
}

export function createHttpConstructionContractReadRepository(
  options: { fetcher: ConstructionContractHttpFetcher },
): ConstructionContractReadRepository {
  return {
    list: query => readConstructionContractHttp(
      () => options.fetcher('/api/read/construction-contracts', { query: serializeConstructionContractListQuery(query) }),
      value => decodeConstructionContractListPage(value, query),
    ),
    get: query => readConstructionContractHttp(
      () => options.fetcher(`/api/read/construction-contracts/${encodeURIComponent(query.id)}`, { query: serializeConstructionContractDetailQuery(query) }),
      value => decodeConstructionContractDetailRead(value, query),
    ),
    fileContent: (id, fileId, origin, request) => readConstructionContractHttp(
      () => options.fetcher(`/api/read/construction-contracts/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`, { query: { origin }, signal: request?.signal }),
      value => decodeContractOriginalContent(value, { ownerId: id, fileId, origin }, () => { throw new ConstructionContractRepositoryProblem({ code: 'validation-failed', message: '施工合同原件正文或所属记录不一致', retryable: false, fieldErrors: {}, traceId: null }) }),
    ),
  }
}
