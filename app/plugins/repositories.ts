import type { ConstructionContractCommandRepository } from '~/lib/construction-contract/command-contract'
import type { ConstructionContractReadRepository } from '~/lib/construction-contract/repository'
import type { CrewWorkerCommandRepository } from '~/lib/crew-worker/command-contract'
import type { CrewWorkerReadRepository } from '~/lib/crew-worker/repository'
import type { CustomerCommandRepository } from '~/lib/customer/command-contract'
import type { CustomerReadRepository } from '~/lib/customer/repository'
import type { FinanceRepository } from '~/lib/finance/central-contract'
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
import { createBoqBuildingRepository } from '~/lib/boq/central-building-repository'
import { createHttpConstructionContractCommandRepository } from '~/lib/construction-contract/command-http-repository'
import { createHttpConstructionContractReadRepository } from '~/lib/construction-contract/http-repository'
import { createHttpCrewWorkerCommandRepository } from '~/lib/crew-worker/command-http-repository'
import { createHttpCrewWorkerReadRepository } from '~/lib/crew-worker/http-repository'
import { createProductionAccessRepository } from '~/lib/customer/access-repository'
import { createHttpCustomerCommandRepository } from '~/lib/customer/command-http-repository'
import { createHttpCustomerReadRepository } from '~/lib/customer/http-repository'
import { createCustomerProductionRepository } from '~/lib/customer/production-repository'
import { createDeliveryRepository } from '~/lib/delivery-record/repository'
import { createFinanceRepository } from '~/lib/finance/http-repository'
import { createHttpMaterialContractCommandRepository } from '~/lib/material-contract/command-http-repository'
import { createHttpMaterialContractReadRepository } from '~/lib/material-contract/http-repository'
import { createQuotationHttpRepository } from '~/lib/material-quotation/http-repository'
import { createHttpCoreMigrationRepository } from '~/lib/migration/core-http-repository'
import { createNotificationRepository } from '~/lib/notifications/repository'
import { createOtherSettlementRepository } from '~/lib/other-settlement/repository'
import {
  createHttpOwnerCommercialDocumentCommandRepository,
  createHttpOwnerCommercialDocumentReadRepository,
} from '~/lib/owner-document/central-http-repository'
import { createPayrollRepository } from '~/lib/payroll/central-repository'
import { createProductionBackupRepository } from '~/lib/production/backup-repository'
import { createHttpProjectSupplierCommandRepository } from '~/lib/project-supplier/command-http-repository'
import { createHttpProjectSupplierReadRepository } from '~/lib/project-supplier/http-repository'
import { createHttpProjectCommandRepository } from '~/lib/project/command-http-repository'
import { createHttpProjectListRepository } from '~/lib/project/http-repository'
import { createProjectProductionRepository } from '~/lib/project/production-repository'
import { createQuantityRepository } from '~/lib/quantity/central-repository'
import { createReceiptRepository } from '~/lib/receipt/repository'
import { createScheduleRepository } from '~/lib/schedule/central-repository'
import { createProcessLibraryRepository } from '~/lib/schedule/process-library-repository'
import { createHttpSubcontractContractCommandRepository } from '~/lib/subcontract-contract/command-http-repository'
import { createHttpSubcontractContractReadRepository } from '~/lib/subcontract-contract/http-repository'
import { createHttpSupplierCommandRepository } from '~/lib/supplier/command-http-repository'
import { createSupplierCredentialRepository } from '~/lib/supplier/credential-repository'
import { createHttpSupplierReadRepository } from '~/lib/supplier/http-repository'
import { createSupplierProductionRepository } from '~/lib/supplier/production-repository'
import { createTargetCostRepository } from '~/lib/target-cost/central-repository'
import { createWorkerRosterRepository } from '~/lib/worker-roster/repository'

export interface DomainRepositories {
  finance: FinanceRepository
  materialQuotations: ReturnType<typeof createQuotationHttpRepository>
  notifications: ReturnType<typeof createNotificationRepository>
  productionBackup: ReturnType<typeof createProductionBackupRepository>
  productionAccess: ReturnType<typeof createProductionAccessRepository>
  customerProduction: ReturnType<typeof createCustomerProductionRepository>
  projectProduction: ReturnType<typeof createProjectProductionRepository>
  workerRoster: ReturnType<typeof createWorkerRosterRepository>
  payroll: ReturnType<typeof createPayrollRepository>
  targetCosts: ReturnType<typeof createTargetCostRepository>
  boqBuilding: ReturnType<typeof createBoqBuildingRepository>
  schedule: ReturnType<typeof createScheduleRepository>
  supplierCredentials: ReturnType<typeof createSupplierCredentialRepository>
  supplierProduction: ReturnType<typeof createSupplierProductionRepository>
  processLibraries: ReturnType<typeof createProcessLibraryRepository>
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

// Keep the generic Nuxt fetch type at this adapter boundary; repository contracts
// already constrain each endpoint's options and response decoder.
const repositoryFetch = $fetch as unknown as (url: string, options?: object) => Promise<unknown>
const repositoryFileFetch = $fetch as unknown as (url: string, options: { responseType: 'blob' }) => Promise<Blob>

export default defineNuxtPlugin({ name: 'domain-repositories', setup() {
  const repositories: DomainRepositories = {
    finance: createFinanceRepository((url, options) => repositoryFetch(url, { ...options, retry: 0 })),
    materialQuotations: createQuotationHttpRepository((url, options) => repositoryFetch(url, { ...options, retry: 0 })),
    notifications: createNotificationRepository((url, options) => repositoryFetch(url, { ...options, retry: 0 })),
    productionBackup: createProductionBackupRepository((url, options) => repositoryFetch(url, { ...options, timeout: options ? 120_000 : 10_000, retry: 0 })),
    productionAccess: createProductionAccessRepository((url, options) => repositoryFetch(url, { ...options, timeout: 10_000, retry: 0 })),
    customerProduction: createCustomerProductionRepository((url, options) => repositoryFetch(url, options), url => repositoryFileFetch(url, { responseType: 'blob' })),
    projectProduction: createProjectProductionRepository((url, options) => repositoryFetch(url, options), url => repositoryFileFetch(url, { responseType: 'blob' })),
    workerRoster: createWorkerRosterRepository((url, options) => repositoryFetch(url, { ...options, body: options?.body as Record<string, unknown> | undefined })),
    payroll: createPayrollRepository((url, options) => repositoryFetch(url, options)),
    targetCosts: createTargetCostRepository((url, options) => repositoryFetch(url, options)),
    boqBuilding: createBoqBuildingRepository((url, options) => repositoryFetch(url, options)),
    schedule: createScheduleRepository((url, options) => repositoryFetch(url, options)),
    supplierCredentials: createSupplierCredentialRepository((url, options) => repositoryFetch(url, options)),
    processLibraries: createProcessLibraryRepository((url, options) => repositoryFetch(url, options)),
    quantity: createQuantityRepository((url, options) => repositoryFetch(url, options)),
    deliveries: createDeliveryRepository((url, options) => repositoryFetch(url, options)),
    receipts: createReceiptRepository((url, options) => repositoryFetch(url, options)),
    otherSettlements: createOtherSettlementRepository((url, options) => repositoryFetch(url, options)),
    auxiliaryContracts: createAuxiliaryContractRepository((url, options) => repositoryFetch(url, options)),
    supplierProduction: createSupplierProductionRepository((url, options) => repositoryFetch(url, options)),
    customerRead: createHttpCustomerReadRepository({
      fetcher: (url, options) => repositoryFetch(url, options),
    }),
    customerCommands: createHttpCustomerCommandRepository({
      fetcher: (url, options) => repositoryFetch(url, options),
    }),
    constructionContractRead: createHttpConstructionContractReadRepository({
      fetcher: (url, options) => repositoryFetch(url, options),
    }),
    constructionContractCommands: createHttpConstructionContractCommandRepository({
      fetcher: (url, options) => repositoryFetch(url, options),
    }),
    subcontractContractRead: createHttpSubcontractContractReadRepository({
      fetcher: (url, options) => repositoryFetch(url, options),
    }),
    subcontractContractCommands: createHttpSubcontractContractCommandRepository({
      fetcher: (url, options) => repositoryFetch(url, options),
    }),
    crewWorkerRead: createHttpCrewWorkerReadRepository({
      fetcher: (url, options) => repositoryFetch(url, options),
    }),
    crewWorkerCommands: createHttpCrewWorkerCommandRepository({
      fetcher: (url, options) => repositoryFetch(url, options),
    }),
    supplierRead: createHttpSupplierReadRepository({
      fetcher: (url, options) => repositoryFetch(url, options),
    }),
    supplierCommands: createHttpSupplierCommandRepository({
      fetcher: (url, options) => repositoryFetch(url, options),
    }),
    projectList: createHttpProjectListRepository({
      fetcher: (url, options) => repositoryFetch(url, options),
    }),
    projectSupplierRead: createHttpProjectSupplierReadRepository({
      fetcher: (url, options) => repositoryFetch(url, options),
    }),
    projectSupplierCommands: createHttpProjectSupplierCommandRepository({
      fetcher: (url, options) => repositoryFetch(url, options),
    }),
    projectCommands: createHttpProjectCommandRepository({
      fetcher: (url, options) => repositoryFetch(url, options),
    }),
    coreMigration: createHttpCoreMigrationRepository({
      fetcher: (url, options) => repositoryFetch(url, options),
    }),
    materialContractRead: createHttpMaterialContractReadRepository({
      fetcher: (url, options) => repositoryFetch(url, options),
    }),
    materialContractCommands: createHttpMaterialContractCommandRepository({
      fetcher: (url, options) => repositoryFetch(url, options),
    }),
    ownerCommercialDocumentRead: createHttpOwnerCommercialDocumentReadRepository({
      fetcher: (url, options) => repositoryFetch(url, options),
    }),
    ownerCommercialDocumentCommands: createHttpOwnerCommercialDocumentCommandRepository({
      fetcher: (url, options) => repositoryFetch(url, options),
    }),
  }
  return { provide: { repositories } }
} })

declare module '#app' {
  interface NuxtApp {
    $repositories: DomainRepositories
  }
}
