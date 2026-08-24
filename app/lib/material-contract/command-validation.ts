import type {
  ContractFormAttachment,
  ContractFormAttachmentChanges,
  ContractFormAttachmentDraft,
  ContractLineItemDraft,
  ProjectContractFormDraft,
} from '../contract/forms'
import { isISODateDTO, isISODateTimeDTO } from '../../types/read-model'

const DRAFT_FIELDS = new Set([
  'id',
  'isSupplement',
  'originalContractId',
  'no',
  'name',
  'projectId',
  'customerId',
  'supplierId',
  'subKind',
  'content',
  'invoiceType',
  'contactName',
  'contactPhone',
  'taxRate',
  'signDate',
  'mainTerms',
  'paymentTerms',
  'brandQualityTerms',
  'scheduleTerms',
  'warrantyTerms',
  'specialTerms',
  'retentionRatio',
  'retentionAmount',
  'retentionDays',
  'invoiceName',
  'invoiceTaxNo',
  'invoiceAddressPhone',
  'invoiceBank',
  'invoiceBankAccount',
  'otherExpenseKind',
  'servicePeriod',
  'paymentCycle',
  'amount',
  'status',
  'note',
  'lineItems',
])
const DRAFT_TEXT_FIELDS = new Set([
  'no',
  'name',
  'subKind',
  'content',
  'invoiceType',
  'contactName',
  'contactPhone',
  'mainTerms',
  'paymentTerms',
  'brandQualityTerms',
  'scheduleTerms',
  'warrantyTerms',
  'specialTerms',
  'invoiceName',
  'invoiceTaxNo',
  'invoiceAddressPhone',
  'invoiceBank',
  'invoiceBankAccount',
  'otherExpenseKind',
  'servicePeriod',
  'paymentCycle',
  'status',
  'note',
])
const DRAFT_NULLABLE_TEXT_FIELDS = new Set([
  'originalContractId',
  'projectId',
  'customerId',
  'supplierId',
])
const DRAFT_NUMBER_FIELDS = new Set([
  'taxRate',
  'retentionRatio',
  'retentionAmount',
  'retentionDays',
  'amount',
])
const LINE_FIELDS = new Set([
  'id',
  'materialName',
  'spec',
  'brand',
  'unit',
  'qty',
  'taxInclusiveUnitPrice',
  'plannedArrivalDate',
  'note',
  'sortOrder',
])
const LINE_TEXT_FIELDS = new Set(['materialName', 'spec', 'brand', 'unit', 'note'])
const ATTACHMENT_CHANGE_FIELDS = new Set(['add', 'removeIds', 'restoreIds'])
const ATTACHMENT_DRAFT_FIELDS = new Set([
  'fileName',
  'filePath',
  'fileSize',
  'mimeType',
  'category',
  'uploader',
])

export class MaterialContractCommandValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MaterialContractCommandValidationError'
  }
}

function fail(message: string): never {
  throw new MaterialContractCommandValidationError(message)
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function onlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every(key => allowed.has(key))
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function decodeLine(value: unknown): ContractLineItemDraft {
  if (!object(value) || !onlyKeys(value, LINE_FIELDS))
    return fail('采购明细无效')
  for (const [field, fieldValue] of Object.entries(value)) {
    if (field === 'id') {
      if (typeof fieldValue !== 'string' || !fieldValue.trim())
        return fail('采购明细 ID 无效')
      continue
    }
    if (LINE_TEXT_FIELDS.has(field)) {
      if (typeof fieldValue !== 'string')
        return fail(`${field} 必须是文本`)
      continue
    }
    if (field === 'qty' || field === 'taxInclusiveUnitPrice') {
      if (fieldValue !== null && !finiteNumber(fieldValue))
        return fail(`${field} 必须是有限数值或 null`)
      continue
    }
    if (field === 'plannedArrivalDate') {
      if (typeof fieldValue !== 'string' || (fieldValue !== '' && !isISODateDTO(fieldValue)))
        return fail('plannedArrivalDate 必须是 ISO 日期')
      continue
    }
    if (field === 'sortOrder') {
      if (!Number.isSafeInteger(fieldValue) || Number(fieldValue) < 0)
        return fail('sortOrder 必须是非负安全整数')
    }
  }
  return { ...value } as ContractLineItemDraft
}

export function decodeMaterialContractDraft(value: unknown): ProjectContractFormDraft {
  if (!object(value) || !onlyKeys(value, DRAFT_FIELDS))
    return fail('未知材料采购合同字段或表单无效')
  for (const [field, fieldValue] of Object.entries(value)) {
    if (field === 'id') {
      if (typeof fieldValue !== 'string' || !fieldValue.trim())
        return fail('材料采购合同 ID 无效')
      continue
    }
    if (field === 'isSupplement') {
      if (typeof fieldValue !== 'boolean')
        return fail('isSupplement 必须是布尔值')
      continue
    }
    if (DRAFT_TEXT_FIELDS.has(field)) {
      if (typeof fieldValue !== 'string')
        return fail(`${field} 必须是文本`)
      continue
    }
    if (DRAFT_NULLABLE_TEXT_FIELDS.has(field)) {
      if (fieldValue !== null && typeof fieldValue !== 'string')
        return fail(`${field} 必须是文本或 null`)
      continue
    }
    if (DRAFT_NUMBER_FIELDS.has(field)) {
      if (fieldValue !== null && !finiteNumber(fieldValue))
        return fail(`${field} 必须是有限数值或 null`)
      continue
    }
    if (field === 'signDate') {
      if (typeof fieldValue !== 'string' || (fieldValue !== '' && !isISODateDTO(fieldValue)))
        return fail('signDate 必须是 ISO 日期')
      continue
    }
    if (field === 'lineItems' && !Array.isArray(fieldValue))
      return fail('采购明细无效')
  }
  return {
    ...value,
    ...(Array.isArray(value.lineItems) ? { lineItems: value.lineItems.map(decodeLine) } : {}),
  } as ProjectContractFormDraft
}

function decodeAttachmentDraft(value: unknown): ContractFormAttachmentDraft {
  if (!object(value) || !onlyKeys(value, ATTACHMENT_DRAFT_FIELDS)
    || typeof value.fileName !== 'string' || !value.fileName.trim()) {
    return fail('新增附件无效')
  }
  for (const field of ['filePath', 'mimeType', 'category', 'uploader']) {
    if (value[field] !== undefined && typeof value[field] !== 'string')
      return fail(`${field} 必须是文本`)
  }
  if (value.fileSize !== undefined && (!finiteNumber(value.fileSize) || value.fileSize < 0))
    return fail('fileSize 必须是非负有限数值')
  return {
    fileName: value.fileName,
    ...(typeof value.filePath === 'string' ? { filePath: value.filePath } : {}),
    ...(typeof value.fileSize === 'number' ? { fileSize: value.fileSize } : {}),
    ...(typeof value.mimeType === 'string' ? { mimeType: value.mimeType } : {}),
    ...(typeof value.category === 'string' ? { category: value.category } : {}),
    ...(typeof value.uploader === 'string' ? { uploader: value.uploader } : {}),
  }
}

function decodeIds(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every(id => typeof id === 'string' && Boolean(id.trim())))
    return fail(`${label}无效`)
  return [...value]
}

export function decodeMaterialContractAttachmentChanges(value: unknown): ContractFormAttachmentChanges {
  if (!object(value) || !onlyKeys(value, ATTACHMENT_CHANGE_FIELDS))
    return fail('附件变更无效')
  if (value.add !== undefined && !Array.isArray(value.add))
    return fail('新增附件无效')
  return {
    add: (value.add ?? []).map(decodeAttachmentDraft),
    removeIds: decodeIds(value.removeIds ?? [], '删除附件 ID'),
    restoreIds: decodeIds(value.restoreIds ?? [], '恢复附件 ID'),
  }
}

export function decodeMaterialContractAttachment(value: unknown, ownerId: string): ContractFormAttachment {
  if (!object(value)
    || typeof value.id !== 'string' || !value.id
    || value.ownerType !== 'contract' || value.ownerId !== ownerId
    || typeof value.fileName !== 'string' || typeof value.filePath !== 'string'
    || !finiteNumber(value.fileSize) || value.fileSize < 0
    || typeof value.mimeType !== 'string' || typeof value.category !== 'string'
    || typeof value.uploader !== 'string' || !isISODateTimeDTO(value.uploadedAt)
    || !(value.deletedAt === null || isISODateTimeDTO(value.deletedAt))) {
    return fail('材料采购合同附件无效')
  }
  return { ...value } as unknown as ContractFormAttachment
}
