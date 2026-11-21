import type { RepositoryFetch } from '../deferred'
import { createPayrollRepository } from '~/lib/payroll/central-repository'
import { createWorkerRosterRepository } from '~/lib/worker-roster/repository'

export function createPayrollRepositories(repositoryFetch: RepositoryFetch) {
  return {
    payroll: createPayrollRepository(repositoryFetch),
    workerRoster: createWorkerRosterRepository((url, options) => repositoryFetch(url, { ...options, body: options?.body as Record<string, unknown> | undefined })),
  }
}
