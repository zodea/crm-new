import type {
  DataOriginDTO,
  EntityRefDTO,
  ISODateDTO,
  ISODateTimeDTO,
  MoneyDTO,
  NavigationIntentDTO,
  PageDTO,
  ProblemDTO,
} from '../../types/read-model'

export const CUSTOMER_PAGE_SIZES = [10, 20, 50, 100] as const

export type CustomerPageSize = typeof CUSTOMER_PAGE_SIZES[number]
export type CustomerListSort = 'updated-desc' | 'name-asc' | 'name-desc'

export interface CustomerListQueryDTO {
  includeDemo: boolean
  search: string
  status: string | string[] | null
  sort: CustomerListSort
  page: number
  pageSize: CustomerPageSize
}

export interface CustomerDetailQueryDTO {
  id: string
  origin: DataOriginDTO
  includeDemo: boolean
}

export interface CustomerListSourceRow {
  dataOrigin: DataOriginDTO
  id: string
  name: string
  aliases: string[]
  taxNo: string
  legalRep: string
  registeredAddress: string
  invoiceName: string
  bank: string
  bankAccount: string
  contact: string
  contactPhone: string
  status: string
  note: string
  updatedAt: string
}

export interface CustomerListItemDTO {
  dataOrigin: DataOriginDTO
  customer: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'customer' }
  navigation: Extract<NavigationIntentDTO, { kind: 'entity-detail' }> & {
    subject: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'customer' }
    variant: 'detail'
  }
  aliases: string[]
  taxNo: string
  contact: string
  contactPhone: string
  status: string
  updatedAt: string
}

export interface CustomerListSummaryDTO {
  statuses: Array<{ value: string, label: string, count: number }>
  origins: Record<DataOriginDTO, { customerCount: number }>
}

export type CustomerListPageDTO = PageDTO<CustomerListItemDTO, CustomerListSummaryDTO>

export interface CustomerReadRepository {
  list: (query: CustomerListQueryDTO) => Promise<CustomerListPageDTO>
  get: (query: CustomerDetailQueryDTO) => Promise<CustomerDetailReadDTO>
  getReceipt: (query: CustomerReceiptDetailQueryDTO) => Promise<CustomerReceiptDetailReadDTO>
}

export interface CustomerReceiptDetailQueryDTO {
  id: string
  customerId: string
  origin: DataOriginDTO
  includeDemo: boolean
}

export interface CustomerProjectSourceRow {
  dataOrigin: DataOriginDTO
  id: string
  name: string
  code: string
  customerId: string | null
  secondaryCustomerId: string | null
  permission: 'allowed' | 'forbidden'
  status: string
  startDate: ISODateDTO | null
  plannedEnd: ISODateDTO | null
  manager: string
}

export interface CustomerContractSourceRow {
  projectPermission?: 'allowed' | 'forbidden'
  dataOrigin: DataOriginDTO
  id: string
  no: string
  name: string
  projectId: string | null
  customerId: string | null
  amount: number
  supplementAmount: number
  receiptAmount: number
  signDate: ISODateDTO | null
  status: string
}

export interface CustomerReceiptSourceRow {
  dataOrigin: DataOriginDTO
  id: string
  no: string
  customerId: string
  projectId: string | null
  contractId: string | null
  payerAccount: string
  amount: number
  paymentMethod: string
  receiptDate: ISODateDTO | null
  status: string
}

export interface CustomerProjectDTO {
  project: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'project' }
  navigation: NavigationIntentDTO
  code: string
  relationRole: '主客户' | '次客户'
  status: string
  startDate: ISODateDTO | null
  plannedEnd: ISODateDTO | null
  manager: string
  contractCount: number | null
  effectiveContractAmount: MoneyDTO | null
  receiptCount: number | null
  effectiveReceiptAmount: MoneyDTO | null
}

export interface CustomerContractDTO {
  contract: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'contract' }
  navigation: NavigationIntentDTO
  project: EntityRefDTO & { entity: 'project' }
  projectNavigation: NavigationIntentDTO
  effectiveAmount: MoneyDTO
  receiptAmount: MoneyDTO | null
  outstandingAmount: MoneyDTO | null
  signDate: ISODateDTO | null
  status: string
  isDraft: boolean
}

export interface CustomerReceiptDTO {
  receipt: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'receipt' }
  navigation: NavigationIntentDTO
  project: EntityRefDTO & { entity: 'project' }
  projectNavigation: NavigationIntentDTO
  contract: EntityRefDTO & { entity: 'contract' }
  contractNavigation: NavigationIntentDTO
  receiptDate: ISODateDTO | null
  payerAccount: string
  amount: MoneyDTO
  effectiveAmount: MoneyDTO
  paymentMethod: string
  status: string
  isDraft: boolean
}

export interface CustomerReceiptDetailReadDTO {
  dataOrigin: DataOriginDTO
  receipt: CustomerReceiptDTO
  customer: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'customer' }
  customerNavigation: Extract<NavigationIntentDTO, { kind: 'entity-detail' }>
  asOf: ISODateTimeDTO
  sourceVersion: string | null
  capabilities: string[]
}

export interface CustomerDetailSummaryDTO {
  projectCount: number | null
  contractCount: number | null
  effectiveContractAmount: MoneyDTO | null
  receiptCount: number | null
  effectiveReceiptAmount: MoneyDTO | null
  outstandingAmount: MoneyDTO | null
  draftReceiptCount: number | null
}

export interface CustomerDetailReadDTO {
  receiptsProblem?: ProblemDTO
  contractsProblem?: ProblemDTO
  projectsProblem?: ProblemDTO
  dataOrigin: DataOriginDTO
  customer: CustomerListSourceRow
  projects: CustomerProjectDTO[]
  contracts: CustomerContractDTO[]
  receipts: CustomerReceiptDTO[]
  summary: CustomerDetailSummaryDTO
  asOf: ISODateTimeDTO
  sourceVersion: string | null
  capabilities: string[]
}

export class CustomerRepositoryProblem extends Error {
  constructor(public readonly problem: ProblemDTO, options: { cause?: unknown } = {}) {
    super(problem.message, options)
    this.name = 'CustomerRepositoryProblem'
  }
}

export function customerProblem(
  code: ProblemDTO['code'],
  message: string,
  retryable = false,
): ProblemDTO {
  return { code, message, retryable, fieldErrors: {}, traceId: null }
}
