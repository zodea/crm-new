import type { CentralInvoiceFields, CentralInvoiceItem, InvoiceContractReference } from './central-contract'

/** 历史无已核实主体身份时保留 null，不能从票面名称倒推。 */
export interface InvoiceCorrectionBuyer { id: string, version: string }
export interface InvoiceCorrectionContent {
  fields: CentralInvoiceFields
  items: CentralInvoiceItem[]
  ownerKind: 'project' | 'personal' | 'company'
  projectId: string | null
  supplierId: string | null
  supplierVersion: string | null
  buyer: InvoiceCorrectionBuyer | null
  contract: InvoiceContractReference | null
}
export interface InvoiceCorrectionChange {
  path: string
  before: unknown
  after: unknown
}
export interface InvoiceCorrectionAttachment {
  id: string
  fileName: string
  fileSize: number
  mimeType: string
  sha256: string
}
export interface InvoiceCorrectionDraft {
  id: string
  invoiceId: string
  baseInvoiceVersion: string
  version: string
  state: 'draft' | 'submitted'
  baseline: InvoiceCorrectionContent
  proposed: InvoiceCorrectionContent
  reason: string
  attachments: InvoiceCorrectionAttachment[]
  createdAt: string
  updatedAt: string
  submittedAt: string | null
  resultInvoiceVersion: string | null
}
export interface InvoiceCorrectionFileInput { fileName: string, fileSize: number, mimeType: string, payloadBase64: string }
export interface InvoiceCorrectionSaveCommand {
  action: 'save-draft'
  workspaceId: string
  actorId: string
  commandId: string
  requiredCapability: 'finance-invoice:write'
  invoiceId: string
  baseInvoiceVersion: string
  correctionId: string | null
  baseCorrectionVersion: string | null
  reason: string
  proposed: InvoiceCorrectionContent
  keepFileIds: string[]
  addFiles: InvoiceCorrectionFileInput[]
}
export interface InvoiceCorrectionResult {
  commandId: string
  correctionId: string
  invoiceId: string
  version: string
  updatedAt: string
}
export interface InvoiceCorrectionSubmitCommand {
  action: 'submit'
  workspaceId: string
  actorId: string
  commandId: string
  requiredCapability: 'finance-invoice:write'
  invoiceId: string
  baseInvoiceVersion: string
  correctionId: string
  baseCorrectionVersion: string
  confirmed: true
}
export interface InvoiceCorrectionSubmitResult extends InvoiceCorrectionResult { invoiceVersion: string }
export interface InvoiceCorrectionResolutionRequest {
  workspaceId: string
  actorId: string
  commandId: string
  action: 'save-draft' | 'submit'
  invoiceId: string
  correctionId: string | null
}

const fieldNames: ReadonlyArray<keyof CentralInvoiceFields> = ['invoiceNumber', 'invoiceDate', 'invoiceType', 'buyer', 'buyerTaxNo', 'seller', 'sellerTaxNo', 'amount', 'taxAmount', 'totalAmount', 'taxRate', 'remark']
const itemNames: ReadonlyArray<keyof CentralInvoiceItem> = ['name', 'spec', 'unit', 'quantity', 'unitPrice', 'amount', 'taxRate', 'taxAmount']

function sameItems(left: CentralInvoiceItem[], right: CentralInvoiceItem[]) {
  return left.length === right.length && left.every((item, index) => itemNames.every(name => item[name] === right[index]?.[name]))
}
function sameBuyer(left: InvoiceCorrectionBuyer | null, right: InvoiceCorrectionBuyer | null) {
  return left === null || right === null ? left === right : left.id === right.id && left.version === right.version
}
function sameContract(left: InvoiceContractReference | null, right: InvoiceContractReference | null) {
  return left === null || right === null ? left === right : left.domain === right.domain && left.id === right.id && left.version === right.version
}

/** 对照真实原值；null、零及空文本保持各自含义。 */
export function invoiceCorrectionChanges(before: InvoiceCorrectionContent, after: InvoiceCorrectionContent): InvoiceCorrectionChange[] {
  const changes: InvoiceCorrectionChange[] = []
  for (const field of fieldNames) {
    if (before.fields[field] !== after.fields[field])
      changes.push({ path: `fields.${field}`, before: before.fields[field], after: after.fields[field] })
  }
  if (!sameItems(before.items, after.items))
    changes.push({ path: 'items', before: before.items.map(item => ({ ...item })), after: after.items.map(item => ({ ...item })) })
  for (const key of ['ownerKind', 'projectId', 'supplierId'] as const) {
    if (before[key] !== after[key])
      changes.push({ path: key, before: before[key], after: after[key] })
  }
  if (!sameBuyer(before.buyer, after.buyer))
    changes.push({ path: 'buyer', before: before.buyer ? { ...before.buyer } : null, after: after.buyer ? { ...after.buyer } : null })
  if (!sameContract(before.contract, after.contract))
    changes.push({ path: 'contract', before: before.contract ? { ...before.contract } : null, after: after.contract ? { ...after.contract } : null })
  return changes
}
