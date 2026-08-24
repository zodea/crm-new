import type { ProblemDTO } from '../../types/read-model'
import type { SubcontractContractReadRepository } from './read-contract'
import { isProblemCodeDTO } from '../../types/read-model'
import { SubcontractContractRepositoryProblem } from './read-contract'
import {
  decodeSubcontractContractDetailRead,
  decodeSubcontractContractListPage,
  serializeSubcontractContractDetailQuery,
  serializeSubcontractContractListQuery,
  subcontractContractUnavailable,
} from './read-decoder'

export interface SubcontractContractHttpFetchOptions {
  method?: 'GET' | 'POST' | 'PUT'
  query?: Record<string, unknown>
  body?: Record<string, any>
}

export type SubcontractContractHttpFetcher = (
  url: string,
  options?: SubcontractContractHttpFetchOptions,
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

export async function readSubcontractContractHttp<T>(request: () => Promise<unknown>, decode: (value: unknown) => T): Promise<T> {
  try {
    return decode(await request())
  }
  catch (cause) {
    if (cause instanceof SubcontractContractRepositoryProblem)
      throw cause
    const remote = problemPayload(cause)
    if (remote)
      throw new SubcontractContractRepositoryProblem(remote, { cause })
    throw subcontractContractUnavailable(cause)
  }
}

export function createHttpSubcontractContractReadRepository(
  options: { fetcher: SubcontractContractHttpFetcher },
): SubcontractContractReadRepository {
  return {
    list: query => readSubcontractContractHttp(
      () => options.fetcher('/api/read/subcontract-contracts', { query: serializeSubcontractContractListQuery(query) }),
      decodeSubcontractContractListPage,
    ),
    get: query => readSubcontractContractHttp(
      () => options.fetcher(`/api/read/subcontract-contracts/${encodeURIComponent(query.id)}`, { query: serializeSubcontractContractDetailQuery(query) }),
      decodeSubcontractContractDetailRead,
    ),
  }
}
