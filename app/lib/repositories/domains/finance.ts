import type { RepositoryFetch } from '../deferred'
import { createFinanceRepository } from '~/lib/finance/http-repository'
import { createReceiptRepository } from '~/lib/receipt/repository'

export function createFinanceRepositories(repositoryFetch: RepositoryFetch) {
  return {
    finance: createFinanceRepository((url, options) => repositoryFetch(url, { ...options, retry: 0 })),
    receipts: createReceiptRepository(repositoryFetch),
  }
}
