import type { RepositoryFetch } from '../deferred'
import { createProductionAccessRepository } from '~/lib/customer/access-repository'
import { createNotificationRepository } from '~/lib/notifications/repository'

export function createShellRepositories(repositoryFetch: RepositoryFetch) {
  return {
    notifications: createNotificationRepository((url, options) => repositoryFetch(url, { ...options, retry: 0 })),
    productionAccess: createProductionAccessRepository((url, options) => repositoryFetch(url, { ...options, timeout: 10_000, retry: 0 })),
  }
}
