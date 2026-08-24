import type {
  ConstructionContractCommandContextDTO,
  ConstructionContractCommandRepository,
  ConstructionContractCommandResultDTO,
  ConstructionContractFormReadDTO,
} from './command-contract'
import type { ConstructionContractHttpFetcher } from './http-repository'
import { isISODateTimeDTO } from '../../types/read-model'
import {
  ConstructionContractCommandValidationError,
  decodeConstructionContractAttachment,
  decodeConstructionContractDraft,
} from './command-validation'
import { readConstructionContractHttp } from './http-repository'
import { constructionContractProblem, ConstructionContractRepositoryProblem } from './read-contract'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(message: string): never {
  throw new ConstructionContractRepositoryProblem(constructionContractProblem('internal-error', message))
}

function context(value: unknown): ConstructionContractCommandContextDTO {
  if (!object(value) || typeof value.workspaceId !== 'string' || typeof value.actorId !== 'string'
    || !Array.isArray(value.capabilities) || !Array.isArray(value.projects) || !Array.isArray(value.customers)) {
    return invalid('中央后台返回的施工合同业务会话无效')
  }
  return value as unknown as ConstructionContractCommandContextDTO
}

function result(value: unknown): ConstructionContractCommandResultDTO {
  if (!object(value) || typeof value.id !== 'string' || typeof value.commandId !== 'string'
    || typeof value.version !== 'string' || !isISODateTimeDTO(value.updatedAt)
    || !Array.isArray(value.attachmentIds) || !value.attachmentIds.every(id => typeof id === 'string')) {
    return invalid('中央后台返回的施工合同命令结果无效')
  }
  return value as unknown as ConstructionContractCommandResultDTO
}

function form(value: unknown, id: string): ConstructionContractFormReadDTO {
  if (!object(value) || !Array.isArray(value.attachments) || typeof value.version !== 'string' || !isISODateTimeDTO(value.updatedAt))
    return invalid('中央后台返回的施工合同表单无效')
  try {
    const draft = decodeConstructionContractDraft(value.draft)
    if (draft.id !== id)
      return invalid('中央后台返回的施工合同表单 ID 无效')
    return {
      draft: { ...draft, id },
      attachments: value.attachments.map(row => decodeConstructionContractAttachment(row, id)),
      version: value.version,
      updatedAt: value.updatedAt,
    }
  }
  catch (cause) {
    if (cause instanceof ConstructionContractCommandValidationError)
      return invalid(`中央后台返回的施工合同表单无效：${cause.message}`)
    throw cause
  }
}

export function createHttpConstructionContractCommandRepository(
  options: { fetcher: ConstructionContractHttpFetcher },
): ConstructionContractCommandRepository {
  return {
    context: () => readConstructionContractHttp(
      () => options.fetcher('/api/read/construction-contracts/form-context'),
      context,
    ),
    loadForm: id => readConstructionContractHttp(
      () => options.fetcher(`/api/read/construction-contracts/${encodeURIComponent(id)}/form`),
      value => form(value, id),
    ),
    execute: request => readConstructionContractHttp(
      () => options.fetcher(request.id
        ? `/api/commands/construction-contracts/${encodeURIComponent(request.id)}`
        : '/api/commands/construction-contracts', {
        method: request.id ? 'PUT' : 'POST',
        body: request,
      }),
      result,
    ),
  }
}
