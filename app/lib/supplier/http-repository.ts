import type {
  SupplierDetailQueryDTO,
  SupplierListQueryDTO,
  SupplierReadRepository,
} from './repository'
import { supplierProblem } from './read-contract'
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

export async function readSupplierHttp<T>(request: () => Promise<unknown>, decode: (value: unknown) => T): Promise<T> {
  try {
    return decode(await request())
  }
  catch (cause) {
    if (cause instanceof SupplierRepositoryProblem)
      throw cause
    throw supplierProblemFromUnknown(cause)
  }
}

export function createHttpSupplierReadRepository(options: { fetcher: SupplierHttpFetcher }): SupplierReadRepository {
  return {
    list: (query: SupplierListQueryDTO) => readSupplierHttp(
      () => options.fetcher('/api/read/suppliers', { query: serializeSupplierListQuery(query) }),
      (value) => {
        const page = decodeSupplierListPage(value)
        if (page.pagination.requestedPage !== query.page || page.pagination.pageSize !== query.pageSize
          || (!query.includeDemo && (page.items.some(item => item.dataOrigin === 'demo') || page.summary.origins.demo.supplierCount > 0))) {
          throw new SupplierRepositoryProblem(supplierProblem('relationship-mismatch', '分供方列表响应与当前查询不一致'))
        }
        return page
      },
    ),
    get: (query: SupplierDetailQueryDTO) => readSupplierHttp(
      () => options.fetcher(`/api/read/suppliers/${encodeURIComponent(query.id)}`, { query: serializeSupplierDetailQuery(query) }),
      (value) => {
        const detail = decodeSupplierDetailRead(value)
        if (detail.supplier.id !== query.id || detail.dataOrigin !== query.origin)
          throw new SupplierRepositoryProblem(supplierProblem('relationship-mismatch', '分供方详情响应与当前目标或来源不一致'))
        return detail
      },
    ),
  }
}
