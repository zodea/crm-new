import type { MasterDataOwnerType } from '../../app/lib/master-data/forms'
import type { CoreMigrationEntityType, CoreMigrationServerEntityDTO, CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import { formDefaults } from '../../app/lib/master-data/page'
import { projectProblem, ProjectRepositoryProblem } from '../../app/lib/project/repository'

/** 迁移仅补入本批身份；同批已由普通命令编辑的记录保持原样。 */
export function migratedIdentityRecords<T extends { id: string, migrationBatchId?: string | null }>(
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
    if (record.migrationBatchId && (record.migrationBatchId !== batchId || !ids.has(id)))
      next.delete(id)
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
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...fields } = entity.attributes
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
  }
  return draft as T
}

export function migratedIdentityTimestamp(entity: CoreMigrationServerEntityDTO) {
  return String(entity.attributes.updatedAt || entity.attributes.createdAt || '1970-01-01T00:00:00.000Z')
}
