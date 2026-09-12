import type { SupplierFormDraft } from '../master-data/forms'
import type {
  SupplierCommandContextDTO,
  SupplierCommandRepository,
  SupplierCommandResultDTO,
  SupplierFormReadDTO,
} from './command-contract'
import type { SupplierHttpFetcher } from './http-repository'
import type { SupplierTaxpayerCommand, SupplierTaxpayerResult } from './taxpayer-verification'
import { isISODateTimeDTO } from '../../types/read-model'
import { readSupplierHttp } from './http-repository'
import { supplierProblem, SupplierRepositoryProblem } from './repository'
import { TAXPAYER_TYPES, TAXPAYER_VERIFICATION_LABELS, verifiedTaxpayerFields } from './taxpayer-verification'

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
  'laborScope',
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
  const loaded = value as unknown as SupplierFormReadDTO
  return { ...loaded, draft: { ...loaded.draft, laborScope: loaded.draft.laborScope ?? '' } }
}

function taxpayerResult(value: unknown, request: SupplierTaxpayerCommand): SupplierTaxpayerResult {
  if (!object(value) || value.supplierId !== request.supplierId || value.commandId !== request.commandId
    || !['supplierVersion', 'credentialVersion', 'auditId'].every(key => typeof value[key] === 'string' && value[key])
    || value.credentialId !== null || value.deletionToken !== null || !object(value.verification)) {
    return invalid('中央税务核验结果身份或版本无效')
  }
  const proof = value.verification
  if (!TAXPAYER_TYPES.includes(proof.taxpayerType as never) || !Object.hasOwn(TAXPAYER_VERIFICATION_LABELS, String(proof.taxpayerVerificationStatus))
    || typeof proof.taxpayerVerificationSource !== 'string' || typeof proof.taxpayerVerificationNote !== 'string' || !isISODateTimeDTO(proof.taxpayerVerifiedAt)) {
    return invalid('中央税务核验凭证不完整')
  }
  const expected = verifiedTaxpayerFields(request.draft, proof.taxpayerVerifiedAt)
  if (Object.entries(expected).some(([key, value]) => proof[key] !== value))
    return invalid('中央税务核验结果与本次人工输入不一致')
  return structuredClone(value) as unknown as SupplierTaxpayerResult
}

export function createHttpSupplierCommandRepository(options: { fetcher: SupplierHttpFetcher }): SupplierCommandRepository {
  return {
    recordTaxpayerVerification: request => readSupplierHttp(
      () => options.fetcher(`/api/commands/suppliers/${encodeURIComponent(request.supplierId)}/taxpayer-verification`, { method: 'POST', body: { ...request } }),
      value => taxpayerResult(value, request),
    ),
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
    importRow: request => readSupplierHttp(
      () => options.fetcher('/api/commands/suppliers/import', { method: 'POST', body: { ...request } }),
      result,
    ),
  }
}
