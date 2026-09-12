import type { SupplierCredentialAction, SupplierCredentialCommand, SupplierCredentialValidity } from '../../app/lib/supplier/credential-contract'
import type { SupplierCredentialCategory, SupplierCredentialRequirement } from '../../app/lib/supplier/credentials'
import type { DataOriginDTO } from '../../app/types/read-model'
import { credentialProblem } from '../../app/lib/supplier/credential-contract'

function invalid(): never {
  throw credentialProblem('validation-failed', '证照命令格式无效，请重新核对')
}
function object(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)))
    return invalid()
  return value as Record<string, unknown>
}
function text(value: unknown, required = false, max = 10_000): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    return invalid()
  return value
}
function validity(input: Record<string, unknown>): SupplierCredentialValidity {
  if (typeof input.longTerm !== 'boolean')
    return invalid()
  return { category: text(input.category, true) as SupplierCredentialCategory, validFrom: text(input.validFrom), expiresAt: text(input.expiresAt), longTerm: input.longTerm }
}
export function parseSupplierCredentialCommand(value: unknown): SupplierCredentialCommand {
  const commonKeys = ['commandId', 'supplierId', 'origin', 'workspaceId', 'actorId', 'requiredCapability', 'baseSupplierVersion', 'baseCredentialVersion', 'action']
  const outer = object(value, [...commonKeys, 'draft', 'credentialId', 'auditId', 'deletionToken'])
  if ((outer.origin !== 'real' && outer.origin !== 'demo') || outer.requiredCapability !== 'supplier-credential:write')
    return invalid()
  let action: SupplierCredentialAction
  const validityKeys = ['category', 'validFrom', 'expiresAt', 'longTerm']
  if (outer.action === 'upload') {
    object(value, [...commonKeys, 'draft'])
    const draft = object(outer.draft, [...validityKeys, 'fileName', 'fileSize', 'mimeType', 'payloadBase64'])
    if (typeof draft.fileSize !== 'number' || !Number.isSafeInteger(draft.fileSize))
      return invalid()
    action = { action: 'upload', draft: { ...validity(draft), fileName: text(draft.fileName, true, 500), mimeType: text(draft.mimeType, true, 100), fileSize: draft.fileSize, payloadBase64: text(draft.payloadBase64, true, 28_000_000) } }
  }
  else if (outer.action === 'edit') {
    object(value, [...commonKeys, 'draft', 'credentialId'])
    action = { action: 'edit', credentialId: text(outer.credentialId, true), draft: validity(object(outer.draft, validityKeys)) }
  }
  else if (outer.action === 'requirement') {
    object(value, [...commonKeys, 'draft'])
    const draft = object(outer.draft, ['category', 'requirement', 'reason'])
    action = { action: 'requirement', draft: { category: text(draft.category, true) as SupplierCredentialCategory, requirement: text(draft.requirement, true) as SupplierCredentialRequirement, reason: text(draft.reason) } }
  }
  else if (outer.action === 'review') {
    object(value, [...commonKeys, 'draft'])
    const draft = object(outer.draft, ['decision', 'note'])
    if (!['qualified', 'rejected'].includes(String(draft.decision)))
      return invalid()
    action = { action: 'review', draft: { decision: draft.decision as 'qualified' | 'rejected', note: text(draft.note) } }
  }
  else if (outer.action === 'delete') {
    object(value, [...commonKeys, 'credentialId'])
    action = { action: 'delete', credentialId: text(outer.credentialId, true) }
  }
  else if (outer.action === 'restore') {
    object(value, [...commonKeys, 'credentialId', 'auditId', 'deletionToken'])
    action = { action: 'restore', credentialId: text(outer.credentialId, true), auditId: text(outer.auditId, true), deletionToken: text(outer.deletionToken, true) }
  }
  else { return invalid() }
  return { ...action, commandId: text(outer.commandId, true), supplierId: text(outer.supplierId, true), origin: outer.origin as DataOriginDTO, workspaceId: text(outer.workspaceId, true), actorId: text(outer.actorId, true), requiredCapability: 'supplier-credential:write', baseSupplierVersion: text(outer.baseSupplierVersion, true), baseCredentialVersion: text(outer.baseCredentialVersion, true) }
}

export function supplierCredentialOrigin(query: Record<string, unknown>, extraKeys: string[] = []): DataOriginDTO {
  if (Object.keys(query).some(key => !['origin', 'includeDemo', ...extraKeys].includes(key)) || (query.origin !== 'real' && query.origin !== 'demo')
    || ![undefined, true, false, 'true', 'false'].includes(query.includeDemo as never)) {
    throw credentialProblem('invalid-query', '证照读取需要明确有效来源')
  }
  if (query.origin === 'demo' && query.includeDemo !== true && query.includeDemo !== 'true')
    throw credentialProblem('forbidden', '请先明确开启演示数据')
  return query.origin as DataOriginDTO
}
