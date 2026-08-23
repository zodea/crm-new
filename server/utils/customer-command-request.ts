import type { CustomerCommandRequestDTO } from '../../app/lib/customer/command-contract'
import type { CustomerFormDraft, FormAttachmentChanges } from '../../app/lib/master-data/forms'
import { CUSTOMER_WRITE_CAPABILITY } from '../../app/lib/customer/command-contract'
import { customerProblem, CustomerRepositoryProblem } from '../../app/lib/customer/repository'

const ACTIONS = new Set(['draft', 'save', 'submit'])

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(message: string): never {
  throw new CustomerRepositoryProblem(customerProblem('validation-failed', message))
}

const CUSTOMER_TEXT_FIELDS = new Set([
  'id',
  'name',
  'taxNo',
  'legalRep',
  'registeredAddress',
  'invoiceName',
  'bank',
  'bankAccount',
  'contact',
  'contactPhone',
  'note',
  'status',
])

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function validDraft(value: Record<string, unknown>): boolean {
  return Object.entries(value).every(([key, field]) => {
    if (key === 'aliases')
      return stringArray(field)
    return CUSTOMER_TEXT_FIELDS.has(key) && typeof field === 'string'
  })
}

function validAttachmentDraft(value: unknown): boolean {
  if (!object(value) || typeof value.fileName !== 'string' || !value.fileName.trim())
    return false
  return ['filePath', 'mimeType', 'category', 'uploader'].every(key =>
    value[key] === undefined || typeof value[key] === 'string',
  ) && (value.fileSize === undefined
    || (typeof value.fileSize === 'number' && Number.isFinite(value.fileSize) && value.fileSize >= 0))
}

function validAttachments(value: Record<string, unknown>): boolean {
  return (value.add === undefined || (Array.isArray(value.add) && value.add.every(validAttachmentDraft)))
    && (value.removeIds === undefined || stringArray(value.removeIds))
    && (value.restoreIds === undefined || stringArray(value.restoreIds))
}

export function parseCustomerCommandRequest(value: unknown, routeId?: string): CustomerCommandRequestDTO {
  if (!object(value) || !object(value.draft) || !object(value.attachments))
    return fail('客户命令请求无效')
  if (!validDraft(value.draft) || !validAttachments(value.attachments))
    return fail('客户命令内容无效')
  if (typeof value.workspaceId !== 'string' || typeof value.actorId !== 'string'
    || value.requiredCapability !== CUSTOMER_WRITE_CAPABILITY || typeof value.commandId !== 'string'
    || !(value.baseVersion === null || typeof value.baseVersion === 'string')
    || !ACTIONS.has(String(value.action))) {
    return fail('客户命令信封无效')
  }
  if (routeId && value.id !== routeId)
    return fail('路由客户 ID 与命令不匹配')
  if (!routeId && value.id !== undefined)
    return fail('新建命令不能指定客户 ID')
  return {
    ...(routeId ? { id: routeId } : {}),
    workspaceId: value.workspaceId,
    actorId: value.actorId,
    requiredCapability: CUSTOMER_WRITE_CAPABILITY,
    commandId: value.commandId,
    baseVersion: value.baseVersion,
    action: value.action as CustomerCommandRequestDTO['action'],
    draft: value.draft as CustomerFormDraft,
    attachments: value.attachments as FormAttachmentChanges,
  }
}
