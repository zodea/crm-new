import type {
  DataOriginDTO,
  EntityRefDTO,
  ISODateDTO,
  ISODateTimeDTO,
  MetricDTO,
  MoneyDTO,
  NavigationIntentDTO,
  PageDTO,
  ProblemDTO,
} from '../../types/read-model'

export const SUPPLIER_PAGE_SIZES = [10, 20, 50, 100] as const
export type SupplierPageSize = typeof SUPPLIER_PAGE_SIZES[number]
export type SupplierListSort = 'updated-desc' | 'name-asc' | 'name-desc' | 'category-asc'

export interface SupplierListQueryDTO {
  includeDemo: boolean
  search: string
  category: string | null
  credentialStatus: string | null
  sort: SupplierListSort
  page: number
  pageSize: SupplierPageSize
}

export interface SupplierDetailQueryDTO {
  id: string
  origin: DataOriginDTO
  includeDemo: boolean
}

export interface SupplierReadRepository {
  list: (query: SupplierListQueryDTO) => Promise<SupplierListPageDTO>
  get: (query: SupplierDetailQueryDTO) => Promise<SupplierDetailReadDTO>
}

export interface SupplierListSourceRow {
  dataOrigin: DataOriginDTO
  id: string
  name: string
  aliases: string[]
  externalRef: string
  uniqueCode: string
  taxNo: string
  businessType: string
  supplierCategory: string
  rating: string
  legalRep: string
  registeredCapital: number | null
  registeredDate: ISODateDTO | null
  address: string
  taxpayerType: string
  mainBusiness: string
  invoiceName: string
  invoiceAddress: string
  bank: string
  bankAccount: string
  phone: string
  contact: string
  contactPhone: string
  contactTitle: string
  credentialStatus: string
  note: string
  updatedAt: ISODateTimeDTO
}

export interface SupplierListItemDTO {
  dataOrigin: DataOriginDTO
  supplier: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'supplier' }
  navigation: Extract<NavigationIntentDTO, { kind: 'entity-detail' }>
  aliases: string[]
  taxNo: string
  uniqueCode: string
  supplierCategory: string
  credentialStatus: string
  contact: string
  contactPhone: string
  projectCount: number
  contractAmount: MoneyDTO
  paymentAmount: MoneyDTO
  updatedAt: ISODateTimeDTO
}

export interface SupplierListSummaryDTO {
  categories: Array<{ value: string, label: string, count: number }>
  credentialStatuses: Array<{ value: string, label: string, count: number }>
  origins: Record<DataOriginDTO, { supplierCount: number, contractAmount: MoneyDTO, paymentAmount: MoneyDTO }>
}

export type SupplierListPageDTO = PageDTO<SupplierListItemDTO, SupplierListSummaryDTO>

export interface SupplierProjectSourceRow {
  dataOrigin: DataOriginDTO
  id: string
  name: string
  status: string
  permission: 'allowed' | 'forbidden'
}

export interface SupplierProjectRelationSourceRow {
  dataOrigin: DataOriginDTO
  id: string
  projectId: string
  supplierId: string
  status: string
}

export interface SupplierContractSourceRow {
  dataOrigin: DataOriginDTO
  id: string
  supplierId: string | null
  projectId: string | null
  no: string
  name: string
  kind: string
  amount: number
  supplementAmount: number
  signDate: ISODateDTO | null
  status: string
}

export interface SupplierSettlementSourceRow {
  dataOrigin: DataOriginDTO
  id: string
  supplierId: string
  projectId: string | null
  contractId: string | null
  no: string
  name: string
  settlementType: string
  totalAmount: number
  settlementDate: ISODateDTO | null
  status: string
}

export interface SupplierInvoiceSourceRow {
  dataOrigin: DataOriginDTO
  id: string
  supplierId: string | null
  projectId: string | null
  contractId: string | null
  invoiceNumber: string
  invoiceType: string
  invoiceDate: ISODateDTO | null
  totalAmount: number
  taxAmount: number
  accountStatus: string
}

export interface SupplierPaymentApplicationSourceRow {
  dataOrigin: DataOriginDTO
  id: string
  supplierId: string | null
  projectId: string | null
  contractId: string | null
  no: string
  name: string
  applyAmount: number
  approvedAmount: number
  applyDate: ISODateDTO | null
  status: string
}

export interface SupplierPaymentRecordSourceRow {
  dataOrigin: DataOriginDTO
  id: string
  supplierId: string | null
  projectId: string | null
  no: string
  amount: number
  paymentDate: ISODateDTO | null
  confirmationStatus: string
}

export interface SupplierPaymentAllocationSourceRow {
  dataOrigin: DataOriginDTO
  id: string
  paymentRecordId: string
  paymentApplicationId: string
  allocatedAmount: number
}

export interface SupplierDetailSummaryDTO {
  projectCount: number
  contractCount: number
  settlementCount: number
  invoiceCount: number
  paymentCount: number
  contractAmount: MetricDTO
  settlementAmount: MetricDTO
  invoiceAmount: MetricDTO
  paymentAmount: MetricDTO
  payableAmount: MetricDTO
}

export interface SupplierProjectDTO {
  relationId: string
  project: EntityRefDTO & { entity: 'project' }
  navigation: NavigationIntentDTO
  relationshipStatus: string
}

export interface SupplierContractDTO {
  contract: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'contract' }
  navigation: NavigationIntentDTO
  project: EntityRefDTO & { entity: 'project' }
  projectNavigation: NavigationIntentDTO
  kind: string
  effectiveAmount: MoneyDTO
  signDate: ISODateDTO | null
  status: string
  isDraft: boolean
}

export interface SupplierSettlementDTO {
  settlement: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'settlement' }
  navigation: NavigationIntentDTO
  project: EntityRefDTO & { entity: 'project' }
  projectNavigation: NavigationIntentDTO
  contract: EntityRefDTO & { entity: 'contract' }
  contractNavigation: NavigationIntentDTO
  settlementType: string
  totalAmount: MoneyDTO
  settlementDate: ISODateDTO | null
  status: string
}

export interface SupplierInvoiceDTO {
  invoice: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'invoice' }
  navigation: NavigationIntentDTO
  project: EntityRefDTO & { entity: 'project' }
  projectNavigation: NavigationIntentDTO
  contract: EntityRefDTO & { entity: 'contract' }
  contractNavigation: NavigationIntentDTO
  invoiceType: string
  invoiceDate: ISODateDTO | null
  totalAmount: MoneyDTO
  taxAmount: MoneyDTO
  accountStatus: string
}

export interface SupplierPaymentDTO {
  application: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'payment-application' }
  navigation: NavigationIntentDTO
  project: EntityRefDTO & { entity: 'project' }
  projectNavigation: NavigationIntentDTO
  contract: EntityRefDTO & { entity: 'contract' }
  contractNavigation: NavigationIntentDTO
  applyAmount: MoneyDTO
  approvedAmount: MoneyDTO
  actualPaidAmount: MoneyDTO
  applyDate: ISODateDTO | null
  status: string
}

export interface SupplierDetailReadDTO {
  dataOrigin: DataOriginDTO
  supplier: SupplierListSourceRow
  projects: SupplierProjectDTO[]
  contracts: SupplierContractDTO[]
  settlements: SupplierSettlementDTO[]
  invoices: SupplierInvoiceDTO[]
  payments: SupplierPaymentDTO[]
  summary: SupplierDetailSummaryDTO
  asOf: ISODateTimeDTO
  sourceVersion: string | null
  capabilities: string[]
}

export class SupplierRepositoryProblem extends Error {
  constructor(public readonly problem: ProblemDTO, options: { cause?: unknown } = {}) {
    super(problem.message, options)
    this.name = 'SupplierRepositoryProblem'
  }
}

export function supplierProblem(
  code: ProblemDTO['code'],
  message: string,
  retryable = false,
): ProblemDTO {
  return { code, message, retryable, fieldErrors: {}, traceId: null }
}
