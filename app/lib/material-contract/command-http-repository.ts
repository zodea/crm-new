import type {
  MaterialContractCommandContextDTO,
  MaterialContractCommandRepository,
  MaterialContractCommandResultDTO,
  MaterialContractFormReadDTO,
} from './command-contract'
import type { MaterialContractHttpFetcher } from './http-repository'
import { isISODateTimeDTO } from '../../types/read-model'
import {
  decodeMaterialContractAttachment,
  decodeMaterialContractDraft,
  MaterialContractCommandValidationError,
} from './command-validation'
import { readMaterialContractHttp } from './http-repository'
import { materialContractProblem, MaterialContractRepositoryProblem } from './repository'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function options(value: unknown): boolean {
  return Array.isArray(value) && value.every(row => object(row)
    && typeof row.id === 'string' && typeof row.label === 'string')
}

function invalid(message: string): never {
  throw new MaterialContractRepositoryProblem(materialContractProblem('internal-error', message))
}

function context(value: unknown): MaterialContractCommandContextDTO {
  if (!object(value) || typeof value.workspaceId !== 'string' || typeof value.actorId !== 'string'
    || !Array.isArray(value.capabilities) || !value.capabilities.every(item => typeof item === 'string')
    || !options(value.projects) || !options(value.suppliers)) {
    return invalid('中央后台返回的材料采购合同业务会话无效')
  }
  return value as unknown as MaterialContractCommandContextDTO
}

function result(value: unknown): MaterialContractCommandResultDTO {
  if (!object(value) || typeof value.id !== 'string' || typeof value.commandId !== 'string'
    || typeof value.version !== 'string' || !isISODateTimeDTO(value.updatedAt)
    || !Array.isArray(value.attachmentIds) || !value.attachmentIds.every(item => typeof item === 'string')) {
    return invalid('中央后台返回的材料采购合同命令结果无效')
  }
  return value as unknown as MaterialContractCommandResultDTO
}

function form(value: unknown, id: string): MaterialContractFormReadDTO {
  if (!object(value) || !Array.isArray(value.attachments) || typeof value.version !== 'string'
    || !isISODateTimeDTO(value.updatedAt)) {
    return invalid('中央后台返回的材料采购合同表单无效')
  }
  try {
    const draft = decodeMaterialContractDraft(value.draft)
    if (draft.id !== id)
      return invalid('中央后台返回的材料采购合同表单 ID 无效')
    return {
      draft: { ...draft, id },
      attachments: value.attachments.map(row => decodeMaterialContractAttachment(row, id)),
      version: value.version,
      updatedAt: value.updatedAt,
    }
  }
  catch (cause) {
    if (cause instanceof MaterialContractCommandValidationError)
      return invalid(`中央后台返回的材料采购合同表单无效：${cause.message}`)
    throw cause
  }
}

export function createHttpMaterialContractCommandRepository(
  options: { fetcher: MaterialContractHttpFetcher },
): MaterialContractCommandRepository {
  return {
    context: () => readMaterialContractHttp(
      () => options.fetcher('/api/read/material-contracts/form-context'),
      context,
    ),
    loadForm: id => readMaterialContractHttp(
      () => options.fetcher(`/api/read/material-contracts/${encodeURIComponent(id)}/form`),
      value => form(value, id),
    ),
    execute: request => readMaterialContractHttp(
      () => options.fetcher(request.id
        ? `/api/commands/material-contracts/${encodeURIComponent(request.id)}`
        : '/api/commands/material-contracts', {
        method: request.id ? 'PUT' : 'POST',
        body: { ...request },
      }),
      result,
    ),
  }
}
