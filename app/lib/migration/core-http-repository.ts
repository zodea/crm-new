import type { ProblemCodeDTO } from '../../types/read-model'
import type {
  CoreMigrationBatchCommandDTO,
  CoreMigrationBatchDTO,
  CoreMigrationCommandEnvelopeDTO,
  CoreMigrationEntityType,
  CoreMigrationIssueDTO,
  CoreMigrationPreflightDTO,
  CoreMigrationServerEntityDTO,
  CoreMigrationSnapshotDTO,
  CoreMigrationSourceCommandDTO,
} from './core-contract'
import { isISODateTimeDTO, isProblemCodeDTO } from '../../types/read-model'

import {
  CORE_MIGRATION_CAPABILITY,
  CORE_MIGRATION_CONTRACT_VERSION,
  CORE_MIGRATION_SOURCE_MODE,
  CORE_MIGRATION_TOPOLOGY,
  isCoreMigrationMoney,
} from './core-contract'

export interface CoreMigrationCommandContextDTO {
  workspaceId: string
  actorId: string
  capabilities: string[]
}

export interface CoreMigrationHttpFetchOptions {
  method: 'POST'
  body: CoreMigrationSourceCommandDTO | CoreMigrationBatchCommandDTO
}

export type CoreMigrationHttpFetcher = (
  url: string,
  options?: CoreMigrationHttpFetchOptions,
) => Promise<unknown>

export interface CoreMigrationRepository {
  context: () => Promise<CoreMigrationCommandContextDTO>
  preflight: (command: CoreMigrationSourceCommandDTO) => Promise<CoreMigrationPreflightDTO>
  dryRun: (command: CoreMigrationSourceCommandDTO) => Promise<CoreMigrationBatchDTO>
  importBatch: (command: CoreMigrationBatchCommandDTO) => Promise<CoreMigrationBatchDTO>
  confirm: (command: CoreMigrationBatchCommandDTO) => Promise<CoreMigrationBatchDTO>
  rollback: (command: CoreMigrationBatchCommandDTO) => Promise<CoreMigrationBatchDTO>
  snapshot: () => Promise<CoreMigrationSnapshotDTO>
}

interface HttpCoreMigrationRepositoryOptions {
  fetcher: CoreMigrationHttpFetcher
}

export class CoreMigrationHttpError extends Error {
  constructor(
    public readonly code: ProblemCodeDTO,
    message: string,
    public readonly retryable: boolean,
    public readonly fieldErrors: Record<string, string[]> = {},
    public readonly traceId: string | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'CoreMigrationHttpError'
  }
}

const ENTITY_TYPES = new Set<string>(CORE_MIGRATION_TOPOLOGY)
const BATCH_STATUSES = new Set(['dry-run', 'applied', 'confirmed', 'rolled-back', 'failed'])
const ISSUE_METRICS = new Set([
  'count',
  'amount',
  'quantity',
  'missing-relation',
  'orphan',
  'soft-delete',
  'soft-delete-mismatch',
  'duplicate-source',
  'apply-failed',
])
const ISSUE_ATTRIBUTIONS = new Set(['source', 'mapping', 'missing-source', 'system'])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value)
}

function isMoney(value: unknown): value is string {
  return isCoreMigrationMoney(value)
}

function isNullableMoney(value: unknown): value is string | null {
  return value === null || isMoney(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isEntityType(value: unknown): value is CoreMigrationEntityType {
  return isString(value) && ENTITY_TYPES.has(value)
}

function invalidResponse(message: string): never {
  throw new CoreMigrationHttpError('internal-error', message, false)
}

function decodeContext(value: unknown): CoreMigrationCommandContextDTO {
  if (!isObject(value)
    || !isString(value.workspaceId)
    || !isString(value.actorId)
    || !Array.isArray(value.capabilities)
    || !value.capabilities.every(isString)) {
    return invalidResponse('中央后台返回的迁移会话无效')
  }
  return {
    workspaceId: value.workspaceId,
    actorId: value.actorId,
    capabilities: [...value.capabilities],
  }
}

function decodePreflight(value: unknown): CoreMigrationPreflightDTO {
  if (!isObject(value)
    || value.eligible !== true
    || value.contractVersion !== CORE_MIGRATION_CONTRACT_VERSION
    || value.mode !== CORE_MIGRATION_SOURCE_MODE
    || !isString(value.sourceVersion)
    || !isString(value.sourceHash)
    || !isNonNegativeInteger(value.entityCount)) {
    return invalidResponse('中央后台返回的迁移预检结果无效')
  }
  return value as unknown as CoreMigrationPreflightDTO
}

function isStep(value: unknown): boolean {
  return isObject(value)
    && isEntityType(value.entityType)
    && isNonNegativeInteger(value.sourceCount)
    && isNonNegativeInteger(value.importableCount)
    && isNonNegativeInteger(value.skippedCount)
}

function isMapping(value: unknown): boolean {
  return isObject(value)
    && isEntityType(value.entityType)
    && isString(value.legacyId)
    && isString(value.serverId)
}

function isSourceRef(value: unknown): boolean {
  return isObject(value)
    && isString(value.batchId)
    && isString(value.sourceHash)
    && isEntityType(value.entityType)
    && isString(value.legacyId)
    && isNullableString(value.serverId)
}

function isIssue(value: unknown): value is CoreMigrationIssueDTO {
  const valueGuard = isObject(value) && value.metricKey === 'amount'
    ? isNullableMoney
    : isNullableNumber
  return isObject(value)
    && isString(value.id)
    && isString(value.batchId)
    && isString(value.commandId)
    && (isEntityType(value.entityType) || value.entityType === 'batch')
    && isString(value.legacyId)
    && isNullableString(value.serverId)
    && isString(value.field)
    && isString(value.metricKey)
    && ISSUE_METRICS.has(value.metricKey)
    && isString(value.sourceValue)
    && valueGuard(value.expectedValue)
    && valueGuard(value.actualValue)
    && valueGuard(value.difference)
    && isString(value.attribution)
    && ISSUE_ATTRIBUTIONS.has(value.attribution)
    && isString(value.reason)
}

function decodeBatch(value: unknown): CoreMigrationBatchDTO {
  if (!isObject(value)
    || !isString(value.batchId)
    || !isString(value.sourceVersion)
    || !isString(value.sourceHash)
    || !isString(value.status)
    || !BATCH_STATUSES.has(value.status)
    || !(value.authority === 'local' || value.authority === 'central')
    || !Array.isArray(value.steps)
    || !value.steps.every(isStep)
    || !Array.isArray(value.mappings)
    || !value.mappings.every(isMapping)
    || !Array.isArray(value.sourceRefs)
    || !value.sourceRefs.every(isSourceRef)
    || !Array.isArray(value.issues)
    || !value.issues.every(isIssue)
    || !isISODateTimeDTO(value.createdAt)
    || !isISODateTimeDTO(value.updatedAt)
    || !(value.rollbackExpiresAt === null || isISODateTimeDTO(value.rollbackExpiresAt))
    || !(value.confirmedAt === null || isISODateTimeDTO(value.confirmedAt))
    || !(value.rolledBackAt === null || isISODateTimeDTO(value.rolledBackAt))) {
    return invalidResponse('中央后台返回的迁移批次无效')
  }
  return value as unknown as CoreMigrationBatchDTO
}

function isReferences(value: unknown): boolean {
  return isObject(value)
    && Object.values(value).every(isNullableString)
}

function isServerEntity(value: unknown): value is CoreMigrationServerEntityDTO {
  return isObject(value)
    && isEntityType(value.entityType)
    && isString(value.id)
    && isString(value.legacyId)
    && isString(value.name)
    && isReferences(value.references)
    && isNullableNumber(value.quantity)
    && isNullableMoney(value.amount)
    && (value.deletedAt === null || isISODateTimeDTO(value.deletedAt))
    && isString(value.batchId)
}

function decodeSnapshot(value: unknown): CoreMigrationSnapshotDTO {
  if (!isObject(value)
    || !(value.authority === 'local' || value.authority === 'central')
    || !isNullableString(value.activeBatchId)
    || !Array.isArray(value.entities)
    || !value.entities.every(isServerEntity)) {
    return invalidResponse('中央后台返回的核心身份快照无效')
  }
  return value as unknown as CoreMigrationSnapshotDTO
}

function isFieldErrors(value: unknown): value is Record<string, string[]> {
  return isObject(value)
    && Object.values(value).every(errors =>
      Array.isArray(errors) && errors.every(isString),
    )
}

function remoteProblem(cause: unknown): CoreMigrationHttpError | null {
  if (!isObject(cause))
    return null
  const response = isObject(cause.response) ? cause.response : null
  const raw = response?._data ?? cause.data
  if (!isObject(raw))
    return null
  const candidate = isObject(raw.data) ? raw.data : raw
  if (!isProblemCodeDTO(candidate.code)
    || !isString(candidate.message)
    || typeof candidate.retryable !== 'boolean'
    || !isFieldErrors(candidate.fieldErrors)
    || !isNullableString(candidate.traceId)) {
    return null
  }
  return new CoreMigrationHttpError(
    candidate.code,
    candidate.message,
    candidate.retryable,
    candidate.fieldErrors,
    candidate.traceId,
    { cause },
  )
}

async function request<T>(
  operation: () => Promise<unknown>,
  decode: (value: unknown) => T,
): Promise<T> {
  try {
    return decode(await operation())
  }
  catch (cause) {
    if (cause instanceof CoreMigrationHttpError)
      throw cause
    const problem = remoteProblem(cause)
    if (problem)
      throw problem
    throw new CoreMigrationHttpError(
      'unavailable',
      cause instanceof Error ? cause.message : '中央后台暂时不可用',
      true,
      {},
      null,
      { cause },
    )
  }
}

function postBatch(
  options: HttpCoreMigrationRepositoryOptions,
  action: 'import' | 'confirm' | 'rollback',
  command: CoreMigrationBatchCommandDTO,
): Promise<CoreMigrationBatchDTO> {
  return request(
    () => options.fetcher(
      `/api/migrations/core/${encodeURIComponent(command.batchId)}/${action}`,
      { method: 'POST', body: command },
    ),
    decodeBatch,
  )
}

export function createHttpCoreMigrationRepository(
  options: HttpCoreMigrationRepositoryOptions,
): CoreMigrationRepository {
  return {
    context: () => request(
      () => options.fetcher('/api/read/business-session'),
      decodeContext,
    ),
    preflight: command => request(
      () => options.fetcher('/api/migrations/core/preflight', {
        method: 'POST',
        body: command,
      }),
      decodePreflight,
    ),
    dryRun: command => request(
      () => options.fetcher('/api/migrations/core/dry-run', {
        method: 'POST',
        body: command,
      }),
      decodeBatch,
    ),
    importBatch: command => postBatch(options, 'import', command),
    confirm: command => postBatch(options, 'confirm', command),
    rollback: command => postBatch(options, 'rollback', command),
    snapshot: () => request(
      () => options.fetcher('/api/migrations/core/snapshot'),
      decodeSnapshot,
    ),
  }
}

export function coreMigrationEnvelope(
  context: CoreMigrationCommandContextDTO,
  commandId: string,
): CoreMigrationCommandEnvelopeDTO {
  return {
    workspaceId: context.workspaceId,
    actorId: context.actorId,
    requiredCapability: CORE_MIGRATION_CAPABILITY,
    commandId,
  }
}
