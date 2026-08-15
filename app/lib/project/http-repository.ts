import type { ProblemDTO } from '../../types/read-model'
import type {
  ProjectDetailQueryDTO,
  ProjectDetailReadDTO,
  ProjectListPageDTO,
  ProjectListQueryDTO,
  ProjectListRepository,
} from './repository'
import { isProblemCodeDTO } from '../../types/read-model'
import {
  decodeProjectDetailRead,
  decodeProjectListPage,
  projectProblemFromUnknown,
  ProjectRepositoryProblem,
  serializeProjectDetailQuery,
  serializeProjectListQuery,
} from './repository'

export interface ProjectHttpFetchOptions {
  query?: Record<string, unknown>
}

export type ProjectHttpFetcher = (
  url: string,
  options?: ProjectHttpFetchOptions,
) => Promise<unknown>

interface HttpProjectRepositoryOptions {
  fetcher: ProjectHttpFetcher
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFieldErrors(value: unknown): value is Record<string, string[]> {
  return isObject(value)
    && Object.values(value).every(errors =>
      Array.isArray(errors) && errors.every(error => typeof error === 'string'),
    )
}

function problemPayload(cause: unknown): ProblemDTO | null {
  if (!isObject(cause))
    return null
  const response = isObject(cause.response) ? cause.response : null
  const raw = response?._data ?? cause.data
  if (!isObject(raw))
    return null
  const candidate = isObject(raw.data) ? raw.data : raw
  if (!isProblemCodeDTO(candidate.code)
    || typeof candidate.message !== 'string'
    || typeof candidate.retryable !== 'boolean'
    || !isFieldErrors(candidate.fieldErrors)
    || !(candidate.traceId === null || typeof candidate.traceId === 'string')) {
    return null
  }
  return candidate as unknown as ProblemDTO
}

async function readHttp<T>(
  request: () => Promise<unknown>,
  decode: (value: unknown) => T,
): Promise<T> {
  try {
    return decode(await request())
  }
  catch (cause) {
    if (cause instanceof ProjectRepositoryProblem)
      throw cause
    const remoteProblem = problemPayload(cause)
    if (remoteProblem)
      throw new ProjectRepositoryProblem(remoteProblem, { cause })
    throw projectProblemFromUnknown(cause)
  }
}

export function createHttpProjectListRepository(
  options: HttpProjectRepositoryOptions,
): ProjectListRepository {
  return {
    async list(query: ProjectListQueryDTO): Promise<ProjectListPageDTO> {
      return readHttp(
        () => options.fetcher('/api/read/projects', {
          query: serializeProjectListQuery(query),
        }),
        decodeProjectListPage,
      )
    },
    async get(query: ProjectDetailQueryDTO): Promise<ProjectDetailReadDTO> {
      return readHttp(
        () => options.fetcher(`/api/read/projects/${encodeURIComponent(query.id)}`, {
          query: serializeProjectDetailQuery(query),
        }),
        decodeProjectDetailRead,
      )
    },
  }
}
