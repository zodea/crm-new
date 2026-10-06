import type { MasterDataOwnerType } from '../../app/lib/master-data/forms'
import type { CoreMigrationEntityType, CoreMigrationServerEntityDTO, CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import { formDefaults } from '../../app/lib/master-data/page'
import { projectProblem, ProjectRepositoryProblem } from '../../app/lib/project/repository'

/** 回滚只可移除本批未变更事实；仍留存的独立或历史记录必须保持有效引用。 */
export function assertRetainedMigrationReferences(
  removed: readonly CoreMigrationServerEntityDTO[],
  type: CoreMigrationEntityType,
  records: Iterable<{ id: string, references: readonly { type: CoreMigrationEntityType, id: string | null | undefined }[] }>,
  reject: (message: string) => Error,
): void {
  const keys = new Set(removed.map(row => `${row.entityType}:${row.id}`))
  for (const record of records) {
    if (keys.has(`${type}:${record.id}`))
      continue
    if (record.references.some(reference => reference.id && keys.has(`${reference.type}:${reference.id}`)))
      throw reject('独立或历史记录仍引用迁入身份，不能回滚移除')
  }
}

/** 迁移仅补入本批身份；同批已由普通命令编辑的记录保持原样。 */
export function migratedIdentityRecords<T extends { id: string, version: number | string, migrationBatchId?: string | null }>(
  current: Map<string, T>,
  snapshot: CoreMigrationSnapshotDTO,
  type: CoreMigrationEntityType,
  create: (entity: CoreMigrationServerEntityDTO) => T,
): Map<string, T> {
  const batchId = snapshot.authority === 'central' ? snapshot.activeBatchId : null
  const entities = batchId ? snapshot.entities.filter(entity => entity.entityType === type && entity.deletedAt === null) : []
  const ids = new Set(entities.map(entity => entity.id))
  const next = new Map(current)
  for (const [id, record] of next) {
    if (record.migrationBatchId && (record.migrationBatchId !== batchId || !ids.has(id))) {
      if (String(record.version) !== '1')
        throw new ProjectRepositoryProblem(projectProblem('conflict', '迁入身份已有后来修改或删除，不能回滚移除'))
      next.delete(id)
    }
  }
  for (const entity of entities) {
    const record = next.get(entity.id)
    if (record) {
      if (record.migrationBatchId !== batchId)
        throw new ProjectRepositoryProblem(projectProblem('conflict', '迁入身份与既有正式记录冲突'))
      continue
    }
    next.set(entity.id, { ...create(entity), migrationBatchId: batchId })
  }
  return next.size === current.size && [...next].every(([id, record]) => current.get(id) === record) ? current : next
}

export function migratedIdentityDraft<T>(kind: MasterDataOwnerType, entity: CoreMigrationServerEntityDTO): T {
  const { createdAt: _createdAt, updatedAt: _updatedAt, workerOriginalJson: _workerOriginalJson, workerFilesJson: _workerFilesJson, ...fields } = entity.attributes
  const draft: Record<string, unknown> = { ...formDefaults(kind), ...fields, id: entity.id, name: entity.name }
  for (const key of ['aliases', 'capabilityTrades', 'capabilityItems']) {
    if (!(key in draft))
      continue
    const raw = draft[key]
    try {
      const values: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw
      draft[key] = Array.isArray(values) ? values.filter(value => typeof value === 'string') : []
    }
    catch { draft[key] = [] }
  }
  if (kind === 'project') {
    draft.customerId = entity.references.customerId ?? null
    draft.secondaryCustomerId = entity.references.secondaryCustomerId ?? null
    draft.contractAmount = entity.amount === null ? null : Number(entity.amount)
    draft.area = entity.quantity
  }
  if (kind === 'worker') {
    draft.crewId = entity.references.crewId ?? null
    draft.currentProjectId = entity.references.projectId ?? null
    if ('safetyEducation' in fields)
      draft.safetyEducation = fields.safetyEducation === 1
  }
  return draft as T
}

export function migratedIdentityTimestamp(entity: CoreMigrationServerEntityDTO) {
  return String(entity.attributes.updatedAt || entity.attributes.createdAt || '1970-01-01T00:00:00.000Z')
}
