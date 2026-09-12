import type { CoreMigrationServerEntityDTO, CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type { ProcessLibraryMigrationGraph } from '../../app/lib/migration/process-library-source'
import type { ProcessLibraryVersion } from '../../app/lib/schedule/process-library-contract'
import { createHash } from 'node:crypto'
import { compareCanonicalText } from '../../app/lib/migration/core-contract'
import { parseProcessLibraryItemCodes, parseProcessLibraryMigrationGraph } from '../../app/lib/migration/process-library-source'
import { processLibraryProblem } from '../../app/lib/schedule/process-library-contract'
import { normalizeProcessLibraryDraft } from '../../app/lib/schedule/process-library-domain'

function invalid(message: string): never {
  throw processLibraryProblem('relationship-mismatch', `工序库迁移：${message}`)
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(canonical)
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => compareCanonicalText(a, b)).map(([key, entry]) => [key, canonical(entry)]))
  return value
}
function sameVersion(a: ProcessLibraryVersion, b: ProcessLibraryVersion): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
}
function parseEntity(entity: CoreMigrationServerEntityDTO): ProcessLibraryMigrationGraph {
  let value: unknown
  if (typeof entity.attributes.graphJson !== 'string')
    invalid('缺少完整图 JSON')
  try {
    value = JSON.parse(String(entity.attributes.graphJson))
  }
  catch { invalid('图 JSON 无效') }
  const graph = parseProcessLibraryMigrationGraph(value, entity.legacyId)
  if (graph.library.name !== entity.name || graph.library.deleted_at !== entity.deletedAt || Object.keys(entity.references).length)
    invalid('库头名称、删除边界或全局归属与迁移节点错配')
  return graph
}

function mappedVersion(entity: CoreMigrationServerEntityDTO, graph: ProcessLibraryMigrationGraph): ProcessLibraryVersion {
  const head = graph.library
  const tasks = graph.tasks.map(task => ({
    id: `process-task:${createHash('sha256').update(JSON.stringify([entity.id, task.id])).digest('hex')}`,
    legacyId: task.id,
    libraryId: entity.id,
    libraryVersion: head.version,
    key: task.task_key,
    name: task.name,
    trade: task.trade,
    color: task.color,
    durationDays: task.duration_days,
    stageCode: task.stage_code,
    itemCodes: parseProcessLibraryItemCodes(task.item_codes_json),
    sortOrder: task.sort_order,
    predecessorKey: task.predecessor_task_key,
    predecessorDisabled: task.predecessor_disabled === 1,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    deletedAt: task.deleted_at,
  }))
  // 只读历史仍完整保存；可公开使用的版本还须通过与新建命令相同的领域校验。
  if (head.deleted_at === null) {
    normalizeProcessLibraryDraft({
      sourceLibraryId: null,
      code: head.code,
      name: head.name,
      description: head.description,
      tasks: tasks.filter(task => task.deletedAt === null),
    })
  }
  return {
    id: entity.id,
    code: head.code,
    name: head.name,
    version: head.version,
    description: head.description,
    isDefault: head.is_default === 1,
    sortOrder: head.sort_order,
    taskCount: tasks.filter(task => task.deletedAt === null).length,
    usageCount: null,
    tasks,
    dataOrigin: 'real',
    sourceVersion: String(head.version),
    // 旧库没有明确前版关系，不能凭版本号相邻或同名推导来源。
    sourceVersionId: null,
    createdAt: head.created_at,
    createdBy: null,
    updatedAt: head.updated_at,
    deletedAt: head.deleted_at,
    migrationBatchId: entity.batchId,
    legacyId: entity.legacyId,
  }
}

/** 原子候选：不修改 current；协调器确认所有参与者后才替换正式状态。 */
export function prepareProcessLibraryMigration(current: readonly ProcessLibraryVersion[], snapshot: CoreMigrationSnapshotDTO): { versions: ProcessLibraryVersion[], changed: boolean } {
  const batchId = snapshot.authority === 'central' ? snapshot.activeBatchId : null
  if (snapshot.authority === 'central' && !batchId)
    invalid('中央快照缺少活动批次')
  const entities = batchId ? snapshot.entities.filter(row => row.entityType === 'process_libraries') : []
  const incoming = new Set<string>()
  const legacyIds = new Set<string>()
  const codeVersions = new Set<string>()
  const legacyTaskIds = new Set<string>()
  const mapped = entities.map((entity) => {
    if (!entity.id || entity.batchId !== batchId || incoming.has(entity.id) || legacyIds.has(entity.legacyId))
      invalid('批次、库身份无效或重复')
    incoming.add(entity.id)
    legacyIds.add(entity.legacyId)
    const graph = parseEntity(entity)
    const codeVersion = JSON.stringify([graph.library.code, graph.library.version])
    if (codeVersions.has(codeVersion))
      invalid('同批次库编码与版本重复')
    codeVersions.add(codeVersion)
    for (const task of graph.tasks) {
      if (legacyTaskIds.has(task.id))
        invalid('旧任务稳定身份跨库重复')
      legacyTaskIds.add(task.id)
    }
    return mappedVersion(entity, graph)
  })
  const removed = new Set(current.filter(row => row.migrationBatchId && (row.migrationBatchId !== batchId || !incoming.has(row.id))).map(row => row.id))
  const retained = current.filter(row => !removed.has(row.id))
  if (retained.some(row => row.sourceVersionId !== null && removed.has(row.sourceVersionId)))
    throw processLibraryProblem('conflict', '撤回批次会使独立新版的来源版本悬空；已保留全部当前事实，请先核对来源依赖后再恢复')
  const versions = structuredClone(retained)
  const byId = new Map(versions.map(row => [row.id, row]))
  if (byId.size !== versions.length)
    invalid('当前中央库身份重复')
  let changed = removed.size > 0
  for (const next of mapped) {
    const existing = byId.get(next.id)
    if (existing) {
      if (existing.migrationBatchId !== next.migrationBatchId)
        throw processLibraryProblem('conflict', '迁入库与中央独立版本身份冲突')
      if (!sameVersion(existing, next))
        throw processLibraryProblem('conflict', '同批次已确认库的来源内容发生变化，不能改写不可变版本')
      continue
    }
    if (versions.some(row => row.code === next.code && row.version === next.version))
      throw processLibraryProblem('conflict', '迁入库编码与版本和中央独立版本冲突')
    const existingTaskIds = new Set(versions.flatMap(row => row.tasks.map(task => task.id)))
    if (next.tasks.some(task => existingTaskIds.has(task.id)))
      throw processLibraryProblem('conflict', '迁入工序与中央工序稳定身份冲突')
    versions.push(next)
    byId.set(next.id, next)
    changed = true
  }
  return { versions, changed }
}
