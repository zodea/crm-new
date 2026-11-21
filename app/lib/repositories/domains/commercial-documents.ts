import type { RepositoryFetch } from '../deferred'
import { createOtherSettlementRepository } from '~/lib/other-settlement/repository'
import { createHttpOwnerCommercialDocumentCommandRepository, createHttpOwnerCommercialDocumentReadRepository } from '~/lib/owner-document/central-http-repository'

export function createCommercialDocumentsRepositories(repositoryFetch: RepositoryFetch) {
  return {
    otherSettlements: createOtherSettlementRepository(repositoryFetch),
    ownerCommercialDocumentRead: createHttpOwnerCommercialDocumentReadRepository({ fetcher: repositoryFetch }),
    ownerCommercialDocumentCommands: createHttpOwnerCommercialDocumentCommandRepository({ fetcher: repositoryFetch }),
  }
}
