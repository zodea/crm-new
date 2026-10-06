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
  ReadMetaDTO,
} from '../../types/read-model'
import type { ContractLineSourceEvidence } from '../contract/forms'
import type { ContractListFilter } from '../contract/list-filters'
import type { OurSignatorySnapshot } from '../our-signatory/contract'

export const MATERIAL_CONTRACT_PAGE_SIZES = [10, 20, 50, 100] as const
export type MaterialContractPageSize = typeof MATERIAL_CONTRACT_PAGE_SIZES[number]

export interface MaterialContractListQueryDTO {
  includeDemo: boolean
  origin: DataOriginDTO | null
  search: string
  projectId: string | null
  supplierId: string | null
  status: ContractListFilter
  page: number
  pageSize: MaterialContractPageSize
}

export interface MaterialContractDetailQueryDTO {
  id: string
  origin: DataOriginDTO
  includeDemo: boolean
  supplementId?: string | null
}

export interface MaterialContractDetailSource {
  ourSignatorySnapshot?: OurSignatorySnapshot | null
  legacyPartyA?: string | null
  dataOrigin: DataOriginDTO
  id: string
  no: string
  name: string
  kind: string
  projectId: string | null
  projectName: string
  projectReferenceState: 'resolved' | 'forbidden' | 'missing-target' | 'unavailable'
  supplierId: string | null
  supplierName: string
  supplierReferenceState: 'resolved' | 'forbidden' | 'missing-target' | 'unavailable'
  amount: number | null
  supplementAmount: number | null
  settledAmount: number
  invoicedAmount: number
  paidAmount: number
  financialReadStatus?: 'unavailable'
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
  materialGrade?: string
  brand: string
  unit: string
  qty: number | null
  taxInclusiveUnitPrice: number | null
  applicableTaxRate?: number | null
  plannedArrivalDate: ISODateDTO | null
  note: string
  sortOrder: number
  originalLineId?: string | null
  changeAmount?: number | null
  changeBasis?: string
  source?: ContractLineSourceEvidence | null
}

export interface MaterialContractDeductionSource {
  dataOrigin: DataOriginDTO
  id: string
  ownerId: string
  name: string
  amount: number | null
  basis: string
  sortOrder: number
}

export interface MaterialContractSupplementSource {
  ourSignatorySnapshot?: OurSignatorySnapshot | null
  dataOrigin: DataOriginDTO
  id: string
  contractId: string
  no: string
  name: string
  content: string
  amount: number | null
  signDate: ISODateDTO | null
  status: string
  originalLineSnapshots?: Array<{ originalLineId: string, parentVersion: number | null, sourceUpdatedAt?: string, line: import('../contract/forms').ContractLineItemDraft }>
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
  originalAvailable?: boolean
}

export interface MaterialContractFactSources {
  lineItems: MaterialContractLineSource[]
  deductions?: MaterialContractDeductionSource[]
  supplements?: MaterialContractSupplementSource[]
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
  contract: MoneyDTO | null
  changed: MoneyDTO | null
  settled: MoneyDTO | null
  invoiced: MoneyDTO | null
  paid: MoneyDTO | null
  payable: MoneyDTO | null
}

export interface MaterialContractDTO {
  ourSignatorySnapshot: OurSignatorySnapshot | null
  legacyPartyA: string | null
  dataOrigin: DataOriginDTO
  id: string
  no: string
  name: string
  kind: '材采'
  project: EntityRefDTO & { entity: 'project' }
  supplier: EntityRefDTO & { entity: 'supplier' }
  amounts: MaterialContractAmountsDTO
  financialReadStatus?: 'unavailable'
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
  materialGrade?: string
  brand: string
  unit: string
  qty: string | null
  unitPrice: MoneyDTO | null
  applicableTaxRate?: number | null
  amount: MoneyDTO | null
  plannedArrivalDate: ISODateDTO | null
  note: string
  originalLineId?: string | null
  changeAmount?: MoneyDTO | null
  changeBasis?: string
  source?: ContractLineSourceEvidence | null
}

export interface MaterialContractDeductionDTO {
  id: string
  name: string
  /** 展示负额，原记录保留明确扣减正值。 */
  amount: MoneyDTO | null
  basis: string
}

export interface MaterialContractSupplementDTO {
  ourSignatorySnapshot: OurSignatorySnapshot | null
  id: string
  contractId: string
  no: string
  name: string
  content: string
  amount: MoneyDTO | null
  signDate: ISODateDTO | null
  status: string
  lineItems: MaterialContractLineDTO[]
  deductions: MaterialContractDeductionDTO[]
  originalLineSnapshots?: Array<{ originalLineId: string, parentVersion: number | null, sourceUpdatedAt?: ISODateTimeDTO, materialName: string, qty: string | null, unitPrice: MoneyDTO | null }>
}

export interface MaterialContractFileDTO {
  id: string
  fileName: string
  fileSize: number
  mimeType: string
  category: string
  uploadedAt: ISODateTimeDTO | null
  ownerId?: string
  originalAvailable?: boolean
}

export interface MaterialContractDetailReadDTO {
  meta: ReadMetaDTO
  dataOrigin: DataOriginDTO
  contract: MaterialContractDTO
  projectNavigation: NavigationIntentDTO
  supplierNavigation: NavigationIntentDTO
  sections: {
    lineItems: MaterialContractLineDTO[]
    deductions?: MaterialContractDeductionDTO[]
    supplements?: MaterialContractSupplementDTO[]
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
    changedAmount: MoneyDTO | null
    invoicedAmount: MoneyDTO | null
    paidAmount: MoneyDTO | null
  }>
}

export type MaterialContractListPageDTO = PageDTO<
  MaterialContractListItemDTO,
  MaterialContractListSummaryDTO
> & { meta: ReadMetaDTO, originMeta: Record<DataOriginDTO, ReadMetaDTO> }

export interface MaterialContractReadRepository {
  prices?: (origin: DataOriginDTO, options?: { signal?: AbortSignal }) => Promise<import('./price-facts').ContractPriceRead>
  fileContent: (ownerId: string, fileId: string, origin: DataOriginDTO, options?: { signal?: AbortSignal }) => Promise<import('../forms/original-content').ContractOriginalContent>
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
