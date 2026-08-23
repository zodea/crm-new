import type { FormAttachmentChanges, SupplierFormDraft } from '../../app/lib/master-data/forms'
import type { SupplierCommandRequestDTO } from '../../app/lib/supplier/command-contract'
import { SUPPLIER_WRITE_CAPABILITY } from '../../app/lib/supplier/command-contract'
import { supplierProblem, SupplierRepositoryProblem } from '../../app/lib/supplier/repository'

const ACTIONS = new Set(['draft', 'save', 'submit'])
const TEXT_FIELDS = new Set([
  'id',
  'name',
  'externalRef',
  'uniqueCode',
  'taxNo',
  'businessType',
  'supplierCategory',
  'rating',
  'legalRep',
  'registeredDate',
  'address',
  'taxpayerType',
  'taxpayerVerificationStatus',
  'taxpayerVerificationSource',
  'taxpayerVerificationNote',
  'mainBusiness',
  'invoiceName',
  'invoiceAddress',
  'bank',
  'bankAccount',
  'phone',
  'contact',
  'contactPhone',
  'contactTitle',
  'note',
  'approvalStatus',
])

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(message: string): never {
  throw new SupplierRepositoryProblem(supplierProblem('validation-failed', message))
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function validDraft(value: Record<string, unknown>): boolean {
  return Object.entries(value).every(([key, field]) => {
    if (key === 'aliases')
      return strings(field)
    if (key === 'registeredCapital')
      return field === null || (typeof field === 'number' && Number.isFinite(field) && field >= 0)
    if (key === 'taxpayerVerifiedAt')
      return field === null || typeof field === 'string'
    return TEXT_FIELDS.has(key) && typeof field === 'string'
  })
}

function emptyAttachmentChanges(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value)
  return keys.every(key => ['add', 'removeIds', 'restoreIds'].includes(key))
    && keys.every(key => Array.isArray(value[key]) && value[key].length === 0)
}

export function parseSupplierCommandRequest(value: unknown, routeId?: string): SupplierCommandRequestDTO {
  if (!object(value) || !object(value.draft) || !object(value.attachments))
    return fail('分供方命令请求无效')
  if (!validDraft(value.draft) || !emptyAttachmentChanges(value.attachments))
    return fail('分供方命令内容无效；证照文件须通过证照专用边界处理')
  if (typeof value.workspaceId !== 'string' || typeof value.actorId !== 'string'
    || value.requiredCapability !== SUPPLIER_WRITE_CAPABILITY || typeof value.commandId !== 'string'
    || !(value.baseVersion === null || typeof value.baseVersion === 'string')
    || !ACTIONS.has(String(value.action))) {
    return fail('分供方命令信封无效')
  }
  if (routeId && value.id !== routeId)
    return fail('路由分供方 ID 与命令不匹配')
  if (!routeId && value.id !== undefined)
    return fail('新建命令不能指定分供方 ID')
  return {
    ...(routeId ? { id: routeId } : {}),
    workspaceId: value.workspaceId,
    actorId: value.actorId,
    requiredCapability: SUPPLIER_WRITE_CAPABILITY,
    commandId: value.commandId,
    baseVersion: value.baseVersion,
    action: value.action as SupplierCommandRequestDTO['action'],
    draft: value.draft as SupplierFormDraft,
    attachments: value.attachments as FormAttachmentChanges,
  }
}
