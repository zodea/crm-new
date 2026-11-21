import type { RepositoryFetch } from '../deferred'
import { createScheduleRepository } from '~/lib/schedule/central-repository'
import { createProcessLibraryRepository } from '~/lib/schedule/process-library-repository'

export function createScheduleRepositories(repositoryFetch: RepositoryFetch) {
  return {
    schedule: createScheduleRepository(repositoryFetch),
    processLibraries: createProcessLibraryRepository(repositoryFetch),
  }
}
