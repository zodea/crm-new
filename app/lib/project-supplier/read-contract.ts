import type {
  DataOriginDTO,
  EntityRefDTO,
  ISODateDTO,
  ISODateTimeDTO,
  MoneyDTO,
  NavigationIntentDTO,
  ProblemDTO,
} from '../../types/read-model'
import type { ProjectSupplierFileRepository } from './file-content'

export const PROJECT_SUPPLIER_READ_CAPABILITY = 'project-supplier:read' as const

export interface ProjectSupplierImportResult {
  relationshipCount: number
  fileCount: number
  createdSupplierCount: number
  reusedRelationshipCount: number
}

export interface ProjectSupplierWorkbenchQueryDTO {
  projectId: string
  supplierId: string
  origin: DataOriginDTO
  includeDemo: boolean
}

export interface ProjectSupplierReadRepository extends ProjectSupplierFileRepository {
  get: (query: ProjectSupplierWorkbenchQueryDTO) => Promise<ProjectSupplierWorkbenchReadDTO>
}

export interface ProjectSupplierProjectSourceRow {
  dataOrigin: DataOriginDTO
  id: string
  name: string
  status: string
  developer: string
  manager: string
}

export interface ProjectSupplierSupplierSourceRow {
  dataOrigin: DataOriginDTO
  id: string
  name: string
  supplierCategory: string
  contact: string
  contactPhone: string
}

export interface ProjectSupplierRelationSourceRow {
  dataOrigin: DataOriginDTO
  id: string
  projectId: string
  supplierId: string
  status: string
  note: string
}

export interface ProjectSupplierContractSourceRow {
  dataOrigin: DataOriginDTO
  id: string
  projectId: string
  supplierId: string
  no: string
  name: string
  kind: string
  status: string
  amount: number
  supplementAmount: number
  signDate: ISODateDTO | null
  attachmentCount: number
}

export interface ProjectSupplierClaimSourceRow {
  dataOrigin: DataOriginDTO
  id: string
  projectId: string
  supplierId: string
  no: string
  name: string
  status: string
  applyAmount: number
  approvedAmount: number
  applyDate: ISODateDTO | null
  invoiceState: string
  attachmentCount: number
}

export interface ProjectSupplierInvoiceSourceRow {
  dataOrigin: DataOriginDTO
  id: string
  projectId: string
  supplierId: string
  invoiceNumber: string
  invoiceDate: ISODateDTO | null
  invoiceType: string
  totalAmount: number
  taxAmount: number
  accountStatus: string
  fileName: string
}

export interface ProjectSupplierPaymentRecordSourceRow {
  dataOrigin: DataOriginDTO
  id: string
  no: string
  paymentDate: ISODateDTO | null
  paymentMethod: string
  voucherNo: string
  confirmationStatus: string
  attachmentCount: number
}

export interface ProjectSupplierPaymentAllocationSourceRow {
  dataOrigin: DataOriginDTO
  id: string
  paymentRecordId: string
  paymentApplicationId: string
  allocatedAmount: number
}

export interface ProjectSupplierSettlementSourceRow {
  dataOrigin: DataOriginDTO
  id: string
  projectId: string
  supplierId: string
  no: string
  name: string
  settlementType: string
  settlementDate: ISODateDTO | null
  totalAmount: number
  status: string
  attachmentCount: number
}

export interface ProjectSupplierFileSourceRow {
  dataOrigin: DataOriginDTO
  id: string
  relationId: string
  ownerType: string
  ownerId: string
  fileName: string
  fileSize: number
  mimeType: string
  category: string
  uploader: string
  uploadedAt: ISODateTimeDTO
  hasPayload?: boolean
  sha256?: string | null
}

export interface ProjectSupplierContractDTO {
  contract: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'contract' }
  navigation: NavigationIntentDTO
  kind: string
  status: string
  amount: MoneyDTO
  effectiveAmount: MoneyDTO
  signDate: ISODateDTO | null
  attachmentCount: number
}

export interface ProjectSupplierClaimDTO {
  application: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'payment-application' }
  navigation: NavigationIntentDTO
  status: string
  applyAmount: MoneyDTO
  approvedAmount: MoneyDTO
  applyDate: ISODateDTO | null
  invoiceState: string
  attachmentCount: number
}

export interface ProjectSupplierInvoiceDTO {
  invoice: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'invoice' }
  navigation: NavigationIntentDTO
  invoiceDate: ISODateDTO | null
  invoiceType: string
  totalAmount: MoneyDTO
  taxAmount: MoneyDTO
  accountStatus: string
  fileName: string
}

export interface ProjectSupplierPaymentDTO {
  payment: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'payment-record' }
  navigation: NavigationIntentDTO
  paymentDate: ISODateDTO | null
  allocatedAmount: MoneyDTO
  paymentMethod: string
  voucherNo: string
  confirmationStatus: string
  applicationNos: string[]
  attachmentCount: number
}

export interface ProjectSupplierSettlementDTO {
  settlement: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'settlement' }
  navigation: NavigationIntentDTO
  settlementType: string
  settlementDate: ISODateDTO | null
  totalAmount: MoneyDTO
  status: string
  attachmentCount: number
}

export interface ProjectSupplierFileDTO {
  file: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'file' }
  ownerType: string
  ownerId: string
  sourceLabel: string
  navigation: NavigationIntentDTO
  fileSize: number
  mimeType: string
  category: string
  uploader: string
  uploadedAt: ISODateTimeDTO
  content?: { state: 'available' | 'missing' | 'not-connected', sha256: string | null }
}

export interface ProjectSupplierWorkbenchReadDTO {
  dataOrigin: DataOriginDTO
  relation: { id: string, status: string, note: string }
  project: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'project' }
  projectNavigation: NavigationIntentDTO
  projectProfile: { status: string, developer: string, manager: string }
  supplier: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'supplier' }
  supplierNavigation: NavigationIntentDTO
  supplierProfile: { supplierCategory: string, contact: string, contactPhone: string }
  contracts: ProjectSupplierContractDTO[]
  claims: ProjectSupplierClaimDTO[]
  invoices: ProjectSupplierInvoiceDTO[]
  payments: ProjectSupplierPaymentDTO[]
  settlements: ProjectSupplierSettlementDTO[]
  files: ProjectSupplierFileDTO[]
  summary: {
    contractTotal: MoneyDTO
    claimedTotal: MoneyDTO
    invoiceTotal: MoneyDTO
    taxTotal: MoneyDTO
    paidTotal: MoneyDTO
    settlementTotal: MoneyDTO
    balance: MoneyDTO
  }
  counts: {
    contracts: number
    claims: number
    invoices: number
    payments: number
    settlements: number
    files: number
  }
  asOf: ISODateTimeDTO
  sourceVersion: string | null
  capabilities: string[]
}

export class ProjectSupplierRepositoryProblem extends Error {
  constructor(public readonly problem: ProblemDTO, options: { cause?: unknown } = {}) {
    super(problem.message, options)
    this.name = 'ProjectSupplierRepositoryProblem'
  }
}

export function projectSupplierProblem(
  code: ProblemDTO['code'],
  message: string,
  retryable = false,
): ProblemDTO {
  return { code, message, retryable, fieldErrors: {}, traceId: null }
}
