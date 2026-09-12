import type { ConstructionContractCommandRepository } from '~/lib/construction-contract/command-contract'
import type { ConstructionContractReadRepository } from '~/lib/construction-contract/repository'
import type { CrewWorkerCommandRepository } from '~/lib/crew-worker/command-contract'
import type { CrewWorkerReadRepository } from '~/lib/crew-worker/repository'
import type { CustomerCommandRepository } from '~/lib/customer/command-contract'
import type { CustomerReadRepository } from '~/lib/customer/repository'
import type { MaterialContractCommandRepository } from '~/lib/material-contract/command-contract'
import type { MaterialContractReadRepository } from '~/lib/material-contract/repository'
import type { CoreMigrationRepository } from '~/lib/migration/core-http-repository'
import type { OwnerCommercialDocumentCommandRepository } from '~/lib/owner-document/central-command-contract'
import type { OwnerCommercialDocumentReadRepository } from '~/lib/owner-document/central-repository'
import type { ProjectSupplierCommandRepository, ProjectSupplierReadRepository } from '~/lib/project-supplier/repository'
import type { ProjectCommandRepository } from '~/lib/project/command-contract'
import type { ProjectListRepository } from '~/lib/project/repository'
import type { SubcontractContractCommandRepository } from '~/lib/subcontract-contract/command-contract'
import type { SubcontractContractReadRepository } from '~/lib/subcontract-contract/repository'
import type { SupplierCommandRepository } from '~/lib/supplier/command-contract'
import type { SupplierReadRepository } from '~/lib/supplier/repository'
import { createAuxiliaryContractRepository } from '~/lib/auxiliary-contract/repository'
import { createHttpConstructionContractCommandRepository } from '~/lib/construction-contract/command-http-repository'
import { createHttpConstructionContractReadRepository } from '~/lib/construction-contract/http-repository'
import { createHttpCrewWorkerCommandRepository } from '~/lib/crew-worker/command-http-repository'
import { createHttpCrewWorkerReadRepository } from '~/lib/crew-worker/http-repository'
import { createHttpCustomerCommandRepository } from '~/lib/customer/command-http-repository'
import { createHttpCustomerReadRepository } from '~/lib/customer/http-repository'
import { createDeliveryRepository } from '~/lib/delivery-record/repository'
import { createHttpMaterialContractCommandRepository } from '~/lib/material-contract/command-http-repository'
import { createHttpMaterialContractReadRepository } from '~/lib/material-contract/http-repository'
import { createHttpCoreMigrationRepository } from '~/lib/migration/core-http-repository'
import { createOtherSettlementRepository } from '~/lib/other-settlement/repository'
import {
  createHttpOwnerCommercialDocumentCommandRepository,
  createHttpOwnerCommercialDocumentReadRepository,
} from '~/lib/owner-document/central-http-repository'
import { createHttpProjectSupplierCommandRepository } from '~/lib/project-supplier/command-http-repository'
import { createHttpProjectSupplierReadRepository } from '~/lib/project-supplier/http-repository'
import { createHttpProjectCommandRepository } from '~/lib/project/command-http-repository'
import { createHttpProjectListRepository } from '~/lib/project/http-repository'
import { createQuantityRepository } from '~/lib/quantity/central-repository'
import { createReceiptRepository } from '~/lib/receipt/repository'
import { createHttpSubcontractContractCommandRepository } from '~/lib/subcontract-contract/command-http-repository'
import { createHttpSubcontractContractReadRepository } from '~/lib/subcontract-contract/http-repository'
import { createHttpSupplierCommandRepository } from '~/lib/supplier/command-http-repository'
import { createHttpSupplierReadRepository } from '~/lib/supplier/http-repository'

export interface DomainRepositories {
  quantity: ReturnType<typeof createQuantityRepository>
  deliveries: ReturnType<typeof createDeliveryRepository>
  receipts: ReturnType<typeof createReceiptRepository>
  otherSettlements: ReturnType<typeof createOtherSettlementRepository>
  auxiliaryContracts: ReturnType<typeof createAuxiliaryContractRepository>
  customerRead: CustomerReadRepository
  customerCommands: CustomerCommandRepository
  constructionContractRead: ConstructionContractReadRepository
  constructionContractCommands: ConstructionContractCommandRepository
  subcontractContractRead: SubcontractContractReadRepository
  subcontractContractCommands: SubcontractContractCommandRepository
  crewWorkerRead: CrewWorkerReadRepository
  crewWorkerCommands: CrewWorkerCommandRepository
  supplierRead: SupplierReadRepository
  supplierCommands: SupplierCommandRepository
  projectList: ProjectListRepository
  projectSupplierRead: ProjectSupplierReadRepository
  projectSupplierCommands: ProjectSupplierCommandRepository
  projectCommands: ProjectCommandRepository
  coreMigration: CoreMigrationRepository
  materialContractRead: MaterialContractReadRepository
  materialContractCommands: MaterialContractCommandRepository
  ownerCommercialDocumentRead: OwnerCommercialDocumentReadRepository
  ownerCommercialDocumentCommands: OwnerCommercialDocumentCommandRepository
}

export default defineNuxtPlugin({ name: 'domain-repositories', setup() {
  const repositories: DomainRepositories = {
    quantity: createQuantityRepository((url, options) => $fetch(url, options)),
    deliveries: createDeliveryRepository((url, options) => $fetch(url, options)),
    receipts: createReceiptRepository((url, options) => $fetch(url, options)),
    otherSettlements: createOtherSettlementRepository((url, options) => $fetch(url, options)),
    auxiliaryContracts: createAuxiliaryContractRepository((url, options) => $fetch(url, options)),
    customerRead: createHttpCustomerReadRepository({
      fetcher: (url, options) => $fetch(url, options),
    }),
    customerCommands: createHttpCustomerCommandRepository({
      fetcher: (url, options) => $fetch(url, options),
    }),
    constructionContractRead: createHttpConstructionContractReadRepository({
      fetcher: (url, options) => $fetch(url, options),
    }),
    constructionContractCommands: createHttpConstructionContractCommandRepository({
      fetcher: (url, options) => $fetch(url, options),
    }),
    subcontractContractRead: createHttpSubcontractContractReadRepository({
      fetcher: (url, options) => $fetch(url, options),
    }),
    subcontractContractCommands: createHttpSubcontractContractCommandRepository({
      fetcher: (url, options) => $fetch(url, options),
    }),
    crewWorkerRead: createHttpCrewWorkerReadRepository({
      fetcher: (url, options) => $fetch(url, options),
    }),
    crewWorkerCommands: createHttpCrewWorkerCommandRepository({
      fetcher: (url, options) => $fetch(url, options),
    }),
    supplierRead: createHttpSupplierReadRepository({
      fetcher: (url, options) => $fetch(url, options),
    }),
    supplierCommands: createHttpSupplierCommandRepository({
      fetcher: (url, options) => $fetch(url, options),
    }),
    projectList: createHttpProjectListRepository({
      fetcher: (url, options) => $fetch(url, options),
    }),
    projectSupplierRead: createHttpProjectSupplierReadRepository({
      fetcher: (url, options) => $fetch(url, options),
    }),
    projectSupplierCommands: createHttpProjectSupplierCommandRepository({
      fetcher: (url, options) => $fetch(url, options),
    }),
    projectCommands: createHttpProjectCommandRepository({
      fetcher: (url, options) => $fetch(url, options),
    }),
    coreMigration: createHttpCoreMigrationRepository({
      fetcher: (url, options) => $fetch(url, options),
    }),
    materialContractRead: createHttpMaterialContractReadRepository({
      fetcher: (url, options) => $fetch(url, options),
    }),
    materialContractCommands: createHttpMaterialContractCommandRepository({
      fetcher: (url, options) => $fetch(url, options),
    }),
    ownerCommercialDocumentRead: createHttpOwnerCommercialDocumentReadRepository({
      fetcher: (url, options) => $fetch(url, options),
    }),
    ownerCommercialDocumentCommands: createHttpOwnerCommercialDocumentCommandRepository({
      fetcher: (url, options) => $fetch(url, options),
    }),
  }
  return { provide: { repositories } }
} })

declare module '#app' {
  interface NuxtApp {
    $repositories: DomainRepositories
  }
}
