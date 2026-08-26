import type { OwnerCommercialDocumentCommandRequestDTO } from '../../app/lib/owner-document/central-command-contract'
import {
  OWNER_COMMERCIAL_DOCUMENT_WRITE_CAPABILITY,
} from '../../app/lib/owner-document/central-command-contract'
import {
  ownerCommercialDocumentProblem,
  OwnerCommercialDocumentRepositoryProblem,
} from '../../app/lib/owner-document/central-repository'

function object(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(message: string): never {
  throw new OwnerCommercialDocumentRepositoryProblem(
    ownerCommercialDocumentProblem('validation-failed', message),
  )
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string')
}

function scalar(value: unknown): boolean {
  return value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
}

function draftPayload(value: unknown): value is Record<string, unknown> {
  if (!object(value))
    return false
  return Object.entries(value).every(([key, entry]) => key === 'lines' || key === 'lifecycleEvents'
    ? Array.isArray(entry) && entry.every(line => object(line) && Object.values(line).every(scalar))
    : scalar(entry))
}

function attachmentChanges(value: unknown): boolean {
  if (!object(value))
    return false
  const add = value.add ?? []
  const removeIds = value.removeIds ?? []
  const restoreIds = value.restoreIds ?? []
  return Array.isArray(add) && add.every(file => object(file)
    && typeof file.fileName === 'string'
    && Object.values(file).every(scalar))
  && stringArray(removeIds) && stringArray(restoreIds)
}

function auditLines(value: unknown): value is Array<{ boqLineId: string, auditedQty: number }> {
  return Array.isArray(value) && value.every(line => object(line)
    && typeof line.boqLineId === 'string' && line.boqLineId.length > 0
    && typeof line.auditedQty === 'number' && Number.isFinite(line.auditedQty))
}

export function parseOwnerCommercialDocumentCommandRequest(
  value: unknown,
): OwnerCommercialDocumentCommandRequestDTO {
  if (!object(value)
    || typeof value.workspaceId !== 'string' || !value.workspaceId
    || typeof value.actorId !== 'string' || !value.actorId
    || value.requiredCapability !== OWNER_COMMERCIAL_DOCUMENT_WRITE_CAPABILITY
    || typeof value.commandId !== 'string' || !value.commandId
    || !['owner_change', 'owner_report', 'acceptance'].includes(String(value.kind))
    || !(value.id === null || typeof value.id === 'string')
    || !(value.baseVersion === null || typeof value.baseVersion === 'string')
    || !['save', 'submit', 'approve', 'audit', 'transition-acceptance', 'attachments', 'delete'].includes(String(value.action))) {
    return invalid('甲方商务单据命令请求无效')
  }
  const base = {
    workspaceId: value.workspaceId,
    actorId: value.actorId,
    requiredCapability: OWNER_COMMERCIAL_DOCUMENT_WRITE_CAPABILITY,
    commandId: value.commandId,
    kind: value.kind as 'owner_change' | 'owner_report' | 'acceptance',
    id: value.id,
    baseVersion: value.baseVersion,
  }
  if (value.action === 'save' || value.action === 'submit') {
    if (!draftPayload(value.draft) || !attachmentChanges(value.attachments))
      return invalid('甲方商务单据保存命令无效')
    return {
      ...base,
      action: value.action,
      draft: structuredClone(value.draft),
      attachments: structuredClone(value.attachments),
    }
  }
  if (!value.id)
    return invalid('甲方商务单据生命周期命令必须携带稳定 ID')
  if (value.action === 'attachments') {
    if (!attachmentChanges(value.attachments))
      return invalid('甲方商务单据附件命令无效')
    return { ...base, id: value.id, action: 'attachments', attachments: structuredClone(value.attachments) }
  }
  if (value.action === 'approve') {
    if (value.kind !== 'owner_change' || typeof value.approvedAt !== 'string')
      return invalid('甲方变洽签签证命令无效')
    return { ...base, id: value.id, kind: 'owner_change', action: 'approve', approvedAt: value.approvedAt }
  }
  if (value.action === 'audit') {
    if (value.kind !== 'owner_report' || !object(value.audit) || !auditLines(value.audit.lines))
      return invalid('月度报量审定命令无效')
    return {
      ...base,
      id: value.id,
      kind: 'owner_report',
      action: 'audit',
      audit: { lines: value.audit.lines.map(line => ({ boqLineId: line.boqLineId, auditedQty: line.auditedQty })) },
    }
  }
  if (value.action === 'transition-acceptance') {
    if (value.kind !== 'acceptance'
      || !['accepted', 'warranty', 'expired'].includes(String(value.target))
      || !object(value.facts)
      || !Object.values(value.facts).every(scalar)
      || !attachmentChanges(value.attachments)) {
      return invalid('验收生命周期命令无效')
    }
    return {
      ...base,
      id: value.id,
      kind: 'acceptance',
      action: 'transition-acceptance',
      target: value.target as 'accepted' | 'warranty' | 'expired',
      facts: structuredClone(value.facts),
      attachments: structuredClone(value.attachments),
    }
  }
  return { ...base, id: value.id, action: 'delete' }
}
