import type { ProblemDTO } from '../../types/read-model'
import type {
  SupplierDetailQueryDTO,
  SupplierListQueryDTO,
  SupplierReadRepository,
} from './repository'
import { isProblemCodeDTO } from '../../types/read-model'
import {
  decodeSupplierDetailRead,
  decodeSupplierListPage,
  serializeSupplierDetailQuery,
  serializeSupplierListQuery,
  supplierProblemFromUnknown,
} from './read-decoder'
import { SupplierRepositoryProblem } from './repository'

export interface SupplierHttpFetchOptions {
  method?: 'GET' | 'POST' | 'PUT'
  query?: Record<string, unknown>
  body?: Record<string, any>
}

export type SupplierHttpFetcher = (url: string, options?: SupplierHttpFetchOptions) => Promise<unknown>

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

export async function readSupplierHttp<T>(request: () => Promise<unknown>, decode: (value: unknown) => T): Promise<T> {
  try {
    return decode(await request())
  }
  catch (cause) {
    if (cause instanceof SupplierRepositoryProblem)
      throw cause
    const remote = problemPayload(cause)
    if (remote)
      throw new SupplierRepositoryProblem(remote, { cause })
    throw supplierProblemFromUnknown(cause)
  }
}

export function createHttpSupplierReadRepository(options: { fetcher: SupplierHttpFetcher }): SupplierReadRepository {
  return {
    list: (query: SupplierListQueryDTO) => readSupplierHttp(
      () => options.fetcher('/api/read/suppliers', { query: serializeSupplierListQuery(query) }),
      decodeSupplierListPage,
    ),
    get: (query: SupplierDetailQueryDTO) => readSupplierHttp(
      () => options.fetcher(`/api/read/suppliers/${encodeURIComponent(query.id)}`, { query: serializeSupplierDetailQuery(query) }),
      decodeSupplierDetailRead,
    ),
  }
}
