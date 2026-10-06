import type { ProblemDTO } from '../../types/read-model'
import type {
  ProjectDetailQueryDTO,
  ProjectDetailReadDTO,
  ProjectListPageDTO,
  ProjectListQueryDTO,
  ProjectListRepository,
} from './repository'
import { commandProblemFromHttpFailure, problemFromHttpFailure } from '../read-model/problem'
import {
  decodeProjectDetailRead,
  decodeProjectListPage,
  projectProblem,
  projectProblemFromUnknown,
  ProjectRepositoryProblem,
  serializeProjectDetailQuery,
  serializeProjectListQuery,
} from './repository'

export interface ProjectHttpFetchOptions {
  method?: 'GET' | 'POST' | 'PUT'
  query?: Record<string, unknown>
  body?: Record<string, any>
}

export type ProjectHttpFetcher = (
  url: string,
  options?: ProjectHttpFetchOptions,
) => Promise<unknown>

interface HttpProjectRepositoryOptions {
  fetcher: ProjectHttpFetcher
}

function problemPayload(cause: unknown): ProblemDTO | null {
  return problemFromHttpFailure(cause)
}

export async function readProjectHttp<T>(
  request: () => Promise<unknown>,
  decode: (value: unknown) => T,
  commandId?: string,
): Promise<T> {
  try {
    return decode(await request())
  }
  catch (cause) {
    if (cause instanceof ProjectRepositoryProblem)
      throw cause
    const remoteProblem = commandId ? commandProblemFromHttpFailure(cause, commandId) : problemPayload(cause)
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
      return readProjectHttp(
        () => options.fetcher('/api/read/projects', {
          query: serializeProjectListQuery(query),
        }),
        (value) => {
          const page = decodeProjectListPage(value)
          if (page.pagination.requestedPage !== query.page || page.pagination.pageSize !== query.pageSize
            || (!query.includeDemo && page.items.some(item => item.dataOrigin === 'demo'))) {
            throw new ProjectRepositoryProblem(projectProblem('relationship-mismatch', '项目响应与本次分页或来源不匹配'))
          }
          return page
        },
      )
    },
    async get(query: ProjectDetailQueryDTO): Promise<ProjectDetailReadDTO> {
      return readProjectHttp(
        () => options.fetcher(`/api/read/projects/${encodeURIComponent(query.id)}`, {
          query: serializeProjectDetailQuery(query),
        }),
        (value) => {
          const detail = decodeProjectDetailRead(value)
          if (detail.item.project.id !== query.id || detail.item.dataOrigin !== query.origin)
            throw new ProjectRepositoryProblem(projectProblem('relationship-mismatch', '项目响应与本次目标或来源不匹配'))
          return detail
        },
      )
    },
  }
}
