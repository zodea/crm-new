import type { RepositoryFetch } from '../deferred'
import { createAuxiliaryContractRepository } from '~/lib/auxiliary-contract/repository'
import { createHttpConstructionContractCommandRepository } from '~/lib/construction-contract/command-http-repository'
import { createHttpConstructionContractReadRepository } from '~/lib/construction-contract/http-repository'
import { createHttpMaterialContractCommandRepository } from '~/lib/material-contract/command-http-repository'
import { createHttpMaterialContractReadRepository } from '~/lib/material-contract/http-repository'
import { createHttpSubcontractContractCommandRepository } from '~/lib/subcontract-contract/command-http-repository'
import { createHttpSubcontractContractReadRepository } from '~/lib/subcontract-contract/http-repository'

export function createContractsRepositories(repositoryFetch: RepositoryFetch) {
  return {
    auxiliaryContracts: createAuxiliaryContractRepository(repositoryFetch),
    constructionContractRead: createHttpConstructionContractReadRepository({ fetcher: repositoryFetch }),
    constructionContractCommands: createHttpConstructionContractCommandRepository({ fetcher: repositoryFetch }),
    subcontractContractRead: createHttpSubcontractContractReadRepository({ fetcher: repositoryFetch }),
    subcontractContractCommands: createHttpSubcontractContractCommandRepository({ fetcher: repositoryFetch }),
    materialContractRead: createHttpMaterialContractReadRepository({ fetcher: repositoryFetch }),
    materialContractCommands: createHttpMaterialContractCommandRepository({ fetcher: repositoryFetch }),
  }
}
