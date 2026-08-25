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

export const SUBCONTRACT_CONTRACT_PAGE_SIZES = [10, 20, 50, 100] as const
export type SubcontractContractPageSize = typeof SUBCONTRACT_CONTRACT_PAGE_SIZES[number]

export interface SubcontractContractListQueryDTO {
  includeDemo: boolean
  origin: DataOriginDTO | null
  search: string
  projectId: string | null
  supplierId: string | null
  status: string | null
  subKind: string | null
  page: number
  pageSize: SubcontractContractPageSize
}

export interface SubcontractContractDetailQueryDTO {
  id: string
  origin: DataOriginDTO
  includeDemo: boolean
  focusId: string | null
}

export interface SubcontractContractDetailSource {
  dataOrigin: DataOriginDTO
  id: string
  no: string
  name: string
  kind: string
  subKind: string
  projectId: string | null
  projectName: string
  projectPermission: 'allowed' | 'forbidden'
  supplierId: string | null
  supplierName: string
  supplierPermission: 'allowed' | 'forbidden'
  amount: number
  settlementStatus: string | null
  clearanceStatus: string | null
  content: string
  invoiceType: string
  contactName: string
  contactPhone: string
  taxRate: number | null
  signDate: ISODateDTO | null
  mainTerms: string
  paymentTerms: string
  warrantyTerms: string
  retentionRatio: number | null
  retentionAmount: number | null
  retentionDays: number | null
  status: string
  note: string
  createdAt: ISODateTimeDTO
  updatedAt: ISODateTimeDTO
}

export type SubcontractSettlementKind = 'progress' | 'completion'
export type SubcontractContractFactKind = 'supplement' | 'change' | 'invoice' | 'payment-application' | 'payment-record' | 'settlement' | 'penalty'

export interface SubcontractContractFactSource {
  dataOrigin: DataOriginDTO
  id: string
  contractId: string | null
  no: string
  name: string
  amount: number | null
  date: ISODateDTO | null
  status: string
  settlementKind?: SubcontractSettlementKind
}

export interface SubcontractContractFileSource {
  dataOrigin: DataOriginDTO
  id: string
  contractId: string
  fileName: string
  fileSize: number
  mimeType: string
  category: string
  uploadedAt: ISODateTimeDTO | null
}

export interface SubcontractContractFactSources {
  supplements: SubcontractContractFactSource[]
  changes: SubcontractContractFactSource[]
  invoices: SubcontractContractFactSource[]
  paymentApplications: SubcontractContractFactSource[]
  paymentRecords: SubcontractContractFactSource[]
  settlements: SubcontractContractFactSource[]
  penalties: SubcontractContractFactSource[]
  files: SubcontractContractFileSource[]
}

export interface SubcontractContractAmountsDTO {
  contract: MoneyDTO
  changed: MoneyDTO
  settled: MoneyDTO
  invoiced: MoneyDTO
  paid: MoneyDTO
  bySettlementPayable: MoneyDTO
  byInvoicePayable: MoneyDTO
  completionSettlement: MoneyDTO
}

export interface SubcontractContractDTO {
  dataOrigin: DataOriginDTO
  id: string
  no: string
  name: string
  kind: '分包'
  subKind: string
  project: EntityRefDTO & { entity: 'project' }
  supplier: EntityRefDTO & { entity: 'supplier' }
  amounts: SubcontractContractAmountsDTO
  settlementStatus: string | null
  clearanceStatus: string | null
  content: string
  invoiceType: string
  contactName: string
  contactPhone: string
  taxRate: number | null
  signDate: ISODateDTO | null
  mainTerms: string
  paymentTerms: string
  warrantyTerms: string
  retentionRatio: RatioDTO | null
  retentionAmount: MoneyDTO | null
  retentionDays: number | null
  status: string
  note: string
  updatedAt: ISODateTimeDTO
}

export interface SubcontractContractFactDTO {
  id: string
  no: string
  name: string
  amount: MoneyDTO | null
  date: ISODateDTO | null
  status: string
  navigation: NavigationIntentDTO
}

export interface SubcontractContractFileDTO {
  id: string
  fileName: string
  fileSize: number
  mimeType: string
  category: string
  uploadedAt: ISODateTimeDTO | null
}

export interface SubcontractContractDetailReadDTO {
  dataOrigin: DataOriginDTO
  contract: SubcontractContractDTO
  projectNavigation: NavigationIntentDTO
  supplierNavigation: NavigationIntentDTO
  sections: {
    supplements: SubcontractContractFactDTO[]
    changes: SubcontractContractFactDTO[]
    invoices: SubcontractContractFactDTO[]
    payments: {
      applications: SubcontractContractFactDTO[]
      records: SubcontractContractFactDTO[]
    }
    settlements: {
      progress: SubcontractContractFactDTO[]
      completion: SubcontractContractFactDTO[]
    }
    penalties: SubcontractContractFactDTO[]
    materialUses: {
      currentWarehouse: SubcontractContractFactDTO[]
      legacy: SubcontractContractFactDTO[]
      emptyReason: 'missing-relation'
    }
    files: SubcontractContractFileDTO[]
  }
  asOf: ISODateTimeDTO
  sourceVersion: string | null
  capabilities: string[]
}

export interface SubcontractContractListItemDTO {
  rowKey: string
  dataOrigin: DataOriginDTO
  id: string
  no: string
  name: string
  navigation: NavigationIntentDTO
  subKind: string
  project: EntityRefDTO & { entity: 'project' }
  projectNavigation: NavigationIntentDTO
  supplier: EntityRefDTO & { entity: 'supplier' }
  supplierNavigation: NavigationIntentDTO
  amounts: SubcontractContractAmountsDTO
  signDate: ISODateDTO | null
  status: string
  settlementStatus: string | null
  clearanceStatus: string | null
  updatedAt: ISODateTimeDTO
}

export interface SubcontractContractListSummaryDTO {
  projects: Array<{ id: string, label: string }>
  suppliers: Array<{ id: string, label: string }>
  statuses: Array<{ value: string, count: number }>
  subKinds: Array<{ value: string, count: number }>
  origins: Record<DataOriginDTO, {
    contractCount: number
    changedAmount: MoneyDTO
    settledAmount: MoneyDTO
    paidAmount: MoneyDTO
  }>
}

export type SubcontractContractListPageDTO = PageDTO<
  SubcontractContractListItemDTO,
  SubcontractContractListSummaryDTO
>

export interface SubcontractContractReadRepository {
  list: (query: SubcontractContractListQueryDTO) => Promise<SubcontractContractListPageDTO>
  get: (query: SubcontractContractDetailQueryDTO) => Promise<SubcontractContractDetailReadDTO>
}

export class SubcontractContractRepositoryProblem extends Error {
  constructor(public readonly problem: ProblemDTO, options: { cause?: unknown } = {}) {
    super(problem.message, options)
    this.name = 'SubcontractContractRepositoryProblem'
  }
}

export function subcontractContractProblem(
  code: ProblemDTO['code'],
  message: string,
  retryable = false,
): ProblemDTO {
  return { code, message, retryable, fieldErrors: {}, traceId: null }
}
