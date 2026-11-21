import type { RepositoryFetch } from '../deferred'
import { createDeliveryRepository } from '~/lib/delivery-record/repository'
import { createQuotationHttpRepository } from '~/lib/material-quotation/http-repository'

export function createMaterialRepositories(repositoryFetch: RepositoryFetch) {
  return {
    materialQuotations: createQuotationHttpRepository((url, options) => repositoryFetch(url, { ...options, retry: 0 })),
    deliveries: createDeliveryRepository(repositoryFetch),
  }
}
