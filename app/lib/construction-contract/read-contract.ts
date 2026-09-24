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
import type { ContractListFilter } from '../contract/list-filters'

export const CONSTRUCTION_CONTRACT_PAGE_SIZES = [10, 20, 50, 100] as const
export type ConstructionContractPageSize = typeof CONSTRUCTION_CONTRACT_PAGE_SIZES[number]
export const CONSTRUCTION_CONTRACT_DETAIL_FOCUS_SCOPES = ['supplement', 'change', 'settlement', 'acceptance'] as const
export type ConstructionContractDetailFocusScope = typeof CONSTRUCTION_CONTRACT_DETAIL_FOCUS_SCOPES[number]
export type ConstructionContractDetailFocusView = 'acceptance' | 'warranty'
export type ConstructionContractDetailFocusDTO
  = | { id: string, scope: null }
    | { id: string, scope: Exclude<ConstructionContractDetailFocusScope, 'acceptance'> }
    | { id: string, scope: 'acceptance', view: ConstructionContractDetailFocusView | null }

export interface ConstructionContractListQueryDTO {
  includeDemo: boolean
  origin: DataOriginDTO | null
  search: string
  projectId: string | null
  customerId: string | null
  status: ContractListFilter
  page: number
  pageSize: ConstructionContractPageSize
}

export interface ConstructionContractDetailQueryDTO {
  id: string
  origin: DataOriginDTO
  includeDemo: boolean
  focus: ConstructionContractDetailFocusDTO | null
}

export interface ConstructionContractDetailSource {
  dataOrigin: DataOriginDTO
  id: string
  no: string
  name: string
  kind: string
  projectId: string | null
  projectName: string
  projectPermission: 'allowed' | 'forbidden'
  customerId: string | null
  customerName: string
  customerPermission: 'allowed' | 'forbidden'
  amount: number
  settledAmount: number
  invoicedAmount: number
  receivedAmount: number | null
  actualCompletionDate: ISODateDTO | null
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

export interface ConstructionContractFactSource {
  dataOrigin: DataOriginDTO
  id: string
  contractId: string | null
  no: string
  name: string
  amount: number | null
  date: ISODateDTO | null
  status: string
  sourceId?: string | null
  ownerDocumentId?: string | null
  customerId?: string | null
}

export interface ConstructionContractFileSource {
  dataOrigin: DataOriginDTO
  id: string
  contractId: string
  fileName: string
  fileSize: number
  mimeType: string
  category: string
  uploadedAt: ISODateTimeDTO | null
}

export interface ConstructionContractFactSources {
  supplements: ConstructionContractFactSource[]
  changes: ConstructionContractFactSource[]
  monthlyStatements: ConstructionContractFactSource[]
  finalSettlements: ConstructionContractFactSource[]
  penalties: ConstructionContractFactSource[]
  invoiceApplications: ConstructionContractFactSource[]
  invoiceRegistrations: ConstructionContractFactSource[]
  receipts: ConstructionContractFactSource[]
  acceptances: ConstructionContractFactSource[]
  warranties: ConstructionContractFactSource[]
  files: ConstructionContractFileSource[]
}

export interface ConstructionContractAmountsDTO {
  contract: MoneyDTO
  changed: MoneyDTO
  settled: MoneyDTO
  invoiced: MoneyDTO
  received: MoneyDTO | null
  bySettlementReceivable: MoneyDTO | null
  invoicedUnreceived: MoneyDTO | null
}

export interface ConstructionContractDTO {
  dataOrigin: DataOriginDTO
  id: string
  no: string
  name: string
  kind: '施工'
  project: EntityRefDTO & { entity: 'project' }
  customer: EntityRefDTO & { entity: 'customer' }
  amounts: ConstructionContractAmountsDTO
  actualCompletionDate: ISODateDTO | null
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
  invoiceName: string
  invoiceTaxNo: string
  invoiceAddressPhone: string
  invoiceBank: string
  invoiceBankAccount: string
  status: string
  note: string
  updatedAt: ISODateTimeDTO
}

export interface ConstructionContractFactDTO {
  id: string
  no: string
  name: string
  amount: MoneyDTO | null
  date: ISODateDTO | null
  status: string
  navigation: NavigationIntentDTO
}

export interface ConstructionContractFileDTO {
  id: string
  fileName: string
  fileSize: number
  mimeType: string
  category: string
  uploadedAt: ISODateTimeDTO | null
}

export interface ConstructionContractDetailReadDTO {
  receiptsProblem?: ProblemDTO
  dataOrigin: DataOriginDTO
  contract: ConstructionContractDTO
  projectNavigation: NavigationIntentDTO
  customerNavigation: NavigationIntentDTO
  sections: {
    supplements: ConstructionContractFactDTO[]
    changes: ConstructionContractFactDTO[]
    settlements: {
      monthlyStatements: ConstructionContractFactDTO[]
      finalSettlements: ConstructionContractFactDTO[]
      penalties: ConstructionContractFactDTO[]
    }
    invoices: {
      applications: ConstructionContractFactDTO[]
      registrations: ConstructionContractFactDTO[]
    }
    receipts: ConstructionContractFactDTO[]
    acceptance: {
      acceptances: ConstructionContractFactDTO[]
      warranties: ConstructionContractFactDTO[]
    }
    files: ConstructionContractFileDTO[]
  }
  asOf: ISODateTimeDTO
  sourceVersion: string | null
  capabilities: string[]
}

export interface ConstructionContractListItemDTO {
  rowKey: string
  dataOrigin: DataOriginDTO
  id: string
  no: string
  name: string
  navigation: NavigationIntentDTO
  project: EntityRefDTO & { entity: 'project' }
  projectNavigation: NavigationIntentDTO
  customer: EntityRefDTO & { entity: 'customer' }
  customerNavigation: NavigationIntentDTO
  amounts: ConstructionContractAmountsDTO
  actualCompletionDate: ISODateDTO | null
  signDate: ISODateDTO | null
  status: string
  updatedAt: ISODateTimeDTO
}

export interface ConstructionContractListSummaryDTO {
  projects: Array<{ id: string, label: string }>
  customers: Array<{ id: string, label: string }>
  statuses: Array<{ value: string, count: number }>
  origins: Record<DataOriginDTO, {
    contractCount: number
    changedAmount: MoneyDTO
    invoicedAmount: MoneyDTO
    receivedAmount: MoneyDTO | null
  }>
}

export type ConstructionContractListPageDTO = PageDTO<
  ConstructionContractListItemDTO,
  ConstructionContractListSummaryDTO
> & { receiptsProblem?: ProblemDTO }

export interface ConstructionContractReadRepository {
  list: (query: ConstructionContractListQueryDTO) => Promise<ConstructionContractListPageDTO>
  get: (query: ConstructionContractDetailQueryDTO) => Promise<ConstructionContractDetailReadDTO>
}

export class ConstructionContractRepositoryProblem extends Error {
  constructor(public readonly problem: ProblemDTO, options: { cause?: unknown } = {}) {
    super(problem.message, options)
    this.name = 'ConstructionContractRepositoryProblem'
  }
}

export function constructionContractProblem(
  code: ProblemDTO['code'],
  message: string,
  retryable = false,
): ProblemDTO {
  return { code, message, retryable, fieldErrors: {}, traceId: null }
}
