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

export interface AuthorizedScopeDTO {
  coverage: 'complete' | 'permission-filtered' | 'unknown'
  fingerprint: string
}
export interface SourceEvidenceDTO {
  key: string
  state: 'readable' | 'forbidden' | 'unavailable' | 'not-requested'
  sourceVersion: string | null
  asOf: ISODateTimeDTO | null
}
export interface ReadMetaDTO {
  schemaVersion: string
  workspaceId: OpaqueIdDTO
  actorId: OpaqueIdDTO
  dataOrigin: DataOriginDTO
  asOf: ISODateTimeDTO
  sourceVersion: string | null
  sources: SourceEvidenceDTO[]
  authorizedScope: AuthorizedScopeDTO
  capabilities: string[]
}
export type ReadProjection<T> = Omit<T, 'meta' | 'originMeta'>

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
  'material-quotation',
  'delivery-record',
  'warehouse',
  'wage-statement',
  'wage-adjustment',
  'wage-actual',
  'attendance',
  'daywork',
  'schedule-group',
  'schedule-task',
  'process-library',
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
    id: null
    label: null
    reason: 'permission-denied'
  }
  | {
    state: 'unavailable'
    entity: EntityKindDTO
    id: null
    label: null
    reason: 'source-unavailable'
  }

/** 公共引用不允许额外定位字段；受限/不可用身份必须完全置空。 */
export function isEntityRefDTO(value: unknown, expectedEntity?: EntityKindDTO): value is EntityRefDTO {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false
  const ref = value as Record<string, unknown>
  if (!isEntityKindDTO(ref.entity) || (expectedEntity !== undefined && ref.entity !== expectedEntity))
    return false
  const keys = ref.state === 'resolved' ? ['state', 'entity', 'id', 'label', 'no'] : ['state', 'entity', 'id', 'label', 'reason']
  if (Object.keys(ref).length !== keys.length || !keys.every(key => Object.hasOwn(ref, key)))
    return false
  if (ref.state === 'resolved')
    return typeof ref.id === 'string' && !!ref.id.trim() && typeof ref.label === 'string' && (ref.no === null || typeof ref.no === 'string')
  if (ref.id !== null || ref.label !== null)
    return false
  return (ref.state === 'missing' && ['not-configured', 'not-recorded', 'not-applicable'].includes(String(ref.reason)))
    || (ref.state === 'forbidden' && ref.reason === 'permission-denied')
    || (ref.state === 'unavailable' && ref.reason === 'source-unavailable')
}

export type NavigationUnavailableReasonDTO
  = 'missing-id' | 'missing-route' | 'not-connected' | 'forbidden' | 'unverified-target' | 'error'

interface EntityNavigationIntentDTO<Kind extends 'entity-detail' | 'entity-subview' | 'source-record'> {
  kind: Kind
  subject: EntityRefDTO
  variant: string | null
  view: string | null
  filters: Record<string, OpaqueIdDTO | BusinessCodeDTO | null>
}

export type NavigationIntentDTO
  = EntityNavigationIntentDTO<'entity-detail'>
    | EntityNavigationIntentDTO<'entity-subview'>
    | EntityNavigationIntentDTO<'source-record'>
    | {
      kind: 'entity-list'
      entity: EntityKindDTO
      variant: string | null
      view: string | null
      filters: Record<string, OpaqueIdDTO | BusinessCodeDTO | null>
    }
    | {
      kind: 'same-route-overlay'
      subject: EntityRefDTO
      view: string
    }
    | {
      kind: 'unavailable'
      reason: NavigationUnavailableReasonDTO
    }

/** 非可解析引用的导航只携带状态，不能附加 subject、filters 或目标身份。 */
export function isUnavailableEntityNavigationDTO(value: unknown, reference: EntityRefDTO): boolean {
  if (reference.state === 'resolved' || typeof value !== 'object' || value === null || Array.isArray(value))
    return false
  const navigation = value as Record<string, unknown>
  const reason = reference.state === 'forbidden' ? 'forbidden' : reference.state === 'unavailable' ? 'not-connected' : 'missing-id'
  return Object.keys(navigation).length === 2 && navigation.kind === 'unavailable' && navigation.reason === reason
}

export function isNavigationIntentDTO(value: unknown): value is NavigationIntentDTO {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false
  const intent = value as Record<string, unknown>
  if (intent.kind === 'unavailable')
    return Object.keys(intent).length === 2 && ['missing-id', 'missing-route', 'not-connected', 'forbidden', 'unverified-target', 'error'].includes(String(intent.reason))
  if (intent.kind === 'same-route-overlay')
    return Object.keys(intent).length === 3 && isEntityRefDTO(intent.subject) && intent.subject.state === 'resolved' && typeof intent.view === 'string' && !!intent.view
  if (!['entity-list', 'entity-detail', 'entity-subview', 'source-record'].includes(String(intent.kind))
    || Object.keys(intent).length !== 5 || !(intent.variant === null || typeof intent.variant === 'string')
    || !(intent.view === null || typeof intent.view === 'string') || typeof intent.filters !== 'object' || intent.filters === null || Array.isArray(intent.filters)
    || !Object.values(intent.filters).every(filter => filter === null || typeof filter === 'string')) {
    return false
  }
  return intent.kind === 'entity-list' ? isEntityKindDTO(intent.entity) : isEntityRefDTO(intent.subject) && intent.subject.state === 'resolved'
}

export interface PaginationDTO {
  requestedPage: number
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
  knownValue: MoneyDTO | QuantityDTO | RatioDTO | CountDTO | null
  unit: 'CNY' | 'quantity' | 'ratio' | 'count'
  quantityUnit: string | null
  status: CompletenessDTO
  missingSources: string[]
  participatingCount: CountDTO | null
  missingCount: CountDTO | null
  asOf: ISODateTimeDTO
  drilldown: NavigationIntentDTO | null
}

export const PROBLEM_CODES = [
  'invalid-query',
  'unauthenticated',
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
    | { kind: 'empty', data: T, empty: EmptyDTO }
    | { kind: 'forbidden', problem: ProblemDTO }
    | { kind: 'not-found', problem: ProblemDTO }
    | { kind: 'mismatch', problem: ProblemDTO }
    | { kind: 'unavailable', problem: ProblemDTO, previous: T | null }
    | { kind: 'error', problem: ProblemDTO, previous: T | null }
