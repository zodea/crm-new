export type OpaqueIdDTO = string
export type BusinessCodeDTO = string
export type ISODateDTO = string
export type ISODateTimeDTO = string
export type MoneyDTO = string
export type QuantityDTO = string
export type RatioDTO = string
export type CountDTO = number

export const DATA_ORIGINS = ['real', 'demo'] as const
export type DataOriginDTO = typeof DATA_ORIGINS[number]

const DATA_ORIGIN_SET: ReadonlySet<string> = new Set(DATA_ORIGINS)

export function isDataOriginDTO(value: unknown): value is DataOriginDTO {
  return typeof value === 'string' && DATA_ORIGIN_SET.has(value)
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const ISO_DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/

export function isISODateDTO(value: unknown): value is ISODateDTO {
  if (typeof value !== 'string')
    return false
  const match = ISO_DATE_PATTERN.exec(value)
  if (!match)
    return false
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3])
}

export function isISODateTimeDTO(value: unknown): value is ISODateTimeDTO {
  if (typeof value !== 'string')
    return false
  const match = ISO_DATE_TIME_PATTERN.exec(value)
  return Boolean(match && isISODateDTO(match[1]) && Number.isFinite(Date.parse(value)))
}

export const ENTITY_KINDS = [
  'project',
  'customer',
  'supplier',
  'crew',
  'worker',
  'contract',
  'settlement',
  'owner-document',
  'subcontract-document',
  'invoice-application',
  'invoice',
  'receipt',
  'current-transaction',
  'payment-application',
  'payment-record',
  'expense-reimbursement',
  'material',
  'material-document',
  'delivery-record',
  'warehouse',
  'wage-statement',
  'attendance',
  'schedule-group',
  'schedule-task',
  'quantity-unit',
  'target-cost',
  'file',
] as const

export type EntityKindDTO = typeof ENTITY_KINDS[number]

const ENTITY_KIND_SET: ReadonlySet<string> = new Set(ENTITY_KINDS)

export function isEntityKindDTO(value: unknown): value is EntityKindDTO {
  return typeof value === 'string' && ENTITY_KIND_SET.has(value)
}

export type EntityRefDTO
  = {
    state: 'resolved'
    entity: EntityKindDTO
    id: OpaqueIdDTO
    label: string
    no: BusinessCodeDTO | null
  }
  | {
    state: 'missing'
    entity: EntityKindDTO
    id: null
    label: null
    reason: 'not-configured' | 'not-recorded' | 'not-applicable'
  }
  | {
    state: 'forbidden'
    entity: EntityKindDTO
    id: OpaqueIdDTO | null
    label: null
    reason: 'permission-denied'
  }

export interface PaginationDTO {
  page: number
  pageSize: number
  total: CountDTO
}

export interface EmptyDTO {
  reason: 'no-records' | 'no-filter-match' | 'missing-relation'
  missingRelations: EntityKindDTO[]
}

export interface PageDTO<T, S = null> {
  items: T[]
  pagination: PaginationDTO
  summary: S
  empty: EmptyDTO | null
  asOf: ISODateTimeDTO
  sourceVersion: string | null
  capabilities: string[]
}

export type CompletenessDTO
  = 'complete' | 'partial' | 'pending' | 'not-applicable' | 'undefined'

export interface MetricDTO {
  value: MoneyDTO | QuantityDTO | RatioDTO | CountDTO | null
  unit: 'CNY' | 'quantity' | 'ratio' | 'count'
  status: CompletenessDTO
  missingSources: string[]
  asOf: ISODateTimeDTO
  drilldown: {
    entity: EntityKindDTO
    filters: Record<string, string>
  } | null
}

export const PROBLEM_CODES = [
  'invalid-query',
  'forbidden',
  'not-found',
  'relationship-mismatch',
  'validation-failed',
  'stale-source',
  'conflict',
  'unavailable',
  'internal-error',
] as const

export type ProblemCodeDTO = typeof PROBLEM_CODES[number]

const PROBLEM_CODE_SET: ReadonlySet<string> = new Set(PROBLEM_CODES)

export function isProblemCodeDTO(value: unknown): value is ProblemCodeDTO {
  return typeof value === 'string' && PROBLEM_CODE_SET.has(value)
}

export interface ProblemDTO {
  code: ProblemCodeDTO
  message: string
  retryable: boolean
  fieldErrors: Record<string, string[]>
  traceId: string | null
}

export type ReadState<T>
  = { kind: 'idle' }
    | { kind: 'loading', previous: T | null }
    | { kind: 'ready', data: T }
    | { kind: 'partial', data: T, missingRelations: EntityKindDTO[] }
    | { kind: 'empty', data: T, empty: EmptyDTO }
    | { kind: 'forbidden', problem: ProblemDTO }
    | { kind: 'not-found', problem: ProblemDTO }
    | { kind: 'mismatch', problem: ProblemDTO }
    | { kind: 'error', problem: ProblemDTO, previous: T | null }
