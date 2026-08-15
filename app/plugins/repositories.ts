import type { CoreMigrationRepository } from '~/lib/migration/core-http-repository'
import type { ProjectCommandRepository } from '~/lib/project/command-contract'
import type { ProjectListRepository } from '~/lib/project/repository'
import { createHttpCoreMigrationRepository } from '~/lib/migration/core-http-repository'
import { createHttpProjectCommandRepository } from '~/lib/project/command-http-repository'
import { createHttpProjectListRepository } from '~/lib/project/http-repository'

export interface DomainRepositories {
  projectList: ProjectListRepository
  projectCommands: ProjectCommandRepository
  coreMigration: CoreMigrationRepository
}

export default defineNuxtPlugin(() => {
  const repositories: DomainRepositories = {
    projectList: createHttpProjectListRepository({
      fetcher: (url, options) => $fetch(url, options),
    }),
    projectCommands: createHttpProjectCommandRepository({
      fetcher: (url, options) => $fetch(url, options),
    }),
    coreMigration: createHttpCoreMigrationRepository({
      fetcher: (url, options) => $fetch(url, options),
    }),
  }
  return { provide: { repositories } }
})

declare module '#app' {
  interface NuxtApp {
    $repositories: DomainRepositories
  }
}
