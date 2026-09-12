import type { MoneyDTO } from '../../types/read-model'

export const CORE_MIGRATION_CAPABILITY = 'core:migration:write' as const
export const CORE_MIGRATION_CONTRACT_VERSION = 'core-migration.v1' as const
export const CORE_MIGRATION_SOURCE_MODE = 'browser-production-snapshot' as const
export const CORE_MIGRATION_SOURCE_VERSION = 'sqlite-v49' as const
export const CORE_MIGRATION_SUPPORTED_SOURCE_VERSIONS = ['sqlite-v47', 'sqlite-v48', CORE_MIGRATION_SOURCE_VERSION] as const
export const CORE_MIGRATION_TOPOLOGY = [
  'customers',
  'suppliers',
  'crews',
  'projects',
  'construction_contracts',
  'subcontract_contracts',
  'auxiliary_contracts',
  'other_settlements',
  'other_settlement_sources',
  'contract_supplements',
  'receipt_registrations',
  'delivery_records',
  'owner_documents',
  'workers',
  'project_suppliers',
  'quantity_projects',
] as const

export type CoreMigrationEntityType = typeof CORE_MIGRATION_TOPOLOGY[number]
export type CoreMigrationReferenceField
  = | 'customerId'
    | 'secondaryCustomerId'
    | 'projectId'
    | 'contractId'
    | 'supplierId'
    | 'crewId'

export interface CoreMigrationSourceEntityDTO {
  legacyId: string
  name: string
  references?: Partial<Record<CoreMigrationReferenceField, string | null>>
  quantity?: number | null
  amount?: MoneyDTO | null
  attributes?: Record<string, string | number | null>
  deletedAt?: string | null
}

export type CoreMigrationSourceEntitiesDTO = {
  [K in Exclude<CoreMigrationEntityType, 'auxiliary_contracts' | 'other_settlements' | 'other_settlement_sources' | 'delivery_records' | 'quantity_projects'>]: CoreMigrationSourceEntityDTO[]
} & { auxiliary_contracts?: CoreMigrationSourceEntityDTO[], other_settlements?: CoreMigrationSourceEntityDTO[], other_settlement_sources?: CoreMigrationSourceEntityDTO[], delivery_records?: CoreMigrationSourceEntityDTO[], quantity_projects?: CoreMigrationSourceEntityDTO[] }

export type CoreMigrationTotalExpectationDTO
  = | { entityType: CoreMigrationEntityType, metric: 'quantity', expected: number }
    | { entityType: CoreMigrationEntityType, metric: 'amount', expected: MoneyDTO }

export interface CoreMigrationSourceDTO {
  contractVersion: string
  mode: string
  sourceVersion: string
  sourceHash: string
  entities: CoreMigrationSourceEntitiesDTO
  expectations?: {
    counts?: Partial<Record<CoreMigrationEntityType, number>>
    totals?: CoreMigrationTotalExpectationDTO[]
  }
}

export function compareCanonicalText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

const MAX_MIGRATION_MONEY_CENTS = BigInt(Number.MAX_SAFE_INTEGER)
const CENTS_PER_UNIT = BigInt(100)
const ZERO_CENTS = BigInt(0)

function parseMoneyCents(value: string): bigint {
  const negative = value.startsWith('-')
  const unsigned = negative ? value.slice(1) : value
  const [whole = '0', fraction = '00'] = unsigned.split('.')
  const cents = BigInt(whole) * CENTS_PER_UNIT + BigInt(fraction)
  return negative ? -cents : cents
}

export function isCoreMigrationMoney(value: unknown): value is MoneyDTO {
  if (typeof value !== 'string' || !/^-?\d{1,14}\.\d{2}$/.test(value))
    return false
  const cents = parseMoneyCents(value)
  return cents >= -MAX_MIGRATION_MONEY_CENTS && cents <= MAX_MIGRATION_MONEY_CENTS
}

export function coreMigrationMoneyToCents(value: MoneyDTO): bigint {
  if (!isCoreMigrationMoney(value))
    throw new Error('金额必须是安全范围内的两位小数字符串')
  return parseMoneyCents(value)
}

export function coreMigrationCentsToMoney(value: bigint): MoneyDTO {
  if (value < -MAX_MIGRATION_MONEY_CENTS || value > MAX_MIGRATION_MONEY_CENTS)
    throw new Error('汇总金额超出迁移契约允许的安全范围')
  const negative = value < ZERO_CENTS
  const absolute = negative ? -value : value
  const whole = absolute / CENTS_PER_UNIT
  const fraction = String(absolute % CENTS_PER_UNIT).padStart(2, '0')
  return `${negative ? '-' : ''}${whole}.${fraction}`
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(canonicalJsonValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareCanonicalText(left, right))
        .map(([key, entry]) => [key, canonicalJsonValue(entry)]),
    )
  }
  return value
}

export function coreMigrationSourceHashInput(
  source: Omit<CoreMigrationSourceDTO, 'sourceHash'> | CoreMigrationSourceDTO,
): string {
  return JSON.stringify(canonicalJsonValue({
    contractVersion: source.contractVersion,
    mode: source.mode,
    sourceVersion: source.sourceVersion,
    entities: source.entities,
    ...(source.expectations === undefined ? {} : { expectations: source.expectations }),
  }))
}

export interface CoreMigrationBackupAttestationDTO {
  backupId: string
  sourceHash: string
  sourceVersion: string
  snapshotSha256: string
  byteLength: number
  createdAt: string
  immutable: true
}

export interface CoreMigrationCommandEnvelopeDTO {
  workspaceId: string
  actorId: string
  requiredCapability: typeof CORE_MIGRATION_CAPABILITY
  commandId: string
}

export interface CoreMigrationSourceCommandDTO extends CoreMigrationCommandEnvelopeDTO {
  source: CoreMigrationSourceDTO
  backup: CoreMigrationBackupAttestationDTO | null
}

export interface CoreMigrationBatchCommandDTO extends CoreMigrationCommandEnvelopeDTO {
  batchId: string
}

export interface CoreMigrationPreflightDTO {
  eligible: true
  contractVersion: typeof CORE_MIGRATION_CONTRACT_VERSION
  mode: typeof CORE_MIGRATION_SOURCE_MODE
  sourceVersion: string
  sourceHash: string
  entityCount: number
}

export interface CoreMigrationIdMappingDTO {
  entityType: CoreMigrationEntityType
  legacyId: string
  serverId: string
}

export interface CoreMigrationSourceRefDTO {
  batchId: string
  sourceHash: string
  entityType: CoreMigrationEntityType
  legacyId: string
  serverId: string | null
}

export type CoreMigrationIssueMetric
  = | 'count'
    | 'amount'
    | 'quantity'
    | 'missing-relation'
    | 'orphan'
    | 'soft-delete'
    | 'missing-original'
    | 'legacy-audit'
    | 'soft-delete-mismatch'
    | 'duplicate-source'
    | 'apply-failed'

export interface CoreMigrationIssueDTO {
  id: string
  batchId: string
  commandId: string
  entityType: CoreMigrationEntityType | 'batch'
  legacyId: string
  serverId: string | null
  field: string
  metricKey: CoreMigrationIssueMetric
  sourceValue: string
  expectedValue: number | MoneyDTO | null
  actualValue: number | MoneyDTO | null
  difference: number | MoneyDTO | null
  attribution: 'source' | 'mapping' | 'missing-source' | 'system'
  reason: string
}

export function isCoreMigrationBlockingIssue(
  issue: Pick<CoreMigrationIssueDTO, 'metricKey'>,
): boolean {
  return !['soft-delete', 'missing-original', 'legacy-audit'].includes(issue.metricKey)
}

export interface CoreMigrationStepDTO {
  entityType: CoreMigrationEntityType
  sourceCount: number
  importableCount: number
  skippedCount: number
}

export type CoreMigrationBatchStatus
  = | 'dry-run'
    | 'applied'
    | 'confirmed'
    | 'rolled-back'
    | 'failed'

export interface CoreMigrationBatchDTO {
  batchId: string
  sourceVersion: string
  sourceHash: string
  status: CoreMigrationBatchStatus
  authority: 'local' | 'central'
  steps: CoreMigrationStepDTO[]
  mappings: CoreMigrationIdMappingDTO[]
  sourceRefs: CoreMigrationSourceRefDTO[]
  issues: CoreMigrationIssueDTO[]
  createdAt: string
  updatedAt: string
  rollbackExpiresAt: string | null
  confirmedAt: string | null
  rolledBackAt: string | null
}

export interface CoreMigrationServerEntityDTO {
  entityType: CoreMigrationEntityType
  id: string
  legacyId: string
  name: string
  references: Partial<Record<CoreMigrationReferenceField, string | null>>
  quantity: number | null
  amount: MoneyDTO | null
  attributes: Record<string, string | number | null>
  deletedAt: string | null
  batchId: string
}

export interface CoreMigrationSnapshotDTO {
  authority: 'local' | 'central'
  activeBatchId: string | null
  entities: CoreMigrationServerEntityDTO[]
}

export interface CoreMigrationServerIdInput {
  workspaceId: string
  sourceHash: string
  entityType: CoreMigrationEntityType
  legacyId: string
}
