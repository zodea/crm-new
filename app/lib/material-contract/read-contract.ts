import type {
  DataOriginDTO,
  EntityRefDTO,
  ISODateDTO,
  ISODateTimeDTO,
  MoneyDTO,
  NavigationIntentDTO,
  PageDTO,
  ProblemDTO,
  RatioDTO,
} from '../../types/read-model'

export const MATERIAL_CONTRACT_PAGE_SIZES = [10, 20, 50, 100] as const
export type MaterialContractPageSize = typeof MATERIAL_CONTRACT_PAGE_SIZES[number]

export interface MaterialContractListQueryDTO {
  includeDemo: boolean
  origin: DataOriginDTO | null
  search: string
  projectId: string | null
  supplierId: string | null
  status: string | null
  page: number
  pageSize: MaterialContractPageSize
}

export interface MaterialContractDetailQueryDTO {
  id: string
  origin: DataOriginDTO
  includeDemo: boolean
}

export interface MaterialContractDetailSource {
  dataOrigin: DataOriginDTO
  id: string
  no: string
  name: string
  kind: string
  projectId: string | null
  projectName: string
  projectReferenceState: 'resolved' | 'forbidden' | 'missing-target'
  supplierId: string | null
  supplierName: string
  supplierReferenceState: 'resolved' | 'forbidden' | 'missing-target'
  amount: number
  supplementAmount: number
  settledAmount: number
  invoicedAmount: number
  paidAmount: number
  content: string
  invoiceType: string
  contactName: string
  contactPhone: string
  taxRate: number | null
  signDate: ISODateDTO | null
  mainTerms: string
  paymentTerms: string
  brandQualityTerms: string
  scheduleTerms: string
  warrantyTerms: string
  specialTerms: string
  retentionRatio: number | null
  retentionAmount: number | null
  retentionDays: number | null
  invoiceName: string
  invoiceTaxNo: string
  invoiceAddressPhone: string
  invoiceBank: string
  invoiceBankAccount: string
  status: string
  note: string
  createdAt: ISODateTimeDTO
  updatedAt: ISODateTimeDTO
}

export interface MaterialContractLineSource {
  dataOrigin: DataOriginDTO
  id: string
  contractId: string
  materialName: string
  spec: string
  brand: string
  unit: string
  qty: number | null
  taxInclusiveUnitPrice: number | null
  plannedArrivalDate: ISODateDTO | null
  note: string
  sortOrder: number
}

export interface MaterialContractDocumentSource {
  dataOrigin: DataOriginDTO
  id: string
  contractId: string | null
  no: string
  name: string
  amount: number | null
  date: ISODateDTO | null
  status: string
}

export interface MaterialContractPaymentRecordSource {
  dataOrigin: DataOriginDTO
  id: string
  no: string
  amount: number
  confirmationStatus: string
  paymentDate: ISODateDTO | null
}

export interface MaterialContractPaymentAllocationSource {
  dataOrigin: DataOriginDTO
  paymentRecordId: string
  paymentApplicationId: string
  allocatedAmount: number
}

export interface MaterialContractFileSource {
  dataOrigin: DataOriginDTO
  id: string
  contractId: string
  fileName: string
  fileSize: number
  mimeType: string
  category: string
  uploadedAt: ISODateTimeDTO | null
}

export interface MaterialContractFactSources {
  lineItems: MaterialContractLineSource[]
  materialRequisitions: MaterialContractDocumentSource[]
  materialArrivals: MaterialContractDocumentSource[]
  invoices: MaterialContractDocumentSource[]
  paymentApplications: MaterialContractDocumentSource[]
  paymentRecords: MaterialContractPaymentRecordSource[]
  paymentAllocations: MaterialContractPaymentAllocationSource[]
  settlements: MaterialContractDocumentSource[]
  penalties: MaterialContractDocumentSource[]
  files: MaterialContractFileSource[]
}

export interface MaterialContractAmountsDTO {
  contract: MoneyDTO
  changed: MoneyDTO
  settled: MoneyDTO
  invoiced: MoneyDTO
  paid: MoneyDTO
  payable: MoneyDTO
}

export interface MaterialContractDTO {
  dataOrigin: DataOriginDTO
  id: string
  no: string
  name: string
  kind: '材采'
  project: EntityRefDTO & { entity: 'project' }
  supplier: EntityRefDTO & { entity: 'supplier' }
  amounts: MaterialContractAmountsDTO
  content: string
  invoiceType: string
  contactName: string
  contactPhone: string
  taxRate: number | null
  signDate: ISODateDTO | null
  mainTerms: string
  paymentTerms: string
  brandQualityTerms: string
  scheduleTerms: string
  warrantyTerms: string
  specialTerms: string
  retentionRatio: RatioDTO | null
  retentionAmount: MoneyDTO | null
  retentionDays: number | null
  invoiceName: string
  invoiceTaxNo: string
  invoiceAddressPhone: string
  invoiceBank: string
  invoiceBankAccount: string
  status: string
  note: string
  updatedAt: ISODateTimeDTO
}

export interface MaterialContractFactDTO {
  id: string
  no: string
  name: string
  amount: MoneyDTO | null
  paidAmount?: MoneyDTO
  date: ISODateDTO | null
  status: string
  navigation: NavigationIntentDTO
}

export interface MaterialContractLineDTO {
  id: string
  materialName: string
  spec: string
  brand: string
  unit: string
  qty: string | null
  unitPrice: MoneyDTO | null
  amount: MoneyDTO | null
  plannedArrivalDate: ISODateDTO | null
  note: string
}

export interface MaterialContractFileDTO {
  id: string
  fileName: string
  fileSize: number
  mimeType: string
  category: string
  uploadedAt: ISODateTimeDTO | null
}

export interface MaterialContractDetailReadDTO {
  dataOrigin: DataOriginDTO
  contract: MaterialContractDTO
  projectNavigation: NavigationIntentDTO
  supplierNavigation: NavigationIntentDTO
  sections: {
    lineItems: MaterialContractLineDTO[]
    materials: {
      requisitions: MaterialContractFactDTO[]
      arrivals: MaterialContractFactDTO[]
      directTransfers: MaterialContractFactDTO[]
      outbound: MaterialContractFactDTO[]
    }
    invoices: MaterialContractFactDTO[]
    payments: MaterialContractFactDTO[]
    settlements: MaterialContractFactDTO[]
    penalties: MaterialContractFactDTO[]
    files: MaterialContractFileDTO[]
  }
  asOf: ISODateTimeDTO
  sourceVersion: string | null
  capabilities: string[]
}

export interface MaterialContractListItemDTO {
  rowKey: string
  dataOrigin: DataOriginDTO
  id: string
  no: string
  name: string
  navigation: NavigationIntentDTO
  project: EntityRefDTO & { entity: 'project' }
  projectNavigation: NavigationIntentDTO
  supplier: EntityRefDTO & { entity: 'supplier' }
  supplierNavigation: NavigationIntentDTO
  amounts: MaterialContractAmountsDTO
  signDate: ISODateDTO | null
  status: string
  updatedAt: ISODateTimeDTO
}

export interface MaterialContractListSummaryDTO {
  projects: Array<{ id: string, label: string }>
  suppliers: Array<{ id: string, label: string }>
  statuses: Array<{ value: string, count: number }>
  origins: Record<DataOriginDTO, {
    contractCount: number
    changedAmount: MoneyDTO
    invoicedAmount: MoneyDTO
    paidAmount: MoneyDTO
  }>
}

export type MaterialContractListPageDTO = PageDTO<
  MaterialContractListItemDTO,
  MaterialContractListSummaryDTO
>

export interface MaterialContractReadRepository {
  list: (query: MaterialContractListQueryDTO) => Promise<MaterialContractListPageDTO>
  get: (query: MaterialContractDetailQueryDTO) => Promise<MaterialContractDetailReadDTO>
}

export class MaterialContractRepositoryProblem extends Error {
  constructor(public readonly problem: ProblemDTO, options: { cause?: unknown } = {}) {
    super(problem.message, options)
    this.name = 'MaterialContractRepositoryProblem'
  }
}

export function materialContractProblem(
  code: ProblemDTO['code'],
  message: string,
  retryable = false,
): ProblemDTO {
  return { code, message, retryable, fieldErrors: {}, traceId: null }
}
