import type { ProblemDTO } from '../../types/read-model'
import type { CrewWorkerReadRepository } from './repository'
import { problemFromHttpFailure } from '../read-model/problem'
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

function problemPayload(cause: unknown): ProblemDTO | null {
  return problemFromHttpFailure(cause)
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
      value => decodeCrewListPage(value, query),
    ),
    getCrew: query => readCrewWorkerHttp(
      () => options.fetcher(`/api/read/crews/${encodeURIComponent(query.id)}`, { query: serializeCrewWorkerDetailQuery(query) }),
      value => decodeCrewDetailRead(value, query),
    ),
    listWorkers: query => readCrewWorkerHttp(
      () => options.fetcher('/api/read/workers', { query: serializeWorkerListQuery(query) }),
      value => decodeWorkerListPage(value, query),
    ),
    getWorker: query => readCrewWorkerHttp(
      () => options.fetcher(`/api/read/workers/${encodeURIComponent(query.id)}`, { query: serializeCrewWorkerDetailQuery(query) }),
      value => decodeWorkerDetailRead(value, query),
    ),
    getRelationFactIdentity: query => readCrewWorkerHttp(
      () => options.fetcher(`/api/read/crew-worker-facts/${encodeURIComponent(query.kind)}/${encodeURIComponent(query.id)}`, { query: serializeCrewWorkerRelationFactQuery(query) }),
      value => decodeCrewWorkerRelationFactIdentity(value, query),
    ),
  }
}
