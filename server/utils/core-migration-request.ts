import type {
  CoreMigrationBackupAttestationDTO,
  CoreMigrationBatchCommandDTO,
  CoreMigrationCommandEnvelopeDTO,
  CoreMigrationEntityType,
  CoreMigrationReferenceField,
  CoreMigrationSourceCommandDTO,
  CoreMigrationSourceDTO,
  CoreMigrationSourceEntityDTO,
} from '../../app/lib/migration/core-contract'
import { decodeConstructionManagementFee, validateConstructionManagementFee } from '../../app/lib/construction-contract/management-fee'
import { crewPayrollFeeAttributes } from '../../app/lib/crew-worker/payroll-fee-defaults'
import {
  CORE_MIGRATION_CAPABILITY,
  CORE_MIGRATION_TOPOLOGY,
  isCoreMigrationMoney,
} from '../../app/lib/migration/core-contract'
import { WORKER_ROSTER_SOURCE_ATTRIBUTE_KEYS } from '../../app/lib/migration/worker-roster-source'
import { projectProblem, ProjectRepositoryProblem } from '../../app/lib/project/repository'

const ENTITY_KEYS = new Set<string>(CORE_MIGRATION_TOPOLOGY)
const REFERENCE_KEYS = new Set<CoreMigrationReferenceField>([
  'customerId',
  'secondaryCustomerId',
  'projectId',
  'contractId',
  'supplierId',
  'crewId',
])
const ROW_KEYS = new Set(['legacyId', 'name', 'references', 'quantity', 'amount', 'attributes', 'deletedAt'])
const ATTRIBUTE_KEYS = new Set(['no', 'content', 'invoiceType', 'contactName', 'contactPhone', 'taxRate', 'signDate', 'mainTerms', 'paymentTerms', 'warrantyTerms', 'retentionRatio', 'retentionAmount', 'retentionDays', 'invoiceName', 'invoiceTaxNo', 'invoiceAddressPhone', 'invoiceBank', 'invoiceBankAccount', 'status', 'note', 'actualCompletionDate', 'createdAt', 'updatedAt', 'laborScope'])
const ATTRIBUTE_KEYS_BY_ENTITY: Partial<Record<CoreMigrationEntityType, ReadonlySet<string>>> = {
  crews: new Set([...ATTRIBUTE_KEYS, 'defaultPayRatio', 'rentSubsidyEnabled', 'rentSubsidyPrice', 'mgmtFeeEnabled', 'mgmtFeePrice']),
  workers: new Set([...ATTRIBUTE_KEYS, 'dailyWage', ...WORKER_ROSTER_SOURCE_ATTRIBUTE_KEYS]),
  supplier_credentials: new Set(['graphJson']),
  material_contracts: new Set(['materialGraphJson']),
  contract_supplements: new Set([...ATTRIBUTE_KEYS, 'externalRef', 'materialGraphJson']),
  suppliers: new Set(['aliases', 'externalRef', 'uniqueCode', 'taxNo', 'businessType', 'supplierCategory', 'rating', 'legalRep', 'registeredCapital', 'registeredDate', 'address', 'taxpayerType', 'taxpayerVerificationStatus', 'taxpayerVerificationSource', 'taxpayerVerifiedAt', 'taxpayerVerificationNote', 'mainBusiness', 'laborScope', 'invoiceName', 'invoiceAddress', 'bank', 'bankAccount', 'phone', 'contact', 'contactPhone', 'contactTitle', 'note', 'approvalStatus', 'createdAt', 'updatedAt']),
  process_libraries: new Set(['graphJson']),
  quantity_projects: new Set(['graphJson']),
  wbs_projects: new Set(['graphJson']),
  target_cost_versions: new Set(['budgetGraphJson']),
  payroll_projects: new Set(['payrollGraphJson']),
  construction_contracts: new Set([...ATTRIBUTE_KEYS, 'boqCatalogJson', 'monthlyQuantityFactsJson', 'attachmentsJson', 'legacyPartyA', 'ourSignatoryId', 'ourSignatorySnapshotJson', 'managementFeeAmount', 'managementFeeBasis', 'managementFeeConfigurationJson']),
  subcontract_contracts: new Set([...ATTRIBUTE_KEYS, 'subKind', 'settlementStatus', 'clearanceStatus', 'attachmentsJson', 'legacyPartyA', 'ourSignatoryId', 'ourSignatorySnapshotJson']),
  receipt_registrations: new Set(['no', 'receiptDate', 'payerAccount', 'paymentMethod', 'acceptanceBillNo', 'billDueDate', 'periodNo', 'bankSerialNo', 'handler', 'reviewStatus', 'status', 'note', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'attachmentsJson']),
  delivery_records: new Set(['orderNo', 'deliveryDate', 'rawSiteText', 'fileName', 'ocrStatus', 'archived', 'printBatchId', 'printDisposition', 'printedAt', 'printExcludedAt', 'reviewFlag', 'note', 'createdAt', 'updatedAt', 'sourceState', 'sourceProblem', 'assetJson', 'allLinesJson', 'auditJson', 'legacyOriginalsJson']),
}
const SOURCE_KEYS = new Set([
  'contractVersion',
  'mode',
  'sourceVersion',
  'sourceHash',
  'entities',
  'expectations',
])
const ENVELOPE_KEYS = ['workspaceId', 'actorId', 'requiredCapability', 'commandId'] as const
const BACKUP_KEYS = new Set([
  'backupId',
  'sourceHash',
  'sourceVersion',
  'snapshotSha256',
  'byteLength',
  'createdAt',
  'immutable',
])
const SOURCE_COMMAND_KEYS = new Set([...ENVELOPE_KEYS, 'source', 'backup'])
const BATCH_COMMAND_KEYS = new Set([...ENVELOPE_KEYS, 'batchId'])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(message: string): never {
  throw new ProjectRepositoryProblem(projectProblem('validation-failed', message))
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  if (Object.keys(value).some(key => !allowed.has(key)))
    invalid(`${label}包含未知字段`)
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '')
    invalid(`${label}不能为空`)
  return value.trim()
}

function optionalFinite(value: unknown, label: string): number | null | undefined {
  if (value === undefined || value === null)
    return value
  if (typeof value !== 'number' || !Number.isFinite(value))
    invalid(`${label}必须是有限数值`)
  return value
}

function optionalMoney(value: unknown, label: string): string | null | undefined {
  if (value === undefined || value === null)
    return value
  if (!isCoreMigrationMoney(value))
    invalid(`${label}必须是两位小数金额字符串`)
  return value
}

function optionalIso(value: unknown, label: string): string | null | undefined {
  if (value === undefined || value === null)
    return value
  const normalized = typeof value === 'string' && !value.includes('.')
    ? value.replace('Z', '.000Z')
    : value
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== normalized) {
    invalid(`${label}必须是 ISO 时间`)
  }
  return value
}

function requiredSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    invalid(`${label}必须是 SHA-256 十六进制摘要`)
  return value
}

function parseBackup(value: unknown): CoreMigrationBackupAttestationDTO | null {
  if (value === null)
    return null
  if (!isObject(value))
    invalid('backup 必须是 null 或不可变备份证明')
  assertOnlyKeys(value, BACKUP_KEYS, 'backup')
  const byteLength = value.byteLength
  if (typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength) || byteLength <= 0)
    invalid('backup.byteLength 必须是正安全整数')
  if (value.immutable !== true)
    invalid('backup.immutable 必须为 true')
  return {
    backupId: requiredText(value.backupId, 'backup.backupId'),
    sourceHash: requiredSha256(value.sourceHash, 'backup.sourceHash'),
    sourceVersion: requiredText(value.sourceVersion, 'backup.sourceVersion'),
    snapshotSha256: requiredSha256(value.snapshotSha256, 'backup.snapshotSha256'),
    byteLength,
    createdAt: optionalIso(value.createdAt, 'backup.createdAt')
      ?? invalid('backup.createdAt 不能为空'),
    immutable: true,
  }
}

function parseReferences(value: unknown, label: string): CoreMigrationSourceEntityDTO['references'] {
  if (value === undefined)
    return undefined
  if (!isObject(value))
    invalid(`${label}必须是对象`)
  assertOnlyKeys(value, REFERENCE_KEYS, label)
  const result: CoreMigrationSourceEntityDTO['references'] = {}
  for (const [key, reference] of Object.entries(value)) {
    if (reference !== null && (typeof reference !== 'string' || reference.trim() === ''))
      invalid(`${label}.${key}必须是旧实体 ID 或 null`)
    result[key as CoreMigrationReferenceField] = reference === null ? null : reference.trim()
  }
  return result
}

function parseAttributes(value: unknown, label: string, entityType: CoreMigrationEntityType): CoreMigrationSourceEntityDTO['attributes'] {
  if (value === undefined)
    return undefined
  if (!isObject(value))
    invalid(`${label}必须是对象`)
  assertOnlyKeys(value, ATTRIBUTE_KEYS_BY_ENTITY[entityType] ?? ATTRIBUTE_KEYS, label)
  if (entityType === 'construction_contracts') {
    try {
      validateConstructionManagementFee(value.managementFeeAmount ?? null, value.managementFeeBasis ?? '')
      if (value.managementFeeConfigurationJson !== undefined) {
        if (typeof value.managementFeeConfigurationJson !== 'string')
          invalid(`${label}管理费冻结资料必须保留原 JSON 文本`)
        const configuration = decodeConstructionManagementFee(JSON.parse(value.managementFeeConfigurationJson))
        if (configuration.amount !== (value.managementFeeAmount ?? null) || configuration.basis !== (value.managementFeeBasis ?? ''))
          invalid(`${label}管理费当前值与冻结依据不一致`)
      }
    }
    catch (cause) { invalid(cause instanceof Error ? cause.message : `${label}管理费配置无效`) }
  }
  if (entityType === 'crews') {
    try {
      crewPayrollFeeAttributes(value)
    }
    catch (cause) { invalid(cause instanceof Error ? cause.message : `${label} 班组费用默认无效`) }
  }
  const result: Record<string, string | number | null> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entityType === 'crews' && key === 'defaultPayRatio' && entry !== null && (typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0 || entry > 1))
      invalid(`${label}.${key}必须是 0 至 1 的比例或 null`)
    if (entityType === 'workers' && key === 'dailyWage' && entry !== null && (typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0))
      invalid(`${label}.${key}必须是非负日薪或 null`)
    if (entry !== null && typeof entry !== 'string' && (typeof entry !== 'number' || !Number.isFinite(entry)))
      invalid(`${label}.${key}必须是文本、有限数值或 null`)
    result[key] = entry as string | number | null
  }
  return result
}

function parseEntity(value: unknown, entityType: CoreMigrationEntityType, index: number): CoreMigrationSourceEntityDTO {
  const label = `${entityType}[${index}]`
  if (!isObject(value))
    invalid(`${label}必须是对象`)
  assertOnlyKeys(value, ROW_KEYS, label)
  return {
    legacyId: requiredText(value.legacyId, `${label}.legacyId`),
    name: requiredText(value.name, `${label}.name`),
    ...(value.references !== undefined
      ? { references: parseReferences(value.references, `${label}.references`) }
      : {}),
    ...(value.quantity !== undefined ? { quantity: optionalFinite(value.quantity, `${label}.quantity`) } : {}),
    ...(value.amount !== undefined ? { amount: optionalMoney(value.amount, `${label}.amount`) } : {}),
    ...(value.attributes !== undefined ? { attributes: parseAttributes(value.attributes, `${label}.attributes`, entityType) } : {}),
    ...(value.deletedAt !== undefined ? { deletedAt: optionalIso(value.deletedAt, `${label}.deletedAt`) } : {}),
  }
}

function parseExpectations(value: unknown): CoreMigrationSourceDTO['expectations'] {
  if (value === undefined)
    return undefined
  if (!isObject(value))
    invalid('expectations 必须是对象')
  assertOnlyKeys(value, new Set(['counts', 'totals']), 'expectations')

  let counts: Partial<Record<CoreMigrationEntityType, number>> | undefined
  if (value.counts !== undefined) {
    if (!isObject(value.counts))
      invalid('expectations.counts 必须是对象')
    assertOnlyKeys(value.counts, ENTITY_KEYS, 'expectations.counts')
    counts = {}
    for (const [entityType, count] of Object.entries(value.counts)) {
      if (!Number.isSafeInteger(count) || Number(count) < 0)
        invalid(`expectations.counts.${entityType}必须是非负安全整数`)
      counts[entityType as CoreMigrationEntityType] = Number(count)
    }
  }

  let totals: NonNullable<CoreMigrationSourceDTO['expectations']>['totals']
  if (value.totals !== undefined) {
    if (!Array.isArray(value.totals))
      invalid('expectations.totals 必须是数组')
    totals = value.totals.map((item, index) => {
      if (!isObject(item))
        return invalid(`expectations.totals[${index}]必须是对象`)
      assertOnlyKeys(item, new Set(['entityType', 'metric', 'expected']), `expectations.totals[${index}]`)
      const validExpected = item.metric === 'amount'
        ? isCoreMigrationMoney(item.expected)
        : item.metric === 'quantity'
          && typeof item.expected === 'number'
          && Number.isFinite(item.expected)
      if (!ENTITY_KEYS.has(String(item.entityType))
        || (item.metric !== 'quantity' && item.metric !== 'amount')
        || !validExpected) {
        return invalid(`expectations.totals[${index}]无效`)
      }
      return item.metric === 'amount'
        ? {
            entityType: item.entityType as CoreMigrationEntityType,
            metric: 'amount' as const,
            expected: item.expected as string,
          }
        : {
            entityType: item.entityType as CoreMigrationEntityType,
            metric: 'quantity' as const,
            expected: item.expected as number,
          }
    })
  }
  return {
    ...(counts ? { counts } : {}),
    ...(totals ? { totals } : {}),
  }
}

function parseEnvelope(value: Record<string, unknown>): CoreMigrationCommandEnvelopeDTO {
  return {
    workspaceId: requiredText(value.workspaceId, 'workspaceId'),
    actorId: requiredText(value.actorId, 'actorId'),
    requiredCapability: value.requiredCapability === CORE_MIGRATION_CAPABILITY
      ? CORE_MIGRATION_CAPABILITY
      : invalid('requiredCapability 无效'),
    commandId: requiredText(value.commandId, 'commandId'),
  }
}

export function parseCoreMigrationSourceCommand(value: unknown): CoreMigrationSourceCommandDTO {
  if (!isObject(value) || !isObject(value.source))
    invalid('迁移来源命令无效')
  assertOnlyKeys(value, SOURCE_COMMAND_KEYS, '迁移来源命令')
  const sourceValue = value.source
  assertOnlyKeys(sourceValue, SOURCE_KEYS, 'source')
  const entityGroups = sourceValue.entities
  if (!isObject(entityGroups))
    invalid('source.entities 必须是对象')
  assertOnlyKeys(entityGroups, ENTITY_KEYS, 'source.entities')

  const entities = Object.fromEntries(CORE_MIGRATION_TOPOLOGY.filter(entityType => !['material_contracts', 'auxiliary_contracts', 'other_settlements', 'other_settlement_sources', 'delivery_records', 'quantity_projects', 'process_libraries', 'supplier_credentials', 'wbs_projects', 'target_cost_versions', 'payroll_projects'].includes(entityType) || entityGroups[entityType] !== undefined).map((entityType) => {
    const rows = entityGroups[entityType]
    if (!Array.isArray(rows))
      invalid(`source.entities.${entityType}必须是数组`)
    return [entityType, rows.map((row, index) => parseEntity(row, entityType, index))]
  })) as CoreMigrationSourceDTO['entities']

  return {
    ...parseEnvelope(value),
    source: {
      contractVersion: requiredText(sourceValue.contractVersion, 'source.contractVersion'),
      mode: requiredText(sourceValue.mode, 'source.mode'),
      sourceVersion: requiredText(sourceValue.sourceVersion, 'source.sourceVersion'),
      sourceHash: /^[a-f0-9]{64}$/.test(String(sourceValue.sourceHash))
        ? String(sourceValue.sourceHash)
        : invalid('source.sourceHash 必须是 SHA-256 十六进制摘要'),
      entities,
      ...(sourceValue.expectations !== undefined
        ? { expectations: parseExpectations(sourceValue.expectations) }
        : {}),
    },
    backup: parseBackup(value.backup),
  }
}

export function parseCoreMigrationBatchCommand(
  value: unknown,
  routeBatchId: string,
): CoreMigrationBatchCommandDTO {
  if (!isObject(value))
    invalid('迁移批次命令无效')
  assertOnlyKeys(value, BATCH_COMMAND_KEYS, '迁移批次命令')
  const batchId = requiredText(routeBatchId, 'batchId')
  if (value.batchId !== undefined && value.batchId !== batchId)
    invalid('路由批次 ID 与命令不匹配')
  return { ...parseEnvelope(value), batchId }
}
