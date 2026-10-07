import type { ConstructionContractCommandRequestDTO } from '../../app/lib/construction-contract/command-contract'
import { CONSTRUCTION_CONTRACT_WRITE_CAPABILITY } from '../../app/lib/construction-contract/command-contract'
import {
  ConstructionContractCommandValidationError,
  decodeConstructionContractAttachmentChanges,
  decodeConstructionContractDraft,
} from '../../app/lib/construction-contract/command-validation'
import {
  constructionContractProblem,
  ConstructionContractRepositoryProblem,
} from '../../app/lib/construction-contract/repository'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(message: string): never {
  throw new ConstructionContractRepositoryProblem(constructionContractProblem('validation-failed', message))
}

export function parseConstructionContractCommandRequest(
  value: unknown,
  target: { kind: 'create' } | { kind: 'update', routeId: string },
): ConstructionContractCommandRequestDTO {
  if (!object(value) || !object(value.draft) || !object(value.attachments)
    || Object.keys(value).some(key => !['id', 'workspaceId', 'actorId', 'requiredCapability', 'commandId', 'baseVersion', 'action', 'draft', 'attachments'].includes(key))
    || typeof value.workspaceId !== 'string' || typeof value.actorId !== 'string'
    || value.requiredCapability !== CONSTRUCTION_CONTRACT_WRITE_CAPABILITY
    || typeof value.commandId !== 'string'
    || !(value.baseVersion === null || typeof value.baseVersion === 'string')
    || !['draft', 'save', 'submit'].includes(String(value.action))) {
    return invalid('施工合同命令请求无效')
  }
  if (target.kind === 'create' && value.id !== undefined)
    return invalid('新建施工合同不得指定合同 ID')
  const bodyId = typeof value.id === 'string' && value.id.trim() ? value.id : undefined
  if (target.kind === 'update' && !bodyId)
    return invalid('编辑施工合同必须携带合同 ID')
  if (target.kind === 'update' && target.routeId !== bodyId)
    return invalid('合同地址与请求主体不一致')
  try {
    return {
      ...(target.kind === 'update' ? { id: target.routeId } : {}),
      workspaceId: value.workspaceId,
      actorId: value.actorId,
      requiredCapability: CONSTRUCTION_CONTRACT_WRITE_CAPABILITY,
      commandId: value.commandId,
      baseVersion: value.baseVersion,
      action: value.action as ConstructionContractCommandRequestDTO['action'],
      draft: decodeConstructionContractDraft(value.draft),
      attachments: decodeConstructionContractAttachmentChanges(value.attachments),
    }
  }
  catch (cause) {
    if (cause instanceof ConstructionContractCommandValidationError)
      return invalid(cause.message)
    throw cause
  }
}
