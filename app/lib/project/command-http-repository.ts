import type {
  ProjectCommandContextDTO,
  ProjectCommandRepository,
  ProjectCommandResultDTO,
  ProjectFormReadDTO,
} from './command-contract'
import type { ProjectHttpFetcher } from './http-repository'
import { isISODateTimeDTO } from '../../types/read-model'
import {
  decodeProjectFormDraft,
  ProjectCommandValidationError,
} from './command-validation'
import { readProjectHttp } from './http-repository'
import { projectProblem, ProjectRepositoryProblem } from './repository'

interface HttpProjectCommandRepositoryOptions {
  fetcher: ProjectHttpFetcher
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidResponse(message: string): never {
  throw new ProjectRepositoryProblem(projectProblem('internal-error', message))
}

function decodeContext(value: unknown): ProjectCommandContextDTO {
  if (!isObject(value)
    || typeof value.workspaceId !== 'string'
    || typeof value.actorId !== 'string'
    || !Array.isArray(value.capabilities)
    || !value.capabilities.every(capability => typeof capability === 'string')) {
    return invalidResponse('中央后台返回的业务会话无效')
  }
  return value as unknown as ProjectCommandContextDTO
}

function decodeCommandResult(value: unknown): ProjectCommandResultDTO {
  if (!isObject(value)
    || typeof value.id !== 'string'
    || typeof value.commandId !== 'string'
    || typeof value.version !== 'string'
    || !isISODateTimeDTO(value.updatedAt)
    || !Array.isArray(value.attachmentIds)
    || !value.attachmentIds.every(id => typeof id === 'string')) {
    return invalidResponse('中央后台返回的项目命令结果无效')
  }
  return value as unknown as ProjectCommandResultDTO
}

function decodeAttachment(value: unknown): boolean {
  return isObject(value)
    && typeof value.id === 'string'
    && value.ownerType === 'project'
    && typeof value.ownerId === 'string'
    && typeof value.fileName === 'string'
    && typeof value.filePath === 'string'
    && typeof value.fileSize === 'number'
    && typeof value.mimeType === 'string'
    && typeof value.category === 'string'
    && typeof value.uploader === 'string'
    && isISODateTimeDTO(value.uploadedAt)
    && (value.deletedAt === null || isISODateTimeDTO(value.deletedAt))
}

function decodeForm(value: unknown, expectedId: string): ProjectFormReadDTO {
  if (!isObject(value)
    || !Array.isArray(value.attachments)
    || !value.attachments.every(decodeAttachment)
    || typeof value.version !== 'string'
    || !isISODateTimeDTO(value.updatedAt)) {
    return invalidResponse('中央后台返回的项目表单无效')
  }
  try {
    const draft = decodeProjectFormDraft(value.draft)
    if (draft.id !== expectedId)
      return invalidResponse('中央后台返回的项目表单 ID 无效')
    return {
      draft: { ...draft, id: draft.id },
      attachments: value.attachments as ProjectFormReadDTO['attachments'],
      version: value.version,
      updatedAt: value.updatedAt,
    }
  }
  catch (cause) {
    if (cause instanceof ProjectCommandValidationError)
      return invalidResponse(`中央后台返回的项目表单无效：${cause.message}`)
    throw cause
  }
}

export function createHttpProjectCommandRepository(
  options: HttpProjectCommandRepositoryOptions,
): ProjectCommandRepository {
  return {
    context: () => readProjectHttp(
      () => options.fetcher('/api/read/business-session'),
      decodeContext,
    ),
    loadForm: id => readProjectHttp(
      () => options.fetcher(`/api/read/projects/${encodeURIComponent(id)}/form`),
      value => decodeForm(value, id),
    ),
    execute: request => readProjectHttp(
      () => options.fetcher(
        request.id
          ? `/api/commands/projects/${encodeURIComponent(request.id)}`
          : '/api/commands/projects',
        {
          method: request.id ? 'PUT' : 'POST',
          body: { ...request },
        },
      ),
      decodeCommandResult,
    ),
  }
}
