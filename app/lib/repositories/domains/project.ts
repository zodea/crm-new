import type { RepositoryFetch, RepositoryFileFetch } from '../deferred'
import { createHttpProjectSupplierCommandRepository } from '~/lib/project-supplier/command-http-repository'
import { createHttpProjectSupplierReadRepository } from '~/lib/project-supplier/http-repository'
import { createHttpProjectCommandRepository } from '~/lib/project/command-http-repository'
import { createHttpProjectListRepository } from '~/lib/project/http-repository'
import { createProjectProductionRepository } from '~/lib/project/production-repository'

export function createProjectRepositories(repositoryFetch: RepositoryFetch, repositoryFileFetch: RepositoryFileFetch) {
  return {
    projectList: createHttpProjectListRepository({ fetcher: repositoryFetch }),
    projectCommands: createHttpProjectCommandRepository({ fetcher: repositoryFetch }),
    projectProduction: createProjectProductionRepository(repositoryFetch, url => repositoryFileFetch(url, { responseType: 'blob' })),
    projectSupplierRead: createHttpProjectSupplierReadRepository({ fetcher: repositoryFetch }),
    projectSupplierCommands: createHttpProjectSupplierCommandRepository({ fetcher: repositoryFetch }),
  }
}
