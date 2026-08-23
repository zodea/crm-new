import type { SupplierFormDraft } from '../master-data/forms'
import type {
  SupplierCommandContextDTO,
  SupplierCommandRepository,
  SupplierCommandResultDTO,
  SupplierFormReadDTO,
} from './command-contract'
import type { SupplierHttpFetcher } from './http-repository'
import { isISODateTimeDTO } from '../../types/read-model'
import { readSupplierHttp } from './http-repository'
import { supplierProblem, SupplierRepositoryProblem } from './repository'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(message: string): never {
  throw new SupplierRepositoryProblem(supplierProblem('internal-error', message))
}

function context(value: unknown): SupplierCommandContextDTO {
  if (!object(value) || typeof value.workspaceId !== 'string' || typeof value.actorId !== 'string'
    || !Array.isArray(value.capabilities) || !value.capabilities.every(item => typeof item === 'string')) {
    return invalid('中央后台返回的业务会话无效')
  }
  return value as unknown as SupplierCommandContextDTO
}

function result(value: unknown): SupplierCommandResultDTO {
  if (!object(value) || typeof value.id !== 'string' || typeof value.commandId !== 'string'
    || typeof value.version !== 'string' || !isISODateTimeDTO(value.updatedAt)
    || !Array.isArray(value.attachmentIds) || !value.attachmentIds.every(item => typeof item === 'string')) {
    return invalid('中央后台返回的分供方命令结果无效')
  }
  return value as unknown as SupplierCommandResultDTO
}

const TEXT_FIELDS = [
  'id',
  'name',
  'externalRef',
  'uniqueCode',
  'taxNo',
  'businessType',
  'supplierCategory',
  'rating',
  'legalRep',
  'registeredDate',
  'address',
  'taxpayerType',
  'taxpayerVerificationStatus',
  'taxpayerVerificationSource',
  'taxpayerVerificationNote',
  'mainBusiness',
  'invoiceName',
  'invoiceAddress',
  'bank',
  'bankAccount',
  'phone',
  'contact',
  'contactPhone',
  'contactTitle',
  'note',
  'approvalStatus',
] as const satisfies readonly (keyof SupplierFormDraft)[]

function draft(value: unknown, id: string): value is SupplierFormDraft {
  return object(value) && value.id === id
    && TEXT_FIELDS.every(field => value[field] === undefined || typeof value[field] === 'string')
    && (value.aliases === undefined || (Array.isArray(value.aliases) && value.aliases.every(item => typeof item === 'string')))
    && (value.registeredCapital === undefined || value.registeredCapital === null
      || (typeof value.registeredCapital === 'number' && Number.isFinite(value.registeredCapital) && value.registeredCapital >= 0))
    && (value.taxpayerVerifiedAt === undefined || value.taxpayerVerifiedAt === null || typeof value.taxpayerVerifiedAt === 'string')
}

function form(value: unknown, id: string): SupplierFormReadDTO {
  if (!object(value) || !draft(value.draft, id)
    || !Array.isArray(value.attachments) || value.attachments.length !== 0
    || typeof value.version !== 'string' || !isISODateTimeDTO(value.updatedAt)) {
    return invalid('中央后台返回的分供方表单无效')
  }
  return value as unknown as SupplierFormReadDTO
}

export function createHttpSupplierCommandRepository(options: { fetcher: SupplierHttpFetcher }): SupplierCommandRepository {
  return {
    context: () => readSupplierHttp(() => options.fetcher('/api/read/business-session'), context),
    loadForm: id => readSupplierHttp(() => options.fetcher(`/api/read/suppliers/${encodeURIComponent(id)}/form`), value => form(value, id)),
    execute: request => readSupplierHttp(
      () => options.fetcher(request.id
        ? `/api/commands/suppliers/${encodeURIComponent(request.id)}`
        : '/api/commands/suppliers', {
        method: request.id ? 'PUT' : 'POST',
        body: { ...request },
      }),
      result,
    ),
  }
}
