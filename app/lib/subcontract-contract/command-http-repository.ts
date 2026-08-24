import type {
  SubcontractContractCommandContextDTO,
  SubcontractContractCommandRepository,
  SubcontractContractCommandResultDTO,
  SubcontractContractFormReadDTO,
} from './command-contract'
import type { SubcontractContractHttpFetcher } from './http-repository'
import { isISODateTimeDTO } from '../../types/read-model'
import {
  decodeSubcontractContractAttachment,
  decodeSubcontractContractDraft,
  SubcontractContractCommandValidationError,
} from './command-validation'
import { readSubcontractContractHttp } from './http-repository'
import { subcontractContractProblem, SubcontractContractRepositoryProblem } from './read-contract'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(message: string): never {
  throw new SubcontractContractRepositoryProblem(subcontractContractProblem('internal-error', message))
}

function context(value: unknown): SubcontractContractCommandContextDTO {
  if (!object(value) || typeof value.workspaceId !== 'string' || typeof value.actorId !== 'string'
    || !Array.isArray(value.capabilities) || !Array.isArray(value.projects) || !Array.isArray(value.suppliers)) {
    return invalid('中央后台返回的分包合同业务会话无效')
  }
  return value as unknown as SubcontractContractCommandContextDTO
}

function result(value: unknown): SubcontractContractCommandResultDTO {
  if (!object(value) || typeof value.id !== 'string' || typeof value.commandId !== 'string'
    || typeof value.version !== 'string' || !isISODateTimeDTO(value.updatedAt)
    || !Array.isArray(value.attachmentIds) || !value.attachmentIds.every(id => typeof id === 'string')) {
    return invalid('中央后台返回的分包合同命令结果无效')
  }
  return value as unknown as SubcontractContractCommandResultDTO
}

function form(value: unknown, id: string): SubcontractContractFormReadDTO {
  if (!object(value) || !Array.isArray(value.attachments) || typeof value.version !== 'string' || !isISODateTimeDTO(value.updatedAt))
    return invalid('中央后台返回的分包合同表单无效')
  try {
    const draft = decodeSubcontractContractDraft(value.draft)
    if (draft.id !== id)
      return invalid('中央后台返回的分包合同表单 ID 无效')
    return {
      draft: { ...draft, id },
      attachments: value.attachments.map(row => decodeSubcontractContractAttachment(row, id)),
      version: value.version,
      updatedAt: value.updatedAt,
    }
  }
  catch (cause) {
    if (cause instanceof SubcontractContractCommandValidationError)
      return invalid(`中央后台返回的分包合同表单无效：${cause.message}`)
    throw cause
  }
}

export function createHttpSubcontractContractCommandRepository(
  options: { fetcher: SubcontractContractHttpFetcher },
): SubcontractContractCommandRepository {
  return {
    context: () => readSubcontractContractHttp(
      () => options.fetcher('/api/read/subcontract-contracts/form-context'),
      context,
    ),
    loadForm: id => readSubcontractContractHttp(
      () => options.fetcher(`/api/read/subcontract-contracts/${encodeURIComponent(id)}/form`),
      value => form(value, id),
    ),
    execute: request => readSubcontractContractHttp(
      () => options.fetcher(request.id
        ? `/api/commands/subcontract-contracts/${encodeURIComponent(request.id)}`
        : '/api/commands/subcontract-contracts', {
        method: request.id ? 'PUT' : 'POST',
        body: request,
      }),
      result,
    ),
  }
}
