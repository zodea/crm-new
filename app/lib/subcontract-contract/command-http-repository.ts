import type {
  SubcontractContractCommandContextDTO,
  SubcontractContractCommandRepository,
  SubcontractContractCommandResultDTO,
  SubcontractContractFormReadDTO,
} from './command-contract'
import type { SubcontractContractHttpFetcher } from './http-repository'
import { isISODateTimeDTO } from '../../types/read-model'
import { decodeConstructionMainSelection } from '../construction-scope/contract'
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
function mainOption(value: unknown): boolean {
  if (!object(value) || typeof value.name !== 'string' || typeof value.no !== 'string' || typeof value.projectName !== 'string')
    return false
  try {
    decodeConstructionMainSelection({ id: value.id, projectId: value.projectId, basis: value.basis })
    return true
  }
  catch { return false }
}

function context(value: unknown): SubcontractContractCommandContextDTO {
  if (!object(value) || typeof value.workspaceId !== 'string' || typeof value.actorId !== 'string'
    || !Array.isArray(value.capabilities) || !Array.isArray(value.projects) || !Array.isArray(value.suppliers)
    || !value.suppliers.every(row => object(row) && typeof row.id === 'string' && typeof row.label === 'string'
      && (row.contactName === undefined || typeof row.contactName === 'string')
      && (row.contactPhone === undefined || typeof row.contactPhone === 'string'))
    || !value.projects.every(row => object(row) && typeof row.id === 'string' && typeof row.label === 'string')
    || (value.constructionMains !== undefined && (!Array.isArray(value.constructionMains) || !value.constructionMains.every(mainOption)))) {
    return invalid('中央后台返回的分包合同业务会话无效')
  }
  return value as unknown as SubcontractContractCommandContextDTO
}

function result(value: unknown): SubcontractContractCommandResultDTO {
  if (!object(value) || typeof value.id !== 'string' || !value.id.trim() || typeof value.commandId !== 'string' || !value.commandId.trim()
    || typeof value.version !== 'string' || !value.version.trim() || !isISODateTimeDTO(value.updatedAt)
    || !Array.isArray(value.attachmentIds) || !value.attachmentIds.every(id => typeof id === 'string' && !!id.trim())) {
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
      ...(value.constructionMain !== undefined ? { constructionMain: value.constructionMain === null ? null : decodeConstructionMainSelection(value.constructionMain) } : {}),
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
      (value) => {
        const saved = result(value)
        if (saved.commandId !== request.commandId || (request.id && saved.id !== request.id))
          return invalid('中央后台返回了另一分包合同提交结果')
        return saved
      },
    ),
    resolve: commandId => readSubcontractContractHttp(
      () => options.fetcher('/api/commands/subcontract-contracts/resolve', { method: 'POST', body: { commandId } }),
      (value) => {
        if (!object(value))
          return invalid('中央后台返回的分包合同原提交核对结果无效')
        if (value.outcome === 'applied') {
          const original = result(value.result)
          if (original.commandId !== commandId)
            return invalid('中央后台返回了另一分包合同提交结果')
          return { outcome: 'applied' as const, result: original }
        }
        if (value.outcome === 'not-applied' && value.commandId === commandId)
          return { outcome: 'not-applied' as const, commandId }
        return invalid('中央后台没有证明原分包合同提交结果')
      },
    ),
  }
}
