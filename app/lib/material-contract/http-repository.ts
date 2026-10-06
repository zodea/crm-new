import type { DataOriginDTO } from '../../types/read-model'
import type {
  MaterialContractDetailQueryDTO,
  MaterialContractListQueryDTO,
  MaterialContractReadRepository,
} from './read-contract'
import { decodeContractOriginalContent } from '../forms/original-content'
import { problemFromHttpFailure } from '../read-model/problem'
import { decodeContractPriceRead } from './price-facts'
import { materialContractProblem, MaterialContractRepositoryProblem } from './read-contract'
import {
  decodeMaterialContractDetailRead,
  decodeMaterialContractListPage,
  materialContractProblemFromUnknown,
  serializeMaterialContractDetailQuery,
  serializeMaterialContractListQuery,
} from './read-decoder'

export interface MaterialContractHttpFetchOptions {
  method?: 'GET' | 'POST' | 'PUT'
  signal?: AbortSignal
  query?: Record<string, unknown>
  body?: Record<string, any>
}

export type MaterialContractHttpFetcher = (
  url: string,
  options?: MaterialContractHttpFetchOptions,
) => Promise<unknown>

export async function readMaterialContractHttp<T>(
  request: () => Promise<unknown>,
  decode: (value: unknown) => T | Promise<T>,
): Promise<T> {
  try {
    return await decode(await request())
  }
  catch (cause) {
    if (cause instanceof MaterialContractRepositoryProblem)
      throw cause
    const remote = problemFromHttpFailure(cause)
    if (remote)
      throw new MaterialContractRepositoryProblem(remote, { cause })
    throw materialContractProblemFromUnknown(cause)
  }
}

export function createHttpMaterialContractReadRepository(
  options: { fetcher: MaterialContractHttpFetcher },
): MaterialContractReadRepository {
  return {
    prices: (origin, requestOptions = {}) => readMaterialContractHttp(
      () => options.fetcher('/api/read/material-contracts/prices', { query: { origin }, signal: requestOptions.signal }),
      value => decodeContractPriceRead(value, origin),
    ),
    fileContent: (ownerId: string, fileId: string, origin: DataOriginDTO, requestOptions: { signal?: AbortSignal } = {}) => readMaterialContractHttp(
      () => options.fetcher(`/api/read/material-contracts/${encodeURIComponent(ownerId)}/files/${encodeURIComponent(fileId)}`, { query: { origin }, signal: requestOptions.signal }),
      value => decodeContractOriginalContent(value, { ownerId, fileId, origin }, () => { throw new MaterialContractRepositoryProblem({ code: 'internal-error', message: '中央材采原件身份、正文或摘要无效', retryable: false, fieldErrors: {}, traceId: null }) }),
    ),
    list: (query: MaterialContractListQueryDTO) => readMaterialContractHttp(
      () => options.fetcher('/api/read/material-contracts', {
        query: serializeMaterialContractListQuery(query),
      }),
      (value) => {
        const page = decodeMaterialContractListPage(value)
        if (page.pagination.requestedPage !== query.page || page.pagination.pageSize !== query.pageSize)
          throw new MaterialContractRepositoryProblem(materialContractProblem('internal-error', '材采列表响应与本次分页请求不一致'))
        return page
      },
    ),
    get: (query: MaterialContractDetailQueryDTO) => readMaterialContractHttp(
      () => options.fetcher(`/api/read/material-contracts/${encodeURIComponent(query.id)}`, {
        query: serializeMaterialContractDetailQuery(query),
      }),
      (value) => {
        const detail = decodeMaterialContractDetailRead(value)
        if (detail.contract.id !== query.id || detail.dataOrigin !== query.origin
          || (query.supplementId && !detail.sections.supplements?.some(row => row.id === query.supplementId && row.contractId === query.id))) {
          throw new MaterialContractRepositoryProblem(materialContractProblem('relationship-mismatch', '材采详情响应与本次合同、来源或协议请求不一致'))
        }
        return detail
      },
    ),
  }
}
