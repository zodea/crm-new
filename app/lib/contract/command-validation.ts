import type {
  ContractFormAttachment,
  ContractFormAttachmentChanges,
  ContractFormAttachmentDraft,
  ContractLineItemDraft,
  ProjectContractFormDraft,
} from './forms'
import { isISODateDTO, isISODateTimeDTO } from '../../types/read-model'

const DRAFT_FIELDS = new Set(['id', 'isSupplement', 'originalContractId', 'no', 'name', 'projectId', 'customerId', 'supplierId', 'subKind', 'content', 'invoiceType', 'contactName', 'contactPhone', 'taxRate', 'signDate', 'mainTerms', 'paymentTerms', 'brandQualityTerms', 'scheduleTerms', 'warrantyTerms', 'specialTerms', 'retentionRatio', 'retentionAmount', 'retentionDays', 'invoiceName', 'invoiceTaxNo', 'invoiceAddressPhone', 'invoiceBank', 'invoiceBankAccount', 'otherExpenseKind', 'servicePeriod', 'paymentCycle', 'amount', 'status', 'note', 'lineItems'])
const TEXT_FIELDS = new Set(['no', 'name', 'subKind', 'content', 'invoiceType', 'contactName', 'contactPhone', 'mainTerms', 'paymentTerms', 'brandQualityTerms', 'scheduleTerms', 'warrantyTerms', 'specialTerms', 'invoiceName', 'invoiceTaxNo', 'invoiceAddressPhone', 'invoiceBank', 'invoiceBankAccount', 'otherExpenseKind', 'servicePeriod', 'paymentCycle', 'status', 'note'])
const NULLABLE_TEXT_FIELDS = new Set(['originalContractId', 'projectId', 'customerId', 'supplierId'])
const NUMBER_FIELDS = new Set(['taxRate', 'retentionRatio', 'retentionAmount', 'retentionDays', 'amount'])
const LINE_FIELDS = new Set(['id', 'materialName', 'spec', 'brand', 'unit', 'qty', 'taxInclusiveUnitPrice', 'plannedArrivalDate', 'note', 'sortOrder'])
const LINE_TEXT_FIELDS = new Set(['materialName', 'spec', 'brand', 'unit', 'note'])
const ATTACHMENT_CHANGE_FIELDS = new Set(['add', 'removeIds', 'restoreIds'])
const ATTACHMENT_DRAFT_FIELDS = new Set(['fileName', 'filePath', 'fileSize', 'mimeType', 'category', 'uploader'])

interface DecodeOptions {
  entityLabel: string
  lineItemLabel: string
  allowLineItems: boolean
  allowSupplier: boolean
  fail: (message: string) => never
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function onlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>) {
  return Object.keys(value).every(key => allowed.has(key))
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function decodeLine(value: unknown, options: DecodeOptions): ContractLineItemDraft {
  if (!object(value) || !onlyKeys(value, LINE_FIELDS))
    return options.fail(`${options.lineItemLabel}无效`)
  for (const [field, fieldValue] of Object.entries(value)) {
    if (field === 'id' && (typeof fieldValue !== 'string' || !fieldValue.trim()))
      return options.fail(`${options.lineItemLabel} ID 无效`)
    if (LINE_TEXT_FIELDS.has(field) && typeof fieldValue !== 'string')
      return options.fail(`${field} 必须是文本`)
    if ((field === 'qty' || field === 'taxInclusiveUnitPrice') && fieldValue !== null && !finiteNumber(fieldValue))
      return options.fail(`${field} 必须是有限数值或 null`)
    if (field === 'plannedArrivalDate' && (typeof fieldValue !== 'string' || (fieldValue !== '' && !isISODateDTO(fieldValue))))
      return options.fail('plannedArrivalDate 必须是 ISO 日期')
    if (field === 'sortOrder' && (!Number.isSafeInteger(fieldValue) || Number(fieldValue) < 0))
      return options.fail('sortOrder 必须是非负安全整数')
  }
  return { ...value } as ContractLineItemDraft
}

export function decodeProjectContractDraft(value: unknown, options: DecodeOptions): ProjectContractFormDraft {
  if (!object(value) || !onlyKeys(value, DRAFT_FIELDS))
    return options.fail(`未知${options.entityLabel}字段或表单无效`)
  for (const [field, fieldValue] of Object.entries(value)) {
    if (field === 'id' && (typeof fieldValue !== 'string' || !fieldValue.trim()))
      return options.fail(`${options.entityLabel} ID 无效`)
    if (field === 'isSupplement' && typeof fieldValue !== 'boolean')
      return options.fail('isSupplement 必须是布尔值')
    if (TEXT_FIELDS.has(field) && typeof fieldValue !== 'string')
      return options.fail(`${field} 必须是文本`)
    if (NULLABLE_TEXT_FIELDS.has(field) && fieldValue !== null && typeof fieldValue !== 'string')
      return options.fail(`${field} 必须是文本或 null`)
    if (NUMBER_FIELDS.has(field) && fieldValue !== null && !finiteNumber(fieldValue))
      return options.fail(`${field} 必须是有限数值或 null`)
    if (field === 'signDate' && (typeof fieldValue !== 'string' || (fieldValue !== '' && !isISODateDTO(fieldValue))))
      return options.fail('signDate 必须是 ISO 日期')
    if (field === 'lineItems' && !Array.isArray(fieldValue))
      return options.fail(`${options.lineItemLabel}无效`)
  }
  if (value.supplierId && !options.allowSupplier)
    return options.fail(`${options.entityLabel}不接受分供方关系`)
  if (Array.isArray(value.lineItems) && value.lineItems.length && !options.allowLineItems)
    return options.fail(`${options.entityLabel}不接受采购明细`)
  return {
    ...value,
    lineItems: options.allowLineItems && Array.isArray(value.lineItems)
      ? value.lineItems.map(item => decodeLine(item, options))
      : undefined,
  } as ProjectContractFormDraft
}

function decodeAttachmentDraft(value: unknown, options: DecodeOptions): ContractFormAttachmentDraft {
  if (!object(value) || !onlyKeys(value, ATTACHMENT_DRAFT_FIELDS) || typeof value.fileName !== 'string' || !value.fileName.trim())
    return options.fail('新增附件无效')
  for (const field of ['filePath', 'mimeType', 'category', 'uploader']) {
    if (value[field] !== undefined && typeof value[field] !== 'string')
      return options.fail(`${field} 必须是文本`)
  }
  if (value.fileSize !== undefined && (!finiteNumber(value.fileSize) || value.fileSize < 0))
    return options.fail('fileSize 必须是非负有限数值')
  return { fileName: value.fileName, ...(typeof value.filePath === 'string' ? { filePath: value.filePath } : {}), ...(typeof value.fileSize === 'number' ? { fileSize: value.fileSize } : {}), ...(typeof value.mimeType === 'string' ? { mimeType: value.mimeType } : {}), ...(typeof value.category === 'string' ? { category: value.category } : {}), ...(typeof value.uploader === 'string' ? { uploader: value.uploader } : {}) }
}

function decodeIds(value: unknown, label: string, options: DecodeOptions): string[] {
  if (!Array.isArray(value) || !value.every(id => typeof id === 'string' && Boolean(id.trim())))
    return options.fail(`${label}无效`)
  return [...value]
}

export function decodeContractAttachmentChanges(value: unknown, options: DecodeOptions): ContractFormAttachmentChanges {
  if (!object(value) || !onlyKeys(value, ATTACHMENT_CHANGE_FIELDS))
    return options.fail('附件变更无效')
  if (value.add !== undefined && !Array.isArray(value.add))
    return options.fail('新增附件无效')
  return { add: (value.add ?? []).map(item => decodeAttachmentDraft(item, options)), removeIds: decodeIds(value.removeIds ?? [], '删除附件 ID', options), restoreIds: decodeIds(value.restoreIds ?? [], '恢复附件 ID', options) }
}

export function decodeContractAttachment(value: unknown, ownerId: string, options: DecodeOptions): ContractFormAttachment {
  if (!object(value) || typeof value.id !== 'string' || !value.id || value.ownerType !== 'contract' || value.ownerId !== ownerId || typeof value.fileName !== 'string' || typeof value.filePath !== 'string' || !finiteNumber(value.fileSize) || value.fileSize < 0 || typeof value.mimeType !== 'string' || typeof value.category !== 'string' || typeof value.uploader !== 'string' || !isISODateTimeDTO(value.uploadedAt) || !(value.deletedAt === null || isISODateTimeDTO(value.deletedAt)))
    return options.fail(`${options.entityLabel}附件无效`)
  return { ...value } as unknown as ContractFormAttachment
}
