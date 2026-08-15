import type {
  FormAttachmentChanges,
  FormAttachmentDraft,
  ProjectFormDraft,
} from '../master-data/forms'
import { isISODateDTO } from '../../types/read-model'

const PROJECT_TEXT_FIELDS = new Set<keyof ProjectFormDraft>([
  'name',
  'contractName',
  'code',
  'region',
  'address',
  'operationType',
  'type',
  'overview',
  'status',
  'developerSupervisor',
  'manager',
  'managerPhone',
  'execManager',
  'builder',
  'contractor',
  'supervisor',
  'designer',
  'siteLeader',
  'siteLeaderPhone',
  'riskLevel',
  'approvalStatus',
  'note',
])
const PROJECT_DATE_FIELDS = new Set<keyof ProjectFormDraft>([
  'startDate',
  'plannedEnd',
  'actualEnd',
  'acceptanceDate',
  'filingDate',
])
const PROJECT_NULLABLE_TEXT_FIELDS = new Set<keyof ProjectFormDraft>([
  'customerId',
  'secondaryCustomerId',
])
const PROJECT_NULLABLE_NUMBER_FIELDS = new Set<keyof ProjectFormDraft>([
  'area',
  'contractAmount',
  'plannedDuration',
])
const ATTACHMENT_FIELDS = new Set<keyof FormAttachmentDraft>([
  'fileName',
  'filePath',
  'fileSize',
  'mimeType',
  'category',
  'uploader',
])
const OPTIONAL_ATTACHMENT_TEXT_FIELDS = new Set<keyof FormAttachmentDraft>([
  'filePath',
  'mimeType',
  'category',
  'uploader',
])
const ATTACHMENT_CHANGE_FIELDS = new Set(['add', 'removeIds', 'restoreIds'])

export class ProjectCommandValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectCommandValidationError'
  }
}

function fail(message: string): never {
  throw new ProjectCommandValidationError(message)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every(key => allowed.has(key))
}

export function decodeProjectFormDraft(value: unknown): ProjectFormDraft {
  if (!isObject(value))
    return fail('项目表单必填')
  for (const [field, fieldValue] of Object.entries(value)) {
    if (field === 'id') {
      if (typeof fieldValue !== 'string' || !fieldValue.trim())
        return fail('项目 ID 无效')
      continue
    }
    if (PROJECT_TEXT_FIELDS.has(field as keyof ProjectFormDraft)) {
      if (fieldValue !== undefined && typeof fieldValue !== 'string')
        return fail(`${field} 必须是文本`)
      continue
    }
    if (PROJECT_DATE_FIELDS.has(field as keyof ProjectFormDraft)) {
      if (fieldValue !== undefined
        && (typeof fieldValue !== 'string'
          || (fieldValue !== '' && !isISODateDTO(fieldValue)))) {
        return fail(`${field} 必须是 ISO 日期`)
      }
      continue
    }
    if (PROJECT_NULLABLE_TEXT_FIELDS.has(field as keyof ProjectFormDraft)) {
      if (fieldValue !== undefined && fieldValue !== null && typeof fieldValue !== 'string')
        return fail(`${field} 必须是文本或 null`)
      continue
    }
    if (PROJECT_NULLABLE_NUMBER_FIELDS.has(field as keyof ProjectFormDraft)) {
      if (fieldValue !== undefined && fieldValue !== null
        && (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue) || fieldValue < 0)) {
        return fail(`${field} 必须是非负有限数值或 null`)
      }
      continue
    }
    return fail(`未知项目字段：${field}`)
  }
  return { ...value } as ProjectFormDraft
}

function decodeAttachmentDraft(value: unknown): FormAttachmentDraft {
  if (!isObject(value) || !hasOnlyKeys(value, ATTACHMENT_FIELDS))
    return fail('新增附件无效')
  if (typeof value.fileName !== 'string' || !value.fileName.trim())
    return fail('附件文件名必填')
  for (const field of OPTIONAL_ATTACHMENT_TEXT_FIELDS) {
    const fieldValue = value[field]
    if (fieldValue !== undefined && typeof fieldValue !== 'string')
      return fail(`${field} 必须是文本`)
  }
  if (value.fileSize !== undefined
    && (typeof value.fileSize !== 'number'
      || !Number.isFinite(value.fileSize)
      || value.fileSize < 0)) {
    return fail('fileSize 必须是非负有限数值')
  }
  return { ...value } as unknown as FormAttachmentDraft
}

function decodeAttachmentIds(value: unknown, label: string): string[] {
  if (!Array.isArray(value)
    || !value.every(id => typeof id === 'string' && Boolean(id.trim()))) {
    return fail(`${label}无效`)
  }
  return [...value]
}

export function decodeProjectAttachmentChanges(value: unknown): FormAttachmentChanges {
  if (!isObject(value) || !hasOnlyKeys(value, ATTACHMENT_CHANGE_FIELDS))
    return fail('附件变更无效')
  const add = value.add ?? []
  if (!Array.isArray(add))
    return fail('新增附件无效')
  return {
    add: add.map(decodeAttachmentDraft),
    removeIds: decodeAttachmentIds(value.removeIds ?? [], '删除附件 ID'),
    restoreIds: decodeAttachmentIds(value.restoreIds ?? [], '恢复附件 ID'),
  }
}
