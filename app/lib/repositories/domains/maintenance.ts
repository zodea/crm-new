import type { RepositoryFetch } from '../deferred'
import { createHttpCoreMigrationRepository } from '~/lib/migration/core-http-repository'
import { createProductionBackupRepository } from '~/lib/production/backup-repository'

export function createMaintenanceRepositories(repositoryFetch: RepositoryFetch) {
  return {
    coreMigration: createHttpCoreMigrationRepository({ fetcher: repositoryFetch }),
    productionBackup: createProductionBackupRepository((url, options) => repositoryFetch(url, { ...options, timeout: options ? 120_000 : 10_000, retry: 0 })),
  }
}
