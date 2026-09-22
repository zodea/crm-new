import type { CustomerFormDraft, FormAttachment } from '../master-data/forms'
import type {
  CustomerCommandContextDTO,
  CustomerCommandRepository,
  CustomerCommandResultDTO,
  CustomerFormReadDTO,
} from './command-contract'
import type { CustomerHttpFetcher } from './http-repository'
import { isISODateTimeDTO } from '../../types/read-model'
import { readCustomerHttp } from './http-repository'
import { customerProblem, CustomerRepositoryProblem } from './repository'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(message: string): never {
  throw new CustomerRepositoryProblem(customerProblem('internal-error', message))
}

function context(value: unknown): CustomerCommandContextDTO {
  if (!object(value) || typeof value.workspaceId !== 'string' || typeof value.actorId !== 'string'
    || !Array.isArray(value.capabilities) || !value.capabilities.every(item => typeof item === 'string')) {
    return invalid('中央后台返回的业务会话无效')
  }
  return value as unknown as CustomerCommandContextDTO
}

export function decodeCustomerCommandResult(value: unknown): CustomerCommandResultDTO {
  if (!object(value) || typeof value.id !== 'string' || typeof value.commandId !== 'string'
    || typeof value.version !== 'string' || !isISODateTimeDTO(value.updatedAt)
    || !Array.isArray(value.attachmentIds) || !value.attachmentIds.every(item => typeof item === 'string')) {
    return invalid('中央后台返回的客户命令结果无效')
  }
  return value as unknown as CustomerCommandResultDTO
}

const DRAFT_TEXT_FIELDS = [
  'id',
  'name',
  'taxNo',
  'legalRep',
  'registeredAddress',
  'invoiceName',
  'bank',
  'bankAccount',
  'contact',
  'contactPhone',
  'note',
  'status',
] as const satisfies readonly (keyof CustomerFormDraft)[]

function draft(value: unknown, id: string): value is CustomerFormDraft {
  return object(value)
    && value.id === id
    && DRAFT_TEXT_FIELDS.every(field => value[field] === undefined || typeof value[field] === 'string')
    && (value.aliases === undefined || (Array.isArray(value.aliases) && value.aliases.every(item => typeof item === 'string')))
}

function attachment(value: unknown, id: string): value is FormAttachment {
  return object(value)
    && typeof value.id === 'string'
    && value.ownerType === 'customer'
    && value.ownerId === id
    && ['fileName', 'filePath', 'mimeType', 'category', 'uploader'].every(field => typeof value[field] === 'string')
    && typeof value.fileSize === 'number' && Number.isFinite(value.fileSize) && value.fileSize >= 0
    && isISODateTimeDTO(value.uploadedAt)
    && (value.deletedAt === null || isISODateTimeDTO(value.deletedAt))
}

function form(value: unknown, id: string): CustomerFormReadDTO {
  if (!object(value) || !draft(value.draft, id)
    || !Array.isArray(value.attachments) || !value.attachments.every(item => attachment(item, id))
    || typeof value.version !== 'string' || !isISODateTimeDTO(value.updatedAt)) {
    return invalid('中央后台返回的客户表单无效')
  }
  return value as unknown as CustomerFormReadDTO
}

export function createHttpCustomerCommandRepository(options: { fetcher: CustomerHttpFetcher }): CustomerCommandRepository {
  return {
    context: () => readCustomerHttp(() => options.fetcher('/api/read/business-session'), context),
    loadForm: id => readCustomerHttp(() => options.fetcher(`/api/read/customers/${encodeURIComponent(id)}/form`), value => form(value, id)),
    execute: request => readCustomerHttp(
      () => options.fetcher(request.id
        ? `/api/commands/customers/${encodeURIComponent(request.id)}`
        : '/api/commands/customers', {
        method: request.id ? 'PUT' : 'POST',
        body: { ...request },
      }),
      decodeCustomerCommandResult,
    ),
  }
}
