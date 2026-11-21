import type { createAuxiliaryContractRepository } from '~/lib/auxiliary-contract/repository'
import type { createBoqBuildingRepository } from '~/lib/boq/central-building-repository'
import type { ConstructionContractCommandRepository } from '~/lib/construction-contract/command-contract'
import type { ConstructionContractReadRepository } from '~/lib/construction-contract/repository'
import type { CrewWorkerCommandRepository } from '~/lib/crew-worker/command-contract'
import type { CrewWorkerReadRepository } from '~/lib/crew-worker/repository'
import type { createProductionAccessRepository } from '~/lib/customer/access-repository'
import type { CustomerCommandRepository } from '~/lib/customer/command-contract'
import type { createCustomerProductionRepository } from '~/lib/customer/production-repository'
import type { CustomerReadRepository } from '~/lib/customer/repository'
import type { createDeliveryRepository } from '~/lib/delivery-record/repository'
import type { FinanceRepository } from '~/lib/finance/central-contract'
import type { MaterialContractCommandRepository } from '~/lib/material-contract/command-contract'
import type { MaterialContractReadRepository } from '~/lib/material-contract/repository'
import type { createQuotationHttpRepository } from '~/lib/material-quotation/http-repository'
import type { CoreMigrationRepository } from '~/lib/migration/core-http-repository'
import type { createNotificationRepository } from '~/lib/notifications/repository'
import type { createOtherSettlementRepository } from '~/lib/other-settlement/repository'
import type { OwnerCommercialDocumentCommandRepository } from '~/lib/owner-document/central-command-contract'
import type { OwnerCommercialDocumentReadRepository } from '~/lib/owner-document/central-repository'
import type { PayrollRepository } from '~/lib/payroll/central-contract'
import type { createProductionBackupRepository } from '~/lib/production/backup-repository'
import type { ProjectSupplierCommandRepository, ProjectSupplierReadRepository } from '~/lib/project-supplier/repository'
import type { ProjectCommandRepository } from '~/lib/project/command-contract'
import type { createProjectProductionRepository } from '~/lib/project/production-repository'
import type { ProjectListRepository } from '~/lib/project/repository'
import type { createQuantityRepository } from '~/lib/quantity/central-repository'
import type { createReceiptRepository } from '~/lib/receipt/repository'
import type { RepositoryFetch, RepositoryFileFetch } from '~/lib/repositories/deferred'
import type { createScheduleRepository } from '~/lib/schedule/central-repository'
import type { createProcessLibraryRepository } from '~/lib/schedule/process-library-repository'
import type { SubcontractContractCommandRepository } from '~/lib/subcontract-contract/command-contract'
import type { SubcontractContractReadRepository } from '~/lib/subcontract-contract/repository'
import type { SupplierCommandRepository } from '~/lib/supplier/command-contract'
import type { createSupplierCredentialRepository } from '~/lib/supplier/credential-repository'
import type { createSupplierProductionRepository } from '~/lib/supplier/production-repository'
import type { SupplierReadRepository } from '~/lib/supplier/repository'
import type { createTargetCostRepository } from '~/lib/target-cost/central-repository'
import type { createWorkerRosterRepository } from '~/lib/worker-roster/repository'
import { deferredRepository, lazyDomain } from '~/lib/repositories/deferred'

export interface DomainRepositories {
  finance: FinanceRepository
  materialQuotations: ReturnType<typeof createQuotationHttpRepository>
  notifications: ReturnType<typeof createNotificationRepository>
  productionBackup: ReturnType<typeof createProductionBackupRepository>
  productionAccess: ReturnType<typeof createProductionAccessRepository>
  customerProduction: ReturnType<typeof createCustomerProductionRepository>
  projectProduction: ReturnType<typeof createProjectProductionRepository>
  workerRoster: ReturnType<typeof createWorkerRosterRepository>
  payroll: PayrollRepository
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

export function createDomainRepositories(repositoryFetch: RepositoryFetch, repositoryFileFetch: RepositoryFileFetch): DomainRepositories {
  const loadShell = lazyDomain(() => import('~/lib/repositories/domains/shell').then(module => module.createShellRepositories(repositoryFetch)))
  const loadFinance = lazyDomain(() => import('~/lib/repositories/domains/finance').then(module => module.createFinanceRepositories(repositoryFetch)))
  const loadContracts = lazyDomain(() => import('~/lib/repositories/domains/contracts').then(module => module.createContractsRepositories(repositoryFetch)))
  const loadCommercialDocuments = lazyDomain(() => import('~/lib/repositories/domains/commercial-documents').then(module => module.createCommercialDocumentsRepositories(repositoryFetch)))
  const loadPayroll = lazyDomain(() => import('~/lib/repositories/domains/payroll').then(module => module.createPayrollRepositories(repositoryFetch)))
  const loadMaterial = lazyDomain(() => import('~/lib/repositories/domains/material').then(module => module.createMaterialRepositories(repositoryFetch)))
  const loadProject = lazyDomain(() => import('~/lib/repositories/domains/project').then(module => module.createProjectRepositories(repositoryFetch, repositoryFileFetch)))
  const loadMasterData = lazyDomain(() => import('~/lib/repositories/domains/master-data').then(module => module.createMasterDataRepositories(repositoryFetch, repositoryFileFetch)))
  const loadSchedule = lazyDomain(() => import('~/lib/repositories/domains/schedule').then(module => module.createScheduleRepositories(repositoryFetch)))
  const loadProjectControls = lazyDomain(() => import('~/lib/repositories/domains/project-controls').then(module => module.createProjectControlsRepositories(repositoryFetch)))
  const loadMaintenance = lazyDomain(() => import('~/lib/repositories/domains/maintenance').then(module => module.createMaintenanceRepositories(repositoryFetch)))

  const repositories: DomainRepositories = {
    finance: deferredRepository(async () => (await loadFinance()).finance, ['paymentDetail', 'context', 'form', 'list', 'lookup', 'customer', 'execute', 'resolve', 'original']),
    materialQuotations: deferredRepository(async () => (await loadMaterial()).materialQuotations, ['list', 'context', 'loadForm', 'execute', 'resolve', 'original']),
    notifications: deferredRepository(async () => (await loadShell()).notifications, ['list', 'execute']),
    productionBackup: deferredRepository(async () => (await loadMaintenance()).productionBackup, ['status', 'execute']),
    productionAccess: deferredRepository(async () => (await loadShell()).productionAccess, ['status', 'login', 'logout']),
    customerProduction: deferredRepository(async () => (await loadMasterData()).customerProduction, ['lifecycle', 'deleted', 'execute', 'resolve', 'file']),
    projectProduction: deferredRepository(async () => (await loadProject()).projectProduction, ['lifecycle', 'deleted', 'execute', 'resolve', 'file']),
    workerRoster: deferredRepository(async () => (await loadPayroll()).workerRoster, ['profile', 'preview', 'execute', 'resolve', 'archives', 'archive', 'file']),
    payroll: deferredRepository(async () => (await loadPayroll()).payroll, [
      'resolveCommand',
      'workbookPreview',
      'workbookArchive',
      'workbookArchives',
      'executeWorkbook',
      'resolveWorkbook',
      'numbering',
      'executeNumbering',
      'batchPreview',
      'executeBatch',
      'batch',
      'aRounding',
      'executeARounding',
      'hollowConfig',
      'executeHollow',
      'aFeeConfig',
      'executeFees',
      'adjustmentHistory',
      'adjustmentForm',
      'adjustmentDetail',
      'actualPaymentForm',
      'actualPaymentDetail',
      'actualReversalForm',
      'actualLedger',
      'releaseAdjustmentPreview',
      'executeAdjustment',
      'dayworkList',
      'dayworkForm',
      'executeDaywork',
      'c2Form',
      'c2Config',
      'c2Output',
      'executeC2',
      'attendanceMatrix',
      'executeAttendance',
      'c1Form',
      'c1Config',
      'c1Output',
      'executeC1',
      'aForm',
      'aConfig',
      'aOutput',
      'execute',
      'list',
      'detail',
      'sources',
    ]),
    targetCosts: deferredRepository(async () => (await loadProjectControls()).targetCosts, ['list', 'form', 'detail', 'file', 'execute', 'resolve']),
    boqBuilding: deferredRepository(async () => (await loadProjectControls()).boqBuilding, ['read', 'execute']),
    schedule: deferredRepository(async () => (await loadSchedule()).schedule, ['binding', 'catalog', 'read', 'scope', 'execute', 'resolve']),
    supplierCredentials: deferredRepository(async () => (await loadMasterData()).supplierCredentials, ['read', 'execute', 'file']),
    supplierProduction: deferredRepository(async () => (await loadMasterData()).supplierProduction, ['resolve']),
    processLibraries: deferredRepository(async () => (await loadSchedule()).processLibraries, ['list', 'detail', 'execute']),
    quantity: deferredRepository(async () => (await loadProjectControls()).quantity, [
      'resolve',
      'hollow',
      'variance',
      'boq',
      'workspace',
      'assignments',
      'completion',
      'batchPlan',
      'photo',
      'stages',
      'region',
      'templates',
      'execute',
    ]),
    deliveries: deferredRepository(async () => (await loadMaterial()).deliveries, ['context', 'list', 'detail', 'history', 'execute', 'fileContent']),
    receipts: deferredRepository(async () => (await loadFinance()).receipts, ['detail', 'list', 'context', 'execute', 'resolve', 'fileContent']),
    otherSettlements: deferredRepository(async () => (await loadCommercialDocuments()).otherSettlements, ['loadForm', 'expenses', 'resolve', 'original', 'source', 'list', 'detail', 'context', 'execute']),
    auxiliaryContracts: deferredRepository(async () => (await loadContracts()).auxiliaryContracts, [
      'list',
      'detail',
      'context',
      'execute',
      'resolve',
      'fileContent',
      'importState',
      'preflight',
      'adopt',
      'restoreImport',
      'loadForm',
    ]),
    customerRead: deferredRepository(async () => (await loadMasterData()).customerRead, ['list', 'get', 'getReceipt']),
    customerCommands: deferredRepository(async () => (await loadMasterData()).customerCommands, ['context', 'loadForm', 'execute']),
    constructionContractRead: deferredRepository(async () => (await loadContracts()).constructionContractRead, ['list', 'get', 'fileContent']),
    constructionContractCommands: deferredRepository(async () => (await loadContracts()).constructionContractCommands, ['context', 'loadForm', 'execute', 'resolve']),
    subcontractContractRead: deferredRepository(async () => (await loadContracts()).subcontractContractRead, ['list', 'get', 'fileContent']),
    subcontractContractCommands: deferredRepository(async () => (await loadContracts()).subcontractContractCommands, ['context', 'loadForm', 'execute', 'resolve']),
    crewWorkerRead: deferredRepository(async () => (await loadMasterData()).crewWorkerRead, ['listCrews', 'getCrew', 'listWorkers', 'getWorker', 'getRelationFactIdentity']),
    crewWorkerCommands: deferredRepository(async () => (await loadMasterData()).crewWorkerCommands, [
      'context',
      'loadCrewForm',
      'loadWorkerForm',
      'executeCrew',
      'executeWorker',
      'resolveCrew',
      'resolveWorker',
      'previewCrewExcel',
      'importCrewExcel',
      'previewWorkerExcel',
      'importWorkerExcel',
    ]),
    supplierRead: deferredRepository(async () => (await loadMasterData()).supplierRead, ['list', 'get']),
    supplierCommands: deferredRepository(async () => (await loadMasterData()).supplierCommands, ['recordTaxpayerVerification', 'context', 'loadForm', 'execute', 'importRow', 'previewImport']),
    projectList: deferredRepository(async () => (await loadProject()).projectList, ['list', 'get']),
    projectSupplierRead: deferredRepository(async () => (await loadProject()).projectSupplierRead, ['getContent', 'get']),
    projectSupplierCommands: deferredRepository(async () => (await loadProject()).projectSupplierCommands, ['loadImportContext', 'importFiles']),
    projectCommands: deferredRepository(async () => (await loadProject()).projectCommands, ['context', 'loadForm', 'execute']),
    coreMigration: deferredRepository(async () => (await loadMaintenance()).coreMigration, ['context', 'preflight', 'dryRun', 'importBatch', 'confirm', 'rollback', 'snapshot']),
    materialContractRead: deferredRepository(async () => (await loadContracts()).materialContractRead, ['prices', 'fileContent', 'list', 'get']),
    materialContractCommands: deferredRepository(async () => (await loadContracts()).materialContractCommands, ['context', 'loadForm', 'execute', 'resolve']),
    ownerCommercialDocumentRead: deferredRepository(async () => (await loadCommercialDocuments()).ownerCommercialDocumentRead, ['list', 'get']),
    ownerCommercialDocumentCommands: deferredRepository(async () => (await loadCommercialDocuments()).ownerCommercialDocumentCommands, ['context', 'loadForm', 'boqLines', 'execute']),
  }
  return repositories
}

export default defineNuxtPlugin({
  name: 'domain-repositories',
  setup() {
    const repositories = createDomainRepositories($fetch as unknown as RepositoryFetch, $fetch as unknown as RepositoryFileFetch)
    return { provide: { repositories } }
  },
})

declare module '#app' {
  interface NuxtApp {
    $repositories: DomainRepositories
  }
}
