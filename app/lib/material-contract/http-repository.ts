import type { ProblemDTO } from '../../types/read-model'
import type {
  MaterialContractDetailQueryDTO,
  MaterialContractListQueryDTO,
  MaterialContractReadRepository,
} from './read-contract'
import { isProblemCodeDTO } from '../../types/read-model'
import { MaterialContractRepositoryProblem } from './read-contract'
import {
  decodeMaterialContractDetailRead,
  decodeMaterialContractListPage,
  materialContractProblemFromUnknown,
  serializeMaterialContractDetailQuery,
  serializeMaterialContractListQuery,
} from './read-decoder'

export interface MaterialContractHttpFetchOptions {
  method?: 'GET' | 'POST' | 'PUT'
  query?: Record<string, unknown>
  body?: Record<string, any>
}

export type MaterialContractHttpFetcher = (
  url: string,
  options?: MaterialContractHttpFetchOptions,
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
  if (!object(candidate)
    || !isProblemCodeDTO(candidate.code)
    || typeof candidate.message !== 'string'
    || typeof candidate.retryable !== 'boolean'
    || !object(candidate.fieldErrors)
    || !(candidate.traceId === null || typeof candidate.traceId === 'string')) {
    return null
  }
  return candidate as unknown as ProblemDTO
}

export async function readMaterialContractHttp<T>(
  request: () => Promise<unknown>,
  decode: (value: unknown) => T,
): Promise<T> {
  try {
    return decode(await request())
  }
  catch (cause) {
    if (cause instanceof MaterialContractRepositoryProblem)
      throw cause
    const remote = problemPayload(cause)
    if (remote)
      throw new MaterialContractRepositoryProblem(remote, { cause })
    throw materialContractProblemFromUnknown(cause)
  }
}

export function createHttpMaterialContractReadRepository(
  options: { fetcher: MaterialContractHttpFetcher },
): MaterialContractReadRepository {
  return {
    list: (query: MaterialContractListQueryDTO) => readMaterialContractHttp(
      () => options.fetcher('/api/read/material-contracts', {
        query: serializeMaterialContractListQuery(query),
      }),
      decodeMaterialContractListPage,
    ),
    get: (query: MaterialContractDetailQueryDTO) => readMaterialContractHttp(
      () => options.fetcher(`/api/read/material-contracts/${encodeURIComponent(query.id)}`, {
        query: serializeMaterialContractDetailQuery(query),
      }),
      decodeMaterialContractDetailRead,
    ),
  }
}
