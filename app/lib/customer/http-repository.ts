import type { ProblemDTO } from '../../types/read-model'
import type {
  CustomerDetailQueryDTO,
  CustomerListQueryDTO,
  CustomerReadRepository,
  CustomerReceiptDetailQueryDTO,
} from './repository'
import { isProblemCodeDTO } from '../../types/read-model'
import {
  customerProblemFromUnknown,
  CustomerRepositoryProblem,
  decodeCustomerDetailRead,
  decodeCustomerListPage,
  decodeCustomerReceiptDetailRead,
  serializeCustomerDetailQuery,
  serializeCustomerListQuery,
  serializeCustomerReceiptDetailQuery,
} from './repository'

export interface CustomerHttpFetchOptions {
  method?: 'GET' | 'POST' | 'PUT'
  query?: Record<string, unknown>
  body?: Record<string, any>
}

export type CustomerHttpFetcher = (url: string, options?: CustomerHttpFetchOptions) => Promise<unknown>

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

export async function readCustomerHttp<T>(request: () => Promise<unknown>, decode: (value: unknown) => T): Promise<T> {
  try {
    return decode(await request())
  }
  catch (cause) {
    if (cause instanceof CustomerRepositoryProblem)
      throw cause
    const remote = problemPayload(cause)
    if (remote)
      throw new CustomerRepositoryProblem(remote, { cause })
    throw customerProblemFromUnknown(cause)
  }
}

export function createHttpCustomerReadRepository(options: { fetcher: CustomerHttpFetcher }): CustomerReadRepository {
  return {
    list: (query: CustomerListQueryDTO) => readCustomerHttp(
      () => options.fetcher('/api/read/customers', { query: serializeCustomerListQuery(query) }),
      decodeCustomerListPage,
    ),
    get: (query: CustomerDetailQueryDTO) => readCustomerHttp(
      () => options.fetcher(`/api/read/customers/${encodeURIComponent(query.id)}`, { query: serializeCustomerDetailQuery(query) }),
      decodeCustomerDetailRead,
    ),
    getReceipt: (query: CustomerReceiptDetailQueryDTO) => readCustomerHttp(
      () => options.fetcher(`/api/read/receipts/${encodeURIComponent(query.id)}`, { query: serializeCustomerReceiptDetailQuery(query) }),
      decodeCustomerReceiptDetailRead,
    ),
  }
}
