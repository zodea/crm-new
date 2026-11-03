import type { FormAttachmentChanges, SupplierFormDraft } from '../../app/lib/master-data/forms'
import type { SupplierCommandRequestDTO, SupplierImportCommandRequestDTO } from '../../app/lib/supplier/command-contract'
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
  'laborScope',
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

/** 导入只接受主数据映射字段，不接收主档 ID、审核或核验结论。 */
export function parseSupplierImportCommandRequest(value: unknown): SupplierImportCommandRequestDTO {
  if (!object(value) || !object(value.draft)
    || Object.keys(value).some(key => !['workspaceId', 'actorId', 'requiredCapability', 'commandId', 'draft', 'decision'].includes(key))
    || Object.keys(value.draft).some(key => ['id', 'approvalStatus', 'taxpayerVerificationStatus', 'taxpayerVerificationSource', 'taxpayerVerifiedAt', 'taxpayerVerificationNote'].includes(key))) {
    return fail('分供方导入内容无效；导入不能指定主档 ID 或核验结论')
  }
  const decision = value.decision
  if (decision !== undefined && (!object(decision)
    || !/^[a-f0-9]{64}$/.test(String(decision.fingerprint))
    || (decision.kind === 'create'
      ? Object.keys(decision).sort().join(',') !== 'fingerprint,kind'
      : decision.kind === 'replace'
        ? Object.keys(decision).sort().join(',') !== 'fingerprint,id,kind,version' || typeof decision.id !== 'string' || !decision.id.trim() || typeof decision.version !== 'string' || !/^[1-9]\d*$/.test(decision.version)
        : true))) {
    return fail('分供方导入确认内容无效，请重新预览')
  }
  const { decision: _decision, ...envelope } = value
  const parsed = parseSupplierCommandRequest({ ...envelope, baseVersion: null, action: 'draft', attachments: {} })
  if (!parsed.draft.name?.trim())
    return fail('公司全称不能为空')
  return {
    workspaceId: parsed.workspaceId,
    actorId: parsed.actorId,
    requiredCapability: SUPPLIER_WRITE_CAPABILITY,
    commandId: parsed.commandId,
    draft: parsed.draft,
    ...(decision === undefined ? {} : { decision: decision as SupplierImportCommandRequestDTO['decision'] }),
  }
}

/** 预览采用和正式导入相同的字段白名单，不允许传主档 ID 或人工审核结果。 */
export function parseSupplierImportPreviewRequest(value: unknown): SupplierImportCommandRequestDTO['draft'][] {
  if (!object(value) || Object.keys(value).join(',') !== 'drafts' || !Array.isArray(value.drafts) || value.drafts.length > 5000)
    return fail('分供方导入预览内容无效')
  return value.drafts.map(draft => parseSupplierImportCommandRequest({ workspaceId: 'preview', actorId: 'preview', requiredCapability: SUPPLIER_WRITE_CAPABILITY, commandId: 'preview', draft }).draft)
}
