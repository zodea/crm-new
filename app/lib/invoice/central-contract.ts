import type { ProblemDTO } from '../../types/read-model'

export const INVOICE_READ_CAPABILITY = 'finance-invoice:read' as const
export const INVOICE_WRITE_CAPABILITY = 'finance-invoice:write' as const
export const INVOICE_ORIGINAL_MAX_BYTES = 10 * 1024 * 1024
export type InvoiceContractDomain = 'construction' | 'subcontract' | 'material' | 'auxiliary' | 'company'
export interface InvoiceContractReference { domain: InvoiceContractDomain, id: string, version: string }
export interface InvoiceTaxVerificationSelection { buyerId: string, buyerVersion: string, supplierVersion: string }

/** 草稿中的金额未知时必须保留 null；实际零与未知不是同一事实。 */
export interface CentralInvoiceFields {
  invoiceNumber: string
  invoiceDate: string
  invoiceType: string
  buyer: string
  buyerTaxNo: string
  seller: string
  sellerTaxNo: string
  amount: number | null
  taxAmount: number | null
  totalAmount: number | null
  taxRate: string
  remark: string
}

/** 无法辨认的数量、单价和金额保持 null，不由识别器补成零。 */
export interface CentralInvoiceItem {
  name: string
  spec: string
  unit: string
  quantity: number | null
  unitPrice: number | null
  amount: number | null
  taxRate: string
  taxAmount: number | null
}

export interface CentralInvoiceOriginalInput {
  fileName: string
  fileSize: number
  mimeType: string
  contentBase64: string
}

export interface CentralInvoiceImportSource {
  fileName: string
  fileDigest: string
  sheetName: string
  rowNumber: number
  rawSnapshot: Record<string, string | number | boolean | null>
}

export const RECORD_ORIGINAL_VERIFICATION = 'record-original-verification-candidate' as const
export const CONFIRM_ORIGINAL_VERIFICATION = 'confirm-original-verification' as const

export interface InvoiceOriginalVerificationRead {
  candidateId: string
  source: 'local' | 'cloud'
  state: 'incomplete' | 'different' | 'ready' | 'confirmed' | 'stale'
  rows: Array<{ path: string, archived: string | number | null, recognized: string | number | null, result: 'match' | 'missing' | 'different' }>
  unrecognizedPageIndexes: number[]
}

interface InvoiceCommandBase {
  workspaceId: string
  actorId: string
  commandId: string
  requiredCapability: typeof INVOICE_WRITE_CAPABILITY
}

export type CentralInvoiceCommand = InvoiceCommandBase & (
  | { action: 'upload', baseVersion: null, projectId: string, original: CentralInvoiceOriginalInput }
  | { action: 'upload', baseVersion: null, ownerKind: 'company', projectId: null, original: CentralInvoiceOriginalInput }
  | { action: 'manual', baseVersion: null, fields: CentralInvoiceFields, items: CentralInvoiceItem[] }
  | { action: 'import', baseVersion: null, fields: CentralInvoiceFields, items: CentralInvoiceItem[], ownerKind: 'project' | 'personal', projectId: string | null, supplierId: string | null, source: CentralInvoiceImportSource, confirmed: true, taxNumbersConfirmed?: true, taxVerification?: InvoiceTaxVerificationSelection }
  | { action: 'import-replace', invoiceId: string, baseVersion: string, fields: CentralInvoiceFields, items: CentralInvoiceItem[], ownerKind: 'project' | 'personal', projectId: string | null, supplierId: string | null, source: CentralInvoiceImportSource, confirmed: true, taxNumbersConfirmed?: true, taxVerification?: InvoiceTaxVerificationSelection }
  | { action: 'attach-original', invoiceId: string, baseVersion: string, original: CentralInvoiceOriginalInput, confirmed: true }
  | { action: typeof RECORD_ORIGINAL_VERIFICATION, invoiceId: string, baseVersion: string, originalId: string, originalSha256: string, source: 'local' | 'cloud', textPages: string[], unrecognizedPageIndexes: number[] }
  | { action: typeof CONFIRM_ORIGINAL_VERIFICATION, invoiceId: string, baseVersion: string, originalId: string, originalSha256: string, candidateId: string, confirmed: true }
  | { action: 'link-contract', invoiceId: string, baseVersion: string, contract: InvoiceContractReference | null, confirmed: true }
  | { action: 'confirm-legacy', invoiceId: string, baseVersion: string, confirmed: true }
  | { action: 'recognize', invoiceId: string, baseVersion: string, fields: CentralInvoiceFields, items: CentralInvoiceItem[], source: 'local' | 'cloud', textPages: string[], unrecognizedPageIndexes: number[] }
  | { action: 'rerecognize', invoiceId: string, baseVersion: string, fields: CentralInvoiceFields, items: CentralInvoiceItem[], currentFields: CentralInvoiceFields, currentItems: CentralInvoiceItem[], source: 'local' | 'cloud', textPages: string[], unrecognizedPageIndexes: number[], confirmed: true }
  | { action: 'edit', invoiceId: string, baseVersion: string, fields: CentralInvoiceFields, items: CentralInvoiceItem[] }
  | { action: 'review', invoiceId: string, baseVersion: string, manualCompletion: boolean }
  | { action: 'archive', invoiceId: string, baseVersion: string, ownerKind: 'project' | 'personal', projectId: string | null, supplierId: string | null, taxNumbersConfirmed?: true, taxVerification?: InvoiceTaxVerificationSelection, contract?: InvoiceContractReference }
  | { action: 'archive', invoiceId: string, baseVersion: string, ownerKind: 'company', projectId: null, supplierId: string, contract: InvoiceContractReference & { domain: 'company' }, taxNumbersConfirmed: true, taxVerification: InvoiceTaxVerificationSelection }
  | { action: 'edit-archived', invoiceId: string, baseVersion: string, fields: CentralInvoiceFields, items: CentralInvoiceItem[], ownerKind: 'project' | 'personal', projectId: string | null, supplierId: string | null, confirmed: true }
  | { action: 'discard' | 'restore', invoiceId: string, baseVersion: string }
)

export interface CentralInvoiceCommandResult {
  invoiceId: string
  commandId: string
  version: string
  updatedAt: string
  originalId: string | null
  verificationSha256?: string
}

export interface CentralInvoicePrintCommand extends InvoiceCommandBase {
  action: 'record-printed'
  targets: Array<{ invoiceId: string, baseVersion: string, rotation: 0 | 90 | 180 | 270 }>
}

export interface CentralInvoicePrintResult {
  commandId: string
  updatedAt: string
  records: Array<{ invoiceId: string, version: string, printCount: number, printRotation: 0 | 90 | 180 | 270 }>
}

export interface CentralInvoiceRecord {
  id: string
  version: string
  sourceKind: 'scan' | 'manual' | 'excel' | 'legacy'
  fields: CentralInvoiceFields
  items: CentralInvoiceItem[]
  unrecognizedPageIndexes: number[]
  ocrStatus: 'pending' | 'failed' | 'done'
  completionMethod: 'ocr' | 'manual' | 'legacy' | null
  reviewStatus: 'unreviewed' | 'reviewed'
  accountStatus: 'none' | 'archived'
  duplicateStatus: 'normal' | 'duplicate'
  printCount: number
  printRotation: 0 | 90 | 180 | 270
  ownerKind: 'project' | 'personal' | 'company' | null
  projectId: string | null
  supplierId: string | null
  contract: InvoiceContractReference | null
  archivedAt: string | null
  original: { id: string, fileName: string, fileSize: number, mimeType: string, sha256: string } | null
  originalVerificationId?: string
  legacy?: { source: 'scan' | 'excel', originalState: 'recorded' | 'legacy-path-unverified' | 'session-original-unavailable' | 'no-original-recorded', ambiguousZeroFields: Array<'amount' | 'tax_amount' | 'total_amount'>, ambiguousItemNumbers: boolean }
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export class CentralInvoiceProblem extends Error {
  readonly problem: ProblemDTO

  constructor(code: ProblemDTO['code'], message: string) {
    super(message)
    this.name = 'CentralInvoiceProblem'
    this.problem = { code, message, retryable: code === 'unavailable', fieldErrors: {}, traceId: null }
  }
}
