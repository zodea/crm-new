import type { ProblemDTO } from '../../types/read-model'
import type { CrewWorkerReadRepository } from './repository'
import { isProblemCodeDTO } from '../../types/read-model'
import {
  decodeCrewDetailRead,
  decodeCrewListPage,
  decodeCrewWorkerRelationFactIdentity,
  decodeWorkerDetailRead,
  decodeWorkerListPage,
  serializeCrewListQuery,
  serializeCrewWorkerDetailQuery,
  serializeCrewWorkerRelationFactQuery,
  serializeWorkerListQuery,
} from './read-decoder'
import { CrewWorkerRepositoryProblem } from './repository'

export interface CrewWorkerHttpFetchOptions {
  method?: 'GET' | 'POST' | 'PUT'
  query?: Record<string, unknown>
  body?: Record<string, any>
}

export type CrewWorkerHttpFetcher = (url: string, options?: CrewWorkerHttpFetchOptions) => Promise<unknown>

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

export async function readCrewWorkerHttp<T>(request: () => Promise<unknown>, decode: (value: unknown) => T): Promise<T> {
  try {
    return decode(await request())
  }
  catch (cause) {
    if (cause instanceof CrewWorkerRepositoryProblem)
      throw cause
    const remote = problemPayload(cause)
    if (remote)
      throw new CrewWorkerRepositoryProblem(remote, { cause })
    throw cause
  }
}

export function createHttpCrewWorkerReadRepository(options: { fetcher: CrewWorkerHttpFetcher }): CrewWorkerReadRepository {
  return {
    listCrews: query => readCrewWorkerHttp(
      () => options.fetcher('/api/read/crews', { query: serializeCrewListQuery(query) }),
      decodeCrewListPage,
    ),
    getCrew: query => readCrewWorkerHttp(
      () => options.fetcher(`/api/read/crews/${encodeURIComponent(query.id)}`, { query: serializeCrewWorkerDetailQuery(query) }),
      decodeCrewDetailRead,
    ),
    listWorkers: query => readCrewWorkerHttp(
      () => options.fetcher('/api/read/workers', { query: serializeWorkerListQuery(query) }),
      decodeWorkerListPage,
    ),
    getWorker: query => readCrewWorkerHttp(
      () => options.fetcher(`/api/read/workers/${encodeURIComponent(query.id)}`, { query: serializeCrewWorkerDetailQuery(query) }),
      decodeWorkerDetailRead,
    ),
    getRelationFactIdentity: query => readCrewWorkerHttp(
      () => options.fetcher(`/api/read/crew-worker-facts/${encodeURIComponent(query.kind)}/${encodeURIComponent(query.id)}`, { query: serializeCrewWorkerRelationFactQuery(query) }),
      decodeCrewWorkerRelationFactIdentity,
    ),
  }
}
