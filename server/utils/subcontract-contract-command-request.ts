import type { SubcontractContractCommandRequestDTO } from '../../app/lib/subcontract-contract/command-contract'
import { decodeConstructionMainSelection } from '../../app/lib/construction-scope/contract'
import { SUBCONTRACT_CONTRACT_WRITE_CAPABILITY } from '../../app/lib/subcontract-contract/command-contract'
import {
  decodeSubcontractContractAttachmentChanges,
  decodeSubcontractContractDraft,
  SubcontractContractCommandValidationError,
} from '../../app/lib/subcontract-contract/command-validation'
import {
  subcontractContractProblem,
  SubcontractContractRepositoryProblem,
} from '../../app/lib/subcontract-contract/repository'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(message: string): never {
  throw new SubcontractContractRepositoryProblem(subcontractContractProblem('validation-failed', message))
}

export function parseSubcontractContractCommandRequest(
  value: unknown,
  target: { kind: 'create' } | { kind: 'update', routeId: string },
): SubcontractContractCommandRequestDTO {
  if (!object(value) || !object(value.draft) || !object(value.attachments)
    || Object.keys(value).some(key => !['id', 'workspaceId', 'actorId', 'requiredCapability', 'commandId', 'baseVersion', 'action', 'draft', 'attachments', 'constructionMain'].includes(key))
    || typeof value.workspaceId !== 'string' || typeof value.actorId !== 'string'
    || value.requiredCapability !== SUBCONTRACT_CONTRACT_WRITE_CAPABILITY
    || typeof value.commandId !== 'string' || !value.commandId.trim()
    || !(value.baseVersion === null || typeof value.baseVersion === 'string')
    || !['draft', 'save', 'submit'].includes(String(value.action))) {
    return invalid('分包合同命令请求无效')
  }
  if (target.kind === 'create' && value.id !== undefined)
    return invalid('新建分包合同不得指定合同 ID')
  const bodyId = typeof value.id === 'string' && value.id.trim() ? value.id : undefined
  if (target.kind === 'update' && !bodyId)
    return invalid('编辑分包合同必须携带合同 ID')
  if (target.kind === 'update' && target.routeId !== bodyId)
    return invalid('合同地址与请求主体不一致')
  try {
    return {
      ...(target.kind === 'update' ? { id: target.routeId } : {}),
      workspaceId: value.workspaceId,
      actorId: value.actorId,
      requiredCapability: SUBCONTRACT_CONTRACT_WRITE_CAPABILITY,
      commandId: value.commandId,
      baseVersion: value.baseVersion,
      action: value.action as SubcontractContractCommandRequestDTO['action'],
      draft: decodeSubcontractContractDraft(value.draft),
      attachments: decodeSubcontractContractAttachmentChanges(value.attachments),
      ...(value.constructionMain !== undefined ? { constructionMain: decodeConstructionMainSelection(value.constructionMain) } : {}),
    }
  }
  catch (cause) {
    if (cause instanceof SubcontractContractCommandValidationError || (value.constructionMain !== undefined && cause instanceof Error))
      return invalid(cause.message)
    throw cause
  }
}
