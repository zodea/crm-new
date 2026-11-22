import type { RepositoryFetch, RepositoryFileFetch } from '../deferred'
import { createHttpCrewWorkerCommandRepository } from '~/lib/crew-worker/command-http-repository'
import { createHttpCrewWorkerReadRepository } from '~/lib/crew-worker/http-repository'
import { createHttpCustomerCommandRepository } from '~/lib/customer/command-http-repository'
import { createHttpCustomerReadRepository } from '~/lib/customer/http-repository'
import { createCustomerProductionRepository } from '~/lib/customer/production-repository'
import { createHttpSupplierCommandRepository } from '~/lib/supplier/command-http-repository'
import { createSupplierCredentialRepository } from '~/lib/supplier/credential-repository'
import { createHttpSupplierReadRepository } from '~/lib/supplier/http-repository'
import { createSupplierProductionRepository } from '~/lib/supplier/production-repository'

export function createMasterDataRepositories(repositoryFetch: RepositoryFetch, repositoryFileFetch: RepositoryFileFetch) {
  return {
    customerRead: createHttpCustomerReadRepository({ fetcher: repositoryFetch }),
    customerCommands: createHttpCustomerCommandRepository({ fetcher: repositoryFetch }),
    customerProduction: createCustomerProductionRepository(repositoryFetch, url => repositoryFileFetch(url, { responseType: 'blob' })),
    crewWorkerRead: createHttpCrewWorkerReadRepository({ fetcher: repositoryFetch }),
    crewWorkerCommands: createHttpCrewWorkerCommandRepository({ fetcher: repositoryFetch }),
    supplierRead: createHttpSupplierReadRepository({ fetcher: repositoryFetch }),
    supplierCommands: createHttpSupplierCommandRepository({ fetcher: repositoryFetch }),
    supplierCredentials: createSupplierCredentialRepository(repositoryFetch),
    supplierProduction: createSupplierProductionRepository(repositoryFetch),
  }
}
