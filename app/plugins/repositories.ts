import type { ProjectListRepository } from '~/lib/project/repository'
import { createHttpProjectListRepository } from '~/lib/project/http-repository'

export interface DomainRepositories {
  projectList: ProjectListRepository
}

export default defineNuxtPlugin(() => {
  const repositories: DomainRepositories = {
    projectList: createHttpProjectListRepository({
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
