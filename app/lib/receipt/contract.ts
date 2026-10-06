import type { DataOriginDTO, EntityRefDTO, MoneyDTO, ProblemDTO, ReadMetaDTO } from '../../types/read-model'
import type { FileRefChanges, FileRefRecord } from '../forms/file-refs'

export const RECEIPT_READ_CAPABILITY = 'receipt:read' as const
export const RECEIPT_WRITE_CAPABILITY = 'receipt:write' as const
export type ReceiptAction = 'draft' | 'save' | 'submit'

export interface ReceiptDraft {
  no: string
  receiptDate: string
  projectId: string | null
  contractId: string | null
  customerId: string | null
  payerAccount: string
  amount: MoneyDTO | null
  paymentMethod: string
  acceptanceBillNo: string
  billDueDate: string
  periodNo: string
  bankSerialNo: string
  handler: string
  reviewStatus: string
  status: string
  note: string
}

export interface ReceiptReferenceFacts {
  projects: Array<{ id: string, name: string, customerId: string | null }>
  customers: Array<{ id: string, name: string }>
  contracts: Array<{ id: string, no: string, name: string, projectId: string | null, customerId: string | null, amount: MoneyDTO | null, status: string }>
}

export interface ReceiptRecord {
  id: string
  dataOrigin: DataOriginDTO
  draft: ReceiptDraft
  version: string
  attachments: FileRefRecord[]
  createdAt: string
  updatedAt: string
  createdBy: string
  updatedBy: string
}
export function emptyReceiptDraft(): ReceiptDraft {
  return {
    no: '',
    receiptDate: '',
    projectId: null,
    contractId: null,
    customerId: null,
    payerAccount: '',
    amount: null,
    paymentMethod: '',
    acceptanceBillNo: '',
    billDueDate: '',
    periodNo: '',
    bankSerialNo: '',
    handler: '',
    reviewStatus: '待审核',
    status: 'draft',
    note: '',
  }
}

export interface ReceiptCommand {
  id?: string
  workspaceId: string
  actorId: string
  requiredCapability: typeof RECEIPT_WRITE_CAPABILITY
  commandId: string
  baseVersion: string | null
  origin: DataOriginDTO
  action: ReceiptAction
  draft: ReceiptDraft
  attachments: FileRefChanges
}

export interface ReceiptCommandResult {
  id: string
  commandId: string
  version: string
  updatedAt: string
  attachmentIds: string[]
}
export interface ReceiptContext extends ReceiptReferenceFacts {
  workspaceId: string
  actorId: string
  capabilities: readonly string[]
}
export interface ReceiptDetail {
  meta: ReadMetaDTO
  record: ReceiptRecord
  category: null
  receiptType: null
  project: EntityRefDTO
  customer: EntityRefDTO
  contract: EntityRefDTO
  amounts: { contractOriginal: MoneyDTO | null, contractChange: MoneyDTO | null, contract: MoneyDTO | null, cumulativeReceipt: MoneyDTO | null, cumulativeReceiptExcludingCurrent: MoneyDTO | null, receiptRatio: string | null, invoicedUnreceived: MoneyDTO | null }
  contractProblem?: ProblemDTO
  capabilities: readonly string[]
  asOf: string
  sourceVersion: string | null
}
export interface ReceiptPage {
  meta: ReadMetaDTO
  originMeta: Record<DataOriginDTO, ReadMetaDTO>
  asOf: string
  sourceVersion: string | null
  items: ReceiptDetail[]
  pagination: { requestedPage: number, page: number, pageSize: number, total: number }
  summary: { origins: Record<DataOriginDTO, { count: number, effectiveAmount: MoneyDTO | null }> }
  projectOptions: Array<{ id: string, name: string, dataOrigin: DataOriginDTO }>
  capabilities: readonly string[]
}
export interface ReceiptFileContent {
  receiptId: string
  fileId: string
  dataOrigin: DataOriginDTO
  fileSize: number
  sha256: string
  payloadBase64: string
  mimeType: string
  fileName: string
}

export class ReceiptRepositoryProblem extends Error {
  constructor(readonly problem: ProblemDTO) {
    super(problem.message)
    this.name = 'ReceiptRepositoryProblem'
  }
}

export function receiptProblem(code: ProblemDTO['code'], message: string, fieldErrors: Record<string, string[]> = {}, retryable = false): ReceiptRepositoryProblem {
  return new ReceiptRepositoryProblem({ code, message, fieldErrors, retryable, traceId: null })
}
