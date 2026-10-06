import type { ProblemDTO } from '../../types/read-model'
import type { SubcontractContractReadRepository } from './read-contract'
import { decodeContractOriginalContent } from '../forms/original-content'
import { problemFromHttpFailure } from '../read-model/problem'
import { SubcontractContractRepositoryProblem } from './read-contract'
import {
  decodeSubcontractContractDetailRead,
  decodeSubcontractContractListPage,
  serializeSubcontractContractDetailQuery,
  serializeSubcontractContractListQuery,
  subcontractContractUnavailable,
} from './read-decoder'

export interface SubcontractContractHttpFetchOptions {
  signal?: AbortSignal
  method?: 'GET' | 'POST' | 'PUT'
  query?: Record<string, unknown>
  body?: Record<string, any>
}

export type SubcontractContractHttpFetcher = (
  url: string,
  options?: SubcontractContractHttpFetchOptions,
) => Promise<unknown>

function problemPayload(cause: unknown): ProblemDTO | null {
  return problemFromHttpFailure(cause)
}

export async function readSubcontractContractHttp<T>(request: () => Promise<unknown>, decode: (value: unknown) => T | Promise<T>): Promise<T> {
  try {
    return await decode(await request())
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
      value => decodeSubcontractContractListPage(value, query),
    ),
    get: query => readSubcontractContractHttp(
      () => options.fetcher(`/api/read/subcontract-contracts/${encodeURIComponent(query.id)}`, { query: serializeSubcontractContractDetailQuery(query) }),
      value => decodeSubcontractContractDetailRead(value, query),
    ),
    fileContent: (id, fileId, origin, request) => readSubcontractContractHttp(
      () => options.fetcher(`/api/read/subcontract-contracts/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`, { query: { origin }, signal: request?.signal }),
      value => decodeContractOriginalContent(value, { ownerId: id, fileId, origin }, () => { throw new SubcontractContractRepositoryProblem({ code: 'validation-failed', message: '分包合同原件正文或所属记录不一致', retryable: false, fieldErrors: {}, traceId: null }) }),
    ),
  }
}
