import type { CustomerCommandRepository } from '~/lib/customer/command-contract'
import type { CustomerReadRepository } from '~/lib/customer/repository'
import type { CoreMigrationRepository } from '~/lib/migration/core-http-repository'
import type { ProjectCommandRepository } from '~/lib/project/command-contract'
import type { ProjectListRepository } from '~/lib/project/repository'
import { createHttpCustomerCommandRepository } from '~/lib/customer/command-http-repository'
import { createHttpCustomerReadRepository } from '~/lib/customer/http-repository'
import { createHttpCoreMigrationRepository } from '~/lib/migration/core-http-repository'
import { createHttpProjectCommandRepository } from '~/lib/project/command-http-repository'
import { createHttpProjectListRepository } from '~/lib/project/http-repository'

export interface DomainRepositories {
  customerRead: CustomerReadRepository
  customerCommands: CustomerCommandRepository
  projectList: ProjectListRepository
  projectCommands: ProjectCommandRepository
  coreMigration: CoreMigrationRepository
}

export default defineNuxtPlugin(() => {
  const repositories: DomainRepositories = {
    customerRead: createHttpCustomerReadRepository({
      fetcher: (url, options) => $fetch(url, options),
    }),
    customerCommands: createHttpCustomerCommandRepository({
      fetcher: (url, options) => $fetch(url, options),
    }),
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
