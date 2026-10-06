import type { ProblemDTO } from '../../types/read-model'
import type {
  CustomerDetailQueryDTO,
  CustomerListQueryDTO,
  CustomerReadRepository,
  CustomerReceiptDetailQueryDTO,
} from './repository'
import { problemFromHttpFailure } from '../read-model/problem'
import {
  customerProblem,
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

function problemPayload(cause: unknown): ProblemDTO | null {
  return problemFromHttpFailure(cause)
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
      (value) => {
        const page = decodeCustomerListPage(value)
        if (page.pagination.requestedPage !== query.page || page.pagination.pageSize !== query.pageSize
          || (!query.includeDemo && page.items.some(item => item.dataOrigin === 'demo'))) {
          throw new CustomerRepositoryProblem(customerProblem('relationship-mismatch', '客户响应与本次分页或来源不匹配'))
        }
        return page
      },
    ),
    get: (query: CustomerDetailQueryDTO) => readCustomerHttp(
      () => options.fetcher(`/api/read/customers/${encodeURIComponent(query.id)}`, { query: serializeCustomerDetailQuery(query) }),
      (value) => {
        const detail = decodeCustomerDetailRead(value)
        if (detail.customer.id !== query.id || detail.dataOrigin !== query.origin)
          throw new CustomerRepositoryProblem(customerProblem('relationship-mismatch', '客户响应与本次目标或来源不匹配'))
        return detail
      },
    ),
    getReceipt: (query: CustomerReceiptDetailQueryDTO) => readCustomerHttp(
      () => options.fetcher(`/api/read/receipts/${encodeURIComponent(query.id)}`, { query: serializeCustomerReceiptDetailQuery(query) }),
      (value) => {
        const detail = decodeCustomerReceiptDetailRead(value)
        if (detail.receipt.receipt.id !== query.id || detail.customer.id !== query.customerId || detail.dataOrigin !== query.origin)
          throw new CustomerRepositoryProblem(customerProblem('relationship-mismatch', '收款响应与本次目标、父客户或来源不匹配'))
        return detail
      },
    ),
  }
}
