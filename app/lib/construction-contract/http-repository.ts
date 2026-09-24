import type { ProblemDTO } from '../../types/read-model'
import type {
  ConstructionContractReadRepository,
} from './read-contract'
import { isProblemCodeDTO } from '../../types/read-model'
import { ConstructionContractRepositoryProblem } from './read-contract'
import {
  constructionContractProblemFromUnknown,
  decodeConstructionContractDetailRead,
  decodeConstructionContractListPage,
  serializeConstructionContractDetailQuery,
  serializeConstructionContractListQuery,
} from './read-decoder'

export interface ConstructionContractHttpFetchOptions {
  method?: 'GET' | 'POST' | 'PUT'
  query?: Record<string, unknown>
  body?: Record<string, any>
}

export type ConstructionContractHttpFetcher = (
  url: string,
  options?: ConstructionContractHttpFetchOptions,
) => Promise<unknown>

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

export async function readConstructionContractHttp<T>(request: () => Promise<unknown>, decode: (value: unknown) => T): Promise<T> {
  try {
    return decode(await request())
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
      decodeConstructionContractListPage,
    ),
    get: query => readConstructionContractHttp(
      () => options.fetcher(`/api/read/construction-contracts/${encodeURIComponent(query.id)}`, { query: serializeConstructionContractDetailQuery(query) }),
      decodeConstructionContractDetailRead,
    ),
  }
}
