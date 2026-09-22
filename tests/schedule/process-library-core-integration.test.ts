import type { BusinessSession } from '../../server/utils/business-session'
import type { CoreMigrationSynchronousSource } from '../../server/utils/core-migration-preparation'
import type { CoreMigrationBatchCommandDTO, CoreMigrationSourceCommandDTO, CoreMigrationSourceDTO } from '~/lib/migration/core-contract'
import type { ProcessLibraryMigrationGraph } from '~/lib/migration/process-library-source'
import type { ProcessLibraryCreateCommand, ProcessLibraryVersion } from '~/lib/schedule/process-library-contract'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CORE_MIGRATION_CAPABILITY, CORE_MIGRATION_CONTRACT_VERSION, CORE_MIGRATION_SOURCE_MODE, CORE_MIGRATION_SOURCE_VERSION, CORE_MIGRATION_TOPOLOGY, coreMigrationSourceHashInput, isCoreMigrationBlockingIssue } from '~/lib/migration/core-contract'
import { prepareCoreMigrationCommandSources } from '../../server/utils/core-migration-preparation'
import { parseCoreMigrationBatchCommand, parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { createCoreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { createProcessLibraryService } from '../../server/utils/process-library-service'

const at = '2026-09-12T10:00:00.000Z'
const session: BusinessSession = { workspaceId: 'process-migration-workspace', actorId: 'maintainer', capabilities: [CORE_MIGRATION_CAPABILITY, 'process-library:read', 'process-library:write'] }
const sessionId = 'isolated-process-migration'

function graph(version: number, deletedAt: string | null): ProcessLibraryMigrationGraph {
  const id = `legacy-v${version}`
  const task = { id: `${id}-a`, library_id: id, task_key: 'a', name: '原工序甲', trade: '木工', color: '#64748b', duration_days: 3, stage_code: 'stage-a', item_codes_json: '["item-a"]', sort_order: 10, predecessor_task_key: null, predecessor_disabled: 0, created_at: at, updated_at: at, deleted_at: null }
  return {
    schemaVersion: 1,
    library: { id, code: 'decoration', name: `旧标准库 v${version}`, version, description: '完整旧版定义', is_default: 0, sort_order: version * 10, created_at: at, updated_at: at, deleted_at: deletedAt },
    tasks: [task, { ...task, id: `${id}-b`, task_key: 'b', name: '原工序乙', sort_order: 20, predecessor_task_key: 'a' }],
  }
}
function source(graphs = [graph(1, null), graph(2, at)]): CoreMigrationSourceDTO {
  const entities = Object.fromEntries(CORE_MIGRATION_TOPOLOGY.map(type => [type, []])) as CoreMigrationSourceDTO['entities']
  entities.process_libraries = graphs.map(value => ({ legacyId: value.library.id, name: value.library.name, deletedAt: value.library.deleted_at, attributes: { graphJson: JSON.stringify(value) } }))
  return hashSource({ contractVersion: CORE_MIGRATION_CONTRACT_VERSION, mode: CORE_MIGRATION_SOURCE_MODE, sourceVersion: CORE_MIGRATION_SOURCE_VERSION, sourceHash: '', entities })
}
function hashSource(value: CoreMigrationSourceDTO): CoreMigrationSourceDTO {
  return { ...value, sourceHash: createHash('sha256').update(coreMigrationSourceHashInput(value)).digest('hex') }
}
function sourceCommand(commandId: string, value: CoreMigrationSourceDTO, withBackup = false): CoreMigrationSourceCommandDTO {
  return parseCoreMigrationSourceCommand(JSON.parse(JSON.stringify({
    commandId,
    workspaceId: session.workspaceId,
    actorId: session.actorId,
    requiredCapability: CORE_MIGRATION_CAPABILITY,
    source: value,
    backup: withBackup ? { backupId: `core-migration-${value.sourceHash}-${'b'.repeat(64)}`, sourceHash: value.sourceHash, sourceVersion: value.sourceVersion, snapshotSha256: 'b'.repeat(64), byteLength: 4096, createdAt: at, immutable: true } : null,
  })))
}
function batchCommand(commandId: string, batchId: string): CoreMigrationBatchCommandDTO {
  return parseCoreMigrationBatchCommand({ commandId, batchId, workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: CORE_MIGRATION_CAPABILITY }, batchId)
}
function fixture(others: CoreMigrationSynchronousSource[] = []) {
  let sequence = 0
  const libraries = createProcessLibraryService({ createId: () => `new-process-${++sequence}`, now: () => at })
  const core = createCoreMigrationTestInstance({
    now: () => at,
    createServerId: ({ entityType, legacyId }) => `central:${entityType}:${legacyId}`,
    prepareTransition: snapshot => prepareCoreMigrationCommandSources(snapshot, [{ prepareMigrationSnapshot: value => libraries.prepareMigrationSnapshot(value, session, sessionId) }, ...others]),
  })
  const catalog = () => libraries.catalog('real', session, sessionId)
  const detail = (id: string) => libraries.detail(id, 'real', session, sessionId)
  return { libraries, core, catalog, detail }
}
async function plan(instance: ReturnType<typeof fixture>, value = source()) {
  const preflight = await instance.core.preflight(sourceCommand('preflight', value), session)
  expect(preflight).toMatchObject({ sourceHash: value.sourceHash, entityCount: value.entities.process_libraries!.length })
  return instance.core.dryRun(sourceCommand('dry-run', value, true), session)
}
function copyCommand(version: ProcessLibraryVersion): ProcessLibraryCreateCommand {
  return {
    action: 'create-version',
    commandId: 'copy-v1',
    workspaceId: session.workspaceId,
    actorId: session.actorId,
    origin: 'real',
    requiredCapability: 'process-library:write',
    baseVersion: 2,
    sourceVersion: version.sourceVersion,
    draft: {
      sourceLibraryId: version.id,
      code: version.code,
      name: '独立调整第三版',
      description: '不覆盖旧版',
      tasks: version.tasks.map((task, index) => ({ key: task.key, name: index === 0 ? '第三版调整工序' : task.name, durationDays: task.durationDays, trade: task.trade, color: task.color, stageCode: task.stageCode ?? '', itemCodes: [...task.itemCodes], predecessorKey: task.predecessorKey, predecessorDisabled: task.predecessorDisabled })),
    },
  }
}

describe('工序库与中央迁移协调器完整接缝', () => {
  it('真实预检/备份证明/试跑/导入/确认后从可见 v1 跨已删 v2 新建 v3，危险撤回保全权威和全部版本', async () => {
    const instance = fixture()
    const batch = await plan(instance)
    expect(batch.issues.some(isCoreMigrationBlockingIssue)).toBe(false)
    expect(batch.mappings.filter(row => row.entityType === 'process_libraries')).toHaveLength(2)
    expect(instance.catalog()).toMatchObject({ libraries: [], seriesVersions: {} })
    const applied = await instance.core.importBatch(batchCommand('import', batch.batchId), session)
    expect(applied).toMatchObject({ status: 'applied', authority: 'local' })
    expect(instance.catalog().libraries).toEqual([])
    expect(instance.core.snapshot(session)).toMatchObject({ authority: 'local', activeBatchId: batch.batchId })
    const confirmed = await instance.core.confirm(batchCommand('confirm', batch.batchId), session)
    expect(confirmed).toMatchObject({ status: 'confirmed', authority: 'central' })
    const firstCatalog = instance.catalog()
    expect(firstCatalog.seriesVersions).toEqual({ decoration: 2 })
    expect(firstCatalog.libraries).toHaveLength(1)
    const oldId = batch.mappings.find(row => row.legacyId === 'legacy-v1')!.serverId
    const deletedId = batch.mappings.find(row => row.legacyId === 'legacy-v2')!.serverId
    const oldVersion = instance.detail(oldId)
    expect(oldVersion).toMatchObject({ version: 1, usageCount: null, migrationBatchId: batch.batchId, legacyId: 'legacy-v1' })
    expect(() => instance.detail(deletedId)).toThrow(expect.objectContaining({ problem: expect.objectContaining({ code: 'not-found' }) }))
    await instance.core.importBatch(batchCommand('import-again', batch.batchId), session)
    await instance.core.confirm(batchCommand('confirm-again', batch.batchId), session)
    expect(instance.catalog()).toEqual(firstCatalog)
    const command = copyCommand(oldVersion)
    const result = instance.libraries.execute(command, session, sessionId)
    expect(result).toMatchObject({ version: 3, sourceVersion: '3' })
    expect(instance.libraries.execute(command, session, sessionId)).toEqual(result)
    expect(instance.detail(result.id)).toMatchObject({ version: 3, sourceVersionId: oldId, migrationBatchId: null, tasks: [expect.objectContaining({ name: '第三版调整工序' }), expect.objectContaining({ predecessorKey: 'a' })] })
    expect(instance.detail(oldId)).toEqual(oldVersion)
    expect(instance.catalog().seriesVersions).toEqual({ decoration: 3 })
    expect(instance.catalog().libraries.map(row => row.version).sort()).toEqual([1, 3])
    const beforeCore = instance.core.snapshot(session)
    const beforeCatalog = instance.catalog()
    const beforeNew = instance.detail(result.id)
    await expect(instance.core.rollback(batchCommand('rollback-with-descendant', batch.batchId), session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(instance.core.snapshot(session)).toEqual(beforeCore)
    expect(instance.core.snapshot(session).entities).toHaveLength(2)
    expect(instance.catalog()).toEqual(beforeCatalog)
    expect(instance.detail(oldId)).toEqual(oldVersion)
    expect(instance.detail(result.id)).toEqual(beforeNew)
  })

  it.each(['json', 'orphan-task', 'duplicate-key', 'disabled-cycle'] as const)('损坏来源 %s 在 dry-run 留可归因阻断，不能正式导入或发布', async (kind) => {
    const instance = fixture()
    const value = source()
    const row = value.entities.process_libraries![0]!
    const malformed = JSON.parse(String(row.attributes!.graphJson)) as ProcessLibraryMigrationGraph
    if (kind === 'orphan-task')
      malformed.tasks[0]!.library_id = 'missing-parent'
    if (kind === 'duplicate-key')
      malformed.tasks[1]!.task_key = 'a'
    if (kind === 'disabled-cycle') {
      malformed.tasks[0]!.predecessor_task_key = 'b'
      malformed.tasks[0]!.predecessor_disabled = 1
    }
    row.attributes!.graphJson = kind === 'json' ? '{' : JSON.stringify(malformed)
    const batch = await plan(instance, hashSource(value))
    expect(batch.issues).toContainEqual(expect.objectContaining({ entityType: 'process_libraries', field: 'graphJson', metricKey: 'apply-failed', attribution: 'source' }))
    await expect(instance.core.importBatch(batchCommand('import-invalid', batch.batchId), session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(instance.core.confirm(batchCommand('confirm-invalid', batch.batchId), session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(instance.core.snapshot(session)).toEqual({ authority: 'local', activeBatchId: null, entities: [] })
    expect(instance.catalog()).toMatchObject({ sourceVersion: '0', seriesVersions: {}, libraries: [] })
  })

  it('另一参与者准备失败时不提前发布工序库，重试后领域与 authority 一起切换', async () => {
    let fail = true
    let otherCommitted = false
    const instance = fixture([{
      prepareMigrationSnapshot() {
        if (fail)
          throw new Error('另一领域候选校验失败')
        return () => {
          otherCommitted = true
        }
      },
    }])
    const batch = await plan(instance)
    await instance.core.importBatch(batchCommand('import', batch.batchId), session)
    const before = instance.core.snapshot(session)
    const beforeCatalog = instance.catalog()
    await expect(instance.core.confirm(batchCommand('confirm', batch.batchId), session)).rejects.toThrow('另一领域候选校验失败')
    expect(instance.core.snapshot(session)).toEqual(before)
    expect(instance.catalog()).toEqual(beforeCatalog)
    expect(otherCommitted).toBe(false)
    fail = false
    await instance.core.confirm(batchCommand('confirm', batch.batchId), session)
    expect(instance.core.snapshot(session).authority).toBe('central')
    expect(instance.catalog().libraries).toHaveLength(1)
    expect(instance.catalog().seriesVersions).toEqual({ decoration: 2 })
    expect(otherCommitted).toBe(true)
  })

  it('没有衍生版本时可撤回迁入批次，独立创建的其他库仍可读取且不占用旧批身份', async () => {
    const instance = fixture()
    const batch = await plan(instance)
    await instance.core.importBatch(batchCommand('import', batch.batchId), session)
    await instance.core.confirm(batchCommand('confirm', batch.batchId), session)
    const visible = instance.detail(instance.catalog().libraries[0]!.id)
    const command = copyCommand(visible)
    command.commandId = 'independent-library'
    command.baseVersion = 0
    command.sourceVersion = null
    command.draft.sourceLibraryId = null
    command.draft.code = 'independent-code'
    const result = instance.libraries.execute(command, session, sessionId)
    const independent = instance.detail(result.id)
    const rolledBack = await instance.core.rollback(batchCommand('rollback', batch.batchId), session)
    expect(rolledBack).toMatchObject({ status: 'rolled-back', authority: 'local' })
    expect(instance.core.snapshot(session)).toEqual({ authority: 'local', activeBatchId: null, entities: [] })
    expect(instance.detail(result.id)).toEqual(independent)
    expect(instance.catalog().libraries.map(row => row.id)).toEqual([result.id])
    expect(instance.catalog().seriesVersions).toEqual({ 'independent-code': 1 })
    await instance.core.rollback(batchCommand('rollback-again', batch.batchId), session)
    expect(instance.detail(result.id)).toEqual(independent)
  })
})
