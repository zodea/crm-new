import type { CoreMigrationServerEntityDTO, CoreMigrationSnapshotDTO } from '~/lib/migration/core-contract'
import { expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { readQuantityMigrationGraphs } from '~/lib/quantity/migration-source'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { prepareCoreMigrationCommandSources } from '../../server/utils/core-migration-preparation'
import { createCoreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { createQuantityTestInstance } from '../../server/utils/quantity-test-instance'
import { createMemoryDb } from '../helpers/memory-db'
import { seedQuantityMigrationSource } from '../helpers/quantity-migration-source'

const context = { workspaceId: 'workspace-default', actorId: 'actor-default', capabilities: ['quantity:read', 'quantity:write', 'project:list:read'] }
const query = { projectId: 'central-project', origin: 'real' as const, includeDemo: false }
const batchId = 'batch-quantity-442'
const local: CoreMigrationSnapshotDTO = { authority: 'local', activeBatchId: null, entities: [] }

async function source(): Promise<CoreMigrationSnapshotDTO> {
  const database = await createMemoryDb()
  try {
    await runMigrations(database)
    await database.execute('INSERT INTO projects (id,name) VALUES (\'old-project\',\'迁入工程\')')
    await database.execute('INSERT INTO buildings (id,project_id,code,name) VALUES (\'old-building\',\'old-project\',\'B1\',\'迁入一栋\')')
    const graph = (await readQuantityMigrationGraphs(database))[0]!.graph
    const base = { name: '迁入工程', references: {}, quantity: null, amount: null, deletedAt: null, batchId }
    const entities: CoreMigrationServerEntityDTO[] = [
      { ...base, entityType: 'projects', id: query.projectId, legacyId: 'old-project', attributes: {} },
      { ...base, entityType: 'quantity_projects', id: 'quantity-project', legacyId: 'old-project', references: { projectId: query.projectId }, attributes: { graphJson: JSON.stringify(graph) } },
    ]
    return { authority: 'central', activeBatchId: batchId, entities }
  }
  finally { database.close() }
}

function instance() {
  return createQuantityTestInstance({
    session: () => context,
    projects: () => [
      { id: query.projectId, name: '中央项目', code: 'P', dataOrigin: 'real' },
      { id: 'independent-project', name: '独立新建项目', code: 'I', dataOrigin: 'real' },
    ],
  })
}

it('完整工程量在准备期间占住实例队列，确认后从同一服务读回映射身份，重复同步保持版本', async () => {
  const target = instance()
  try {
    const snapshot = await source()
    const before = await target.region(query)
    const prepared = await target.prepareMigrationSnapshot(snapshot)
    let settled = false
    const reading = target.region(query).then((value) => {
      settled = true
      return value
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    prepared.commit()
    const migrated = await reading
    expect(migrated.data.buildings).toEqual([expect.objectContaining({ id: 'quantity-project:buildings:old-building', name: '迁入一栋' })])
    expect(migrated.sourceVersion).not.toBe(before.sourceVersion)
    ;(await target.prepareMigrationSnapshot(snapshot)).commit()
    expect((await target.region(query)).sourceVersion).toBe(migrated.sourceVersion)
    const independentQuery = { ...query, projectId: 'independent-project' }
    const independentBefore = await target.region(independentQuery)
    await target.execute({ ...context, requiredCapability: 'quantity:write', commandId: 'independent-project-building', projectId: independentQuery.projectId, origin: 'real', baseVersion: independentBefore.sourceVersion, action: { kind: 'create-building', draft: { code: 'I1', name: '独立项目一栋' } } })
    const independent = await target.region(independentQuery)
    ;(await target.prepareMigrationSnapshot(local)).commit()
    expect((await target.region(query)).data.buildings).toEqual([])
    expect((await target.region(independentQuery)).data).toEqual(independent.data)
    expect((await target.region(independentQuery)).sourceVersion).toBe(independent.sourceVersion)
  }
  finally { await target.close() }
})

it('真实SQL编码冲突使候选准备失败，现有记录与版本保持，实例队列仍可继续读写', async () => {
  const target = instance()
  try {
    const before = await target.region(query)
    await target.execute({ ...context, requiredCapability: 'quantity:write', commandId: 'existing-building', projectId: query.projectId, origin: 'real', baseVersion: before.sourceVersion, action: { kind: 'create-building', draft: { code: 'B1', name: '中央已有一栋' } } })
    const expected = await target.region(query)
    await expect(target.prepareMigrationSnapshot(await source())).rejects.toThrow()
    expect((await target.region(query)).data).toEqual(expected.data)
    expect((await target.region(query)).sourceVersion).toBe(expected.sourceVersion)
    await target.execute({ ...context, requiredCapability: 'quantity:write', commandId: 'following-building', projectId: query.projectId, origin: 'real', baseVersion: expected.sourceVersion, action: { kind: 'create-building', draft: { code: 'B2', name: '后续正常保存' } } })
    expect((await target.region(query)).data.buildings).toHaveLength(2)
  }
  finally { await target.close() }
})

it('真实SQL准备失败时总确认不切权威且其他命令来源完全不发布，后续回滚仍可执行', async () => {
  const target = instance()
  const native = await createMemoryDb()
  let otherDomain = '原中央事实'
  let preparedCount = 0
  const core = createCoreMigrationTestInstance({
    createServerId: ({ entityType, legacyId }) => entityType === 'projects' ? query.projectId : `${entityType}:${legacyId}`,
    prepareTransition: next => prepareCoreMigrationCommandSources(next, [{
      prepareMigrationSnapshot() {
        preparedCount += 1
        return () => {
          otherDomain = '新迁移事实'
        }
      },
    }], [target]),
  })
  try {
    const initial = await target.region(query)
    await target.execute({ ...context, requiredCapability: 'quantity:write', commandId: 'existing', projectId: query.projectId, origin: 'real', baseVersion: initial.sourceVersion, action: { kind: 'create-building', draft: { code: 'B1', name: '原有中央一栋' } } })
    const existing = await target.region(query)
    const source = await seedQuantityMigrationSource(native)
    const session = resolveBusinessSession()
    const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'core:migration:write' as const, commandId })
    await core.preflight({ ...envelope('preflight'), source, backup: null }, session)
    const hash = 'e'.repeat(64)
    const batch = await core.dryRun({ ...envelope('dry'), source, backup: { backupId: `core-migration-${source.sourceHash}-${hash}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256: hash, byteLength: 442, createdAt: '2026-09-15T00:00:00.000Z', immutable: true } }, session)
    await core.importBatch({ ...envelope('import'), batchId: batch.batchId }, session)
    await expect(core.confirm({ ...envelope('confirm'), batchId: batch.batchId }, session)).rejects.toThrow()
    expect(core.snapshot(session).authority).toBe('local')
    expect(otherDomain).toBe('原中央事实')
    expect(preparedCount).toBe(0)
    expect((await target.region(query)).data).toEqual(existing.data)
    expect((await target.region(query)).sourceVersion).toBe(existing.sourceVersion)
    await core.rollback({ ...envelope('rollback'), batchId: batch.batchId }, session)
    expect(core.snapshot(session).authority).toBe('local')
    expect((await target.region(query)).data).toEqual(existing.data)
  }
  finally {
    native.close()
    await target.close()
  }
})

it('独立新建引用迁入项目时明确阻断回滚，保留该记录、迁入事实及当前版本', async () => {
  const target = instance()
  try {
    ;(await target.prepareMigrationSnapshot(await source())).commit()
    const before = await target.region(query)
    await target.execute({ ...context, requiredCapability: 'quantity:write', commandId: 'independent-child', projectId: query.projectId, origin: 'real', baseVersion: before.sourceVersion, action: { kind: 'create-building', draft: { code: 'B2', name: '独立新增二栋' } } })
    const expected = await target.region(query)
    const result = await target.prepareMigrationSnapshot(local).then(async (prepared) => {
      await prepared.abort()
      return 'unexpected-success'
    }, cause => cause)
    expect(result).toMatchObject({ problem: { code: 'conflict', message: expect.stringContaining('独立') } })
    const after = await target.region(query)
    expect(after.data).toEqual(expected.data)
    expect(after.sourceVersion).toBe(expected.sourceVersion)
  }
  finally { await target.close() }
})
