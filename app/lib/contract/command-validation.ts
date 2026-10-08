import type {
  ContractDeductionDraft,
  ContractFormAttachment,
  ContractFormAttachmentChanges,
  ContractFormAttachmentDraft,
  ContractLineItemDraft,
  ContractLineSourceEvidence,
  ProjectContractFormDraft,
} from './forms'
import { isISODateDTO, isISODateTimeDTO } from '../../types/read-model'
import { decodeOurSignatorySnapshot } from '../our-signatory/contract'

const DRAFT_FIELDS = new Set(['id', 'isSupplement', 'originalContractId', 'no', 'name', 'projectId', 'customerId', 'supplierId', 'subKind', 'content', 'invoiceType', 'contactName', 'contactPhone', 'taxRate', 'signDate', 'mainTerms', 'paymentTerms', 'brandQualityTerms', 'scheduleTerms', 'warrantyTerms', 'specialTerms', 'retentionRatio', 'retentionAmount', 'retentionDays', 'invoiceName', 'invoiceTaxNo', 'invoiceAddressPhone', 'invoiceBank', 'invoiceBankAccount', 'otherExpenseKind', 'servicePeriod', 'paymentCycle', 'amount', 'status', 'note', 'lineItems', 'deductions'])
DRAFT_FIELDS.add('managementFeeAmount')
DRAFT_FIELDS.add('managementFeeBasis')
const TEXT_FIELDS = new Set(['managementFeeBasis', 'no', 'name', 'subKind', 'content', 'invoiceType', 'contactName', 'contactPhone', 'mainTerms', 'paymentTerms', 'brandQualityTerms', 'scheduleTerms', 'warrantyTerms', 'specialTerms', 'invoiceName', 'invoiceTaxNo', 'invoiceAddressPhone', 'invoiceBank', 'invoiceBankAccount', 'otherExpenseKind', 'servicePeriod', 'paymentCycle', 'status', 'note'])
const NULLABLE_TEXT_FIELDS = new Set(['originalContractId', 'projectId', 'customerId', 'supplierId'])
DRAFT_FIELDS.add('ourSignatorySnapshot')
for (const field of ['ourSignatoryId', 'ourSignatoryVersion', 'legacyPartyA']) {
  DRAFT_FIELDS.add(field)
  NULLABLE_TEXT_FIELDS.add(field)
}
const NUMBER_FIELDS = new Set(['managementFeeAmount', 'taxRate', 'retentionRatio', 'retentionAmount', 'retentionDays', 'amount'])
const LINE_FIELDS = new Set(['id', 'materialName', 'spec', 'materialGrade', 'brand', 'unit', 'qty', 'taxInclusiveUnitPrice', 'applicableTaxRate', 'plannedArrivalDate', 'note', 'sortOrder', 'originalLineId', 'changeAmount', 'changeBasis', 'source'])
const LINE_TEXT_FIELDS = new Set(['materialName', 'spec', 'materialGrade', 'brand', 'unit', 'note', 'changeBasis'])
const DEDUCTION_FIELDS = new Set(['id', 'name', 'amount', 'basis', 'sortOrder'])
const SOURCE_FIELDS = new Set(['fileName', 'sheetName', 'rowNumber', 'sourceHash', 'externalRef', 'priceUnit', 'quantityUnitVerified'])
const ATTACHMENT_CHANGE_FIELDS = new Set(['add', 'removeIds', 'restoreIds'])
const ATTACHMENT_DRAFT_FIELDS = new Set(['fileName', 'filePath', 'fileSize', 'mimeType', 'category', 'uploader', 'payloadBase64'])

interface DecodeOptions {
  entityLabel: string
  lineItemLabel: string
  allowLineItems: boolean
  allowSupplier: boolean
  allowManagementFee?: boolean
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

function decodeSource(value: unknown, options: DecodeOptions): ContractLineSourceEvidence | null {
  if (value === null)
    return null
  if (!object(value) || !onlyKeys(value, SOURCE_FIELDS)
    || !['fileName', 'sheetName', 'sourceHash', 'priceUnit'].every(key => typeof value[key] === 'string' && String(value[key]).trim())
    || typeof value.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceHash)
    || !Number.isSafeInteger(value.rowNumber) || Number(value.rowNumber) < 1
    || !(value.externalRef === null || typeof value.externalRef === 'string')
    || typeof value.quantityUnitVerified !== 'boolean') {
    return options.fail('采购来源证据无效')
  }
  return { ...value } as unknown as ContractLineSourceEvidence
}

function decodeDeduction(value: unknown, options: DecodeOptions): ContractDeductionDraft {
  if (!object(value) || !onlyKeys(value, DEDUCTION_FIELDS))
    return options.fail('合同减项无效')
  if (value.id !== undefined && (typeof value.id !== 'string' || !value.id.trim()))
    return options.fail('减项 ID 无效')
  if (['name', 'basis'].some(key => value[key] !== undefined && typeof value[key] !== 'string')
    || (value.amount !== undefined && value.amount !== null && !finiteNumber(value.amount))
    || (value.sortOrder !== undefined && (!Number.isSafeInteger(value.sortOrder) || Number(value.sortOrder) < 0))) {
    return options.fail('合同减项字段无效')
  }
  return { ...value } as ContractDeductionDraft
}

function decodeLine(value: unknown, options: DecodeOptions): ContractLineItemDraft {
  if (!object(value) || !onlyKeys(value, LINE_FIELDS))
    return options.fail(`${options.lineItemLabel}无效`)
  for (const [field, fieldValue] of Object.entries(value)) {
    if (field === 'id' && (typeof fieldValue !== 'string' || !fieldValue.trim()))
      return options.fail(`${options.lineItemLabel} ID 无效`)
    if (LINE_TEXT_FIELDS.has(field) && typeof fieldValue !== 'string')
      return options.fail(`${field} 必须是文本`)
    if ((field === 'qty' || field === 'taxInclusiveUnitPrice' || field === 'applicableTaxRate' || field === 'changeAmount') && fieldValue !== null && !finiteNumber(fieldValue))
      return options.fail(`${field} 必须是有限数值或 null`)
    if (field === 'plannedArrivalDate' && (typeof fieldValue !== 'string' || (fieldValue !== '' && !isISODateDTO(fieldValue))))
      return options.fail('plannedArrivalDate 必须是 ISO 日期')
    if (field === 'sortOrder' && (!Number.isSafeInteger(fieldValue) || Number(fieldValue) < 0))
      return options.fail('sortOrder 必须是非负安全整数')
    if (field === 'originalLineId' && fieldValue !== null && (typeof fieldValue !== 'string' || !fieldValue.trim()))
      return options.fail('原明细 ID 无效')
  }
  return { ...value, ...(value.source !== undefined ? { source: decodeSource(value.source, options) } : {}) } as ContractLineItemDraft
}

export function decodeProjectContractDraft(value: unknown, options: DecodeOptions): ProjectContractFormDraft {
  if (!object(value) || !onlyKeys(value, DRAFT_FIELDS))
    return options.fail(`未知${options.entityLabel}字段或表单无效`)
  for (const [field, fieldValue] of Object.entries(value)) {
    if (field === 'ourSignatoryVersion' && fieldValue !== null && (typeof fieldValue !== 'string' || !/^[1-9]\d*$/.test(fieldValue)))
      return options.fail('我方主体目录版本无效')
    if (field === 'ourSignatorySnapshot' && fieldValue !== null) {
      try {
        const snapshot = decodeOurSignatorySnapshot(fieldValue)
        if (snapshot.id !== value.ourSignatoryId || snapshot.version !== value.ourSignatoryVersion)
          return options.fail('我方主体采用快照与稳定身份或目录版本不一致')
      }
      catch { return options.fail('我方主体采用快照无效') }
    }
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
    if ((field === 'lineItems' || field === 'deductions') && !Array.isArray(fieldValue))
      return options.fail(`${options.lineItemLabel}无效`)
  }
  if (('managementFeeAmount' in value || 'managementFeeBasis' in value) && (!options.allowManagementFee || value.isSupplement))
    return options.fail('管理费配置仅适用于施工主合同')
  if (typeof value.managementFeeAmount === 'number' && value.managementFeeAmount < 0)
    return options.fail('总合同管理费金额不能为负数')
  if (value.supplierId && !options.allowSupplier)
    return options.fail(`${options.entityLabel}不接受分供方关系`)
  if (Array.isArray(value.lineItems) && value.lineItems.length && !options.allowLineItems)
    return options.fail(`${options.entityLabel}不接受采购明细`)
  if (Array.isArray(value.deductions) && value.deductions.length && !options.allowLineItems)
    return options.fail(`${options.entityLabel}不接受合同减项`)
  return {
    ...value,
    lineItems: options.allowLineItems && Array.isArray(value.lineItems)
      ? value.lineItems.map(item => decodeLine(item, options))
      : undefined,
    ...(value.deductions !== undefined ? { deductions: (value.deductions as unknown[]).map(item => decodeDeduction(item, options)) } : {}),
  } as ProjectContractFormDraft
}

function decodeAttachmentDraft(value: unknown, options: DecodeOptions): ContractFormAttachmentDraft {
  if (!object(value) || !onlyKeys(value, ATTACHMENT_DRAFT_FIELDS) || typeof value.fileName !== 'string' || !value.fileName.trim())
    return options.fail('新增附件无效')
  for (const field of ['filePath', 'mimeType', 'category', 'uploader', 'payloadBase64']) {
    if (value[field] !== undefined && typeof value[field] !== 'string')
      return options.fail(`${field} 必须是文本`)
  }
  if (value.fileSize !== undefined && (!finiteNumber(value.fileSize) || value.fileSize < 0))
    return options.fail('fileSize 必须是非负有限数值')
  return { fileName: value.fileName, ...(typeof value.filePath === 'string' ? { filePath: value.filePath } : {}), ...(typeof value.fileSize === 'number' ? { fileSize: value.fileSize } : {}), ...(typeof value.mimeType === 'string' ? { mimeType: value.mimeType } : {}), ...(typeof value.category === 'string' ? { category: value.category } : {}), ...(typeof value.uploader === 'string' ? { uploader: value.uploader } : {}), ...(typeof value.payloadBase64 === 'string' ? { payloadBase64: value.payloadBase64 } : {}) }
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
  if (object(value) && value.sha256 !== undefined && (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)))
    return options.fail('原件摘要无效')
  if (!object(value) || typeof value.id !== 'string' || !value.id || !['contract', ...(options.allowLineItems ? ['contract_supplement'] : [])].includes(String(value.ownerType)) || value.ownerId !== ownerId || typeof value.fileName !== 'string' || typeof value.filePath !== 'string' || !finiteNumber(value.fileSize) || value.fileSize < 0 || typeof value.mimeType !== 'string' || typeof value.category !== 'string' || typeof value.uploader !== 'string' || !(value.uploadedAt === null || isISODateTimeDTO(value.uploadedAt)) || !(value.deletedAt === null || isISODateTimeDTO(value.deletedAt)))
    return options.fail(`${options.entityLabel}附件无效`)
  return { ...value } as unknown as ContractFormAttachment
}
