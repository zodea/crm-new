import type { MaterialContractCommandRequestDTO } from '../../app/lib/material-contract/command-contract'
import { MATERIAL_CONTRACT_WRITE_CAPABILITY } from '../../app/lib/material-contract/command-contract'
import {
  decodeMaterialContractAttachmentChanges,
  decodeMaterialContractDraft,
  MaterialContractCommandValidationError,
} from '../../app/lib/material-contract/command-validation'
import { materialContractProblem, MaterialContractRepositoryProblem } from '../../app/lib/material-contract/repository'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(message: string): never {
  throw new MaterialContractRepositoryProblem(materialContractProblem('validation-failed', message))
}

export function parseMaterialContractCommandRequest(
  value: unknown,
  target: { kind: 'create' } | { kind: 'update', routeId: string },
): MaterialContractCommandRequestDTO {
  if (!object(value) || !object(value.draft) || !object(value.attachments)
    || Object.keys(value).some(key => !['id', 'workspaceId', 'actorId', 'requiredCapability', 'commandId', 'baseVersion', 'action', 'draft', 'attachments'].includes(key))
    || typeof value.workspaceId !== 'string' || typeof value.actorId !== 'string'
    || value.requiredCapability !== MATERIAL_CONTRACT_WRITE_CAPABILITY
    || typeof value.commandId !== 'string'
    || !(value.baseVersion === null || typeof value.baseVersion === 'string')
    || !['draft', 'save', 'submit'].includes(String(value.action))) {
    return invalid('材料采购合同命令请求无效')
  }
  if (target.kind === 'create' && value.id !== undefined)
    return invalid('新建材料采购合同不得指定合同 ID')
  const bodyId = typeof value.id === 'string' && value.id.trim() ? value.id : undefined
  if (target.kind === 'update' && !bodyId)
    return invalid('编辑材料采购合同必须携带合同 ID')
  if (target.kind === 'update' && target.routeId !== bodyId)
    return invalid('合同地址与请求主体不一致')
  try {
    return {
      ...(target.kind === 'update' ? { id: target.routeId } : {}),
      workspaceId: value.workspaceId,
      actorId: value.actorId,
      requiredCapability: MATERIAL_CONTRACT_WRITE_CAPABILITY,
      commandId: value.commandId,
      baseVersion: value.baseVersion,
      action: value.action as MaterialContractCommandRequestDTO['action'],
      draft: decodeMaterialContractDraft(value.draft),
      attachments: decodeMaterialContractAttachmentChanges(value.attachments),
    }
  }
  catch (cause) {
    if (cause instanceof MaterialContractCommandValidationError)
      return invalid(cause.message)
    throw cause
  }
}
