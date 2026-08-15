import type {
  BrowserCoreMigrationMarker,
  BrowserDatabaseBackupMetadata,
} from '~/lib/db/browser-storage'
import type {
  CoreMigrationBatchDTO,
  CoreMigrationSourceDTO,
} from '~/lib/migration/core-contract'
import type { CoreMigrationRepository } from '~/lib/migration/core-http-repository'
import type { CoreMigrationLocalSource } from '~/lib/migration/core-local-source'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CORE_MIGRATION_CAPABILITY,
  CORE_MIGRATION_CONTRACT_VERSION,
  CORE_MIGRATION_SOURCE_MODE,
  CORE_MIGRATION_SOURCE_VERSION,
  CORE_MIGRATION_TOPOLOGY,
} from '~/lib/migration/core-contract'
import {
  CoreMigrationFlowError,
  createCoreMigrationStoreDefinition,
} from '~/stores/core-migration'

const SOURCE: CoreMigrationSourceDTO = {
  contractVersion: CORE_MIGRATION_CONTRACT_VERSION,
  mode: CORE_MIGRATION_SOURCE_MODE,
  sourceVersion: CORE_MIGRATION_SOURCE_VERSION,
  sourceHash: 'a'.repeat(64),
  entities: Object.fromEntries(
    CORE_MIGRATION_TOPOLOGY.map(entityType => [entityType, []]),
  ) as CoreMigrationSourceDTO['entities'],
}

function batch(status: CoreMigrationBatchDTO['status']): CoreMigrationBatchDTO {
  return {
    batchId: 'batch-1',
    sourceVersion: SOURCE.sourceVersion,
    sourceHash: SOURCE.sourceHash,
    status,
    authority: status === 'confirmed' ? 'central' : 'local',
    steps: [],
    mappings: [],
    sourceRefs: [],
    issues: [],
    createdAt: '2026-08-15T01:00:00.000Z',
    updatedAt: '2026-08-15T01:00:00.000Z',
    rollbackExpiresAt: status === 'confirmed' ? '2026-08-22T01:00:00.000Z' : null,
    confirmedAt: status === 'confirmed' ? '2026-08-15T01:00:00.000Z' : null,
    rolledBackAt: status === 'rolled-back' ? '2026-08-15T02:00:00.000Z' : null,
  }
}

function backup(): BrowserDatabaseBackupMetadata {
  return {
    backupId: `core-migration-${SOURCE.sourceHash}-${'b'.repeat(64)}`,
    createdAt: '2026-08-15T01:00:00.000Z',
    sourceSchemaVersion: 40,
    sourceVersion: SOURCE.sourceVersion,
    sourceHash: SOURCE.sourceHash,
    snapshotSha256: 'b'.repeat(64),
    immutable: true,
    snapshotKey: 'production',
    byteLength: 3,
  }
}

function marker(): BrowserCoreMigrationMarker {
  return {
    batchId: 'batch-1',
    backupId: backup().backupId,
    sourceHash: SOURCE.sourceHash,
    confirmedAt: '2026-08-15T01:00:00.000Z',
    rollbackExpiresAt: '2026-08-22T01:00:00.000Z',
  }
}

describe('core migration store', () => {
  const events: string[] = []
  const repository = {
    context: vi.fn(),
    preflight: vi.fn(),
    dryRun: vi.fn(),
    importBatch: vi.fn(),
    confirm: vi.fn(),
    rollback: vi.fn(),
    snapshot: vi.fn(),
  }
  const localSource = {
    readSource: vi.fn(),
    createBackup: vi.fn(),
    assertCurrentSource: vi.fn(),
    prepareSwitch: vi.fn(),
    abortSwitch: vi.fn(),
    confirmSwitch: vi.fn(),
    rollback: vi.fn(),
    loadActiveMigration: vi.fn(),
    loadPendingMigration: vi.fn(),
  }

  beforeEach(() => {
    events.length = 0
    setActivePinia(createPinia())
    repository.context.mockReset().mockResolvedValue({
      workspaceId: 'workspace-default',
      actorId: 'actor-default',
      capabilities: [CORE_MIGRATION_CAPABILITY],
    })
    repository.preflight.mockReset().mockImplementation(async () => {
      events.push('remote:preflight')
      return {
        eligible: true,
        contractVersion: CORE_MIGRATION_CONTRACT_VERSION,
        mode: CORE_MIGRATION_SOURCE_MODE,
        sourceVersion: SOURCE.sourceVersion,
        sourceHash: SOURCE.sourceHash,
        entityCount: 0,
      }
    })
    repository.dryRun.mockReset().mockImplementation(async () => {
      events.push('remote:dry-run')
      return batch('dry-run')
    })
    repository.importBatch.mockReset().mockImplementation(async () => {
      events.push('remote:import')
      return batch('applied')
    })
    repository.confirm.mockReset().mockImplementation(async () => {
      events.push('remote:confirm')
      return batch('confirmed')
    })
    repository.rollback.mockReset().mockImplementation(async () => {
      events.push('remote:rollback')
      return batch('rolled-back')
    })
    repository.snapshot.mockReset().mockResolvedValue({
      authority: 'central',
      activeBatchId: 'batch-1',
      entities: [],
    })
    localSource.readSource.mockReset().mockResolvedValue(SOURCE)
    localSource.createBackup.mockReset().mockImplementation(async () => {
      events.push('local:backup')
      return backup()
    })
    localSource.assertCurrentSource.mockReset().mockResolvedValue(undefined)
    localSource.prepareSwitch.mockReset().mockImplementation(async () => {
      events.push('local:prepare')
    })
    localSource.abortSwitch.mockReset().mockImplementation(async () => {
      events.push('local:abort')
    })
    localSource.confirmSwitch.mockReset().mockImplementation(async () => {
      events.push('local:lock')
    })
    localSource.rollback.mockReset().mockImplementation(async () => {
      events.push('local:restore')
    })
    localSource.loadActiveMigration.mockReset().mockResolvedValue(null)
    localSource.loadPendingMigration.mockReset().mockResolvedValue(null)
  })

  function useStore() {
    let command = 0
    return createCoreMigrationStoreDefinition(
      'core-migration-test',
      () => ({
        repository: repository as unknown as CoreMigrationRepository,
        localSource: localSource as unknown as CoreMigrationLocalSource,
        createCommandId: () => `command-${++command}`,
      }),
    )()
  }

  it('runs the explicit preflight, immutable backup, dry-run, import and cutover sequence', async () => {
    const store = useStore()

    await store.preflight()
    await store.createBackup()
    await store.dryRun()
    await store.importBatch()
    await store.confirmSwitch()

    expect(events).toEqual([
      'remote:preflight',
      'local:backup',
      'remote:dry-run',
      'remote:import',
      'local:prepare',
      'remote:confirm',
      'local:lock',
    ])
    expect(store.phase).toBe('confirmed')
    expect(store.batch).toMatchObject({ status: 'confirmed', authority: 'central' })
    expect(store.centralSnapshot).toEqual({
      authority: 'central',
      activeBatchId: 'batch-1',
      entities: [],
    })
    expect(repository.snapshot).toHaveBeenCalledTimes(2)
    expect(store.backup).toEqual(backup())
    expect(repository.preflight).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-default',
      actorId: 'actor-default',
      requiredCapability: CORE_MIGRATION_CAPABILITY,
      source: SOURCE,
      backup: null,
    }))
    expect(localSource.createBackup).toHaveBeenCalledWith(SOURCE.sourceHash)
    expect(localSource.confirmSwitch).toHaveBeenCalledWith(marker())
  })

  it('does not create a backup or switch authority when preflight fails', async () => {
    repository.preflight.mockRejectedValueOnce(new Error('预检失败'))
    const store = useStore()

    await expect(store.preflight()).rejects.toThrow('预检失败')

    expect(store.phase).toBe('failed')
    expect(localSource.createBackup).not.toHaveBeenCalled()
    expect(localSource.confirmSwitch).not.toHaveBeenCalled()
    expect(store.batch).toBeNull()
  })

  it('requires a protected backup before dry-run can write a migration batch', async () => {
    const store = useStore()
    await store.preflight()

    await expect(store.dryRun()).rejects.toMatchObject({ code: 'invalid-step' })
    expect(repository.dryRun).not.toHaveBeenCalled()
  })

  it('compensates a local cutover failure so the migration never remains confirmed', async () => {
    localSource.confirmSwitch.mockRejectedValueOnce(new Error('本地只读锁失败'))
    const store = useStore()
    await store.preflight()
    await store.createBackup()
    await store.dryRun()
    await store.importBatch()

    await expect(store.confirmSwitch()).rejects.toBeInstanceOf(CoreMigrationFlowError)

    expect(events.slice(-3)).toEqual([
      'remote:confirm',
      'remote:rollback',
      'local:restore',
    ])
    expect(store.phase).toBe('failed')
    expect(store.batch).toMatchObject({ status: 'rolled-back', authority: 'local' })
  })

  it('rolls a confirmed batch back to the protected local snapshot', async () => {
    const store = useStore()
    await store.preflight()
    await store.createBackup()
    await store.dryRun()
    await store.importBatch()
    await store.confirmSwitch()

    await store.rollback()

    expect(events.slice(-2)).toEqual(['remote:rollback', 'local:restore'])
    expect(localSource.rollback).toHaveBeenLastCalledWith(backup().backupId, SOURCE.sourceHash)
    expect(store.phase).toBe('rolled-back')
    expect(store.batch).toMatchObject({ status: 'rolled-back', authority: 'local' })
    expect(repository.snapshot).toHaveBeenCalledTimes(3)
  })

  it('中央已回滚但本地恢复失败时保留可重试状态', async () => {
    const store = useStore()
    await store.preflight()
    await store.createBackup()
    await store.dryRun()
    await store.importBatch()
    await store.confirmSwitch()
    localSource.rollback.mockRejectedValueOnce(new Error('本地快照暂时无法恢复'))

    await expect(store.rollback()).rejects.toThrow('本地快照暂时无法恢复')
    expect(store.phase).toBe('rollback-pending')
    expect(store.activeMigration).toEqual(marker())
    expect(store.batch).toMatchObject({ status: 'rolled-back', authority: 'local' })

    await store.rollback()

    expect(repository.rollback).toHaveBeenCalledTimes(2)
    expect(localSource.rollback).toHaveBeenCalledTimes(2)
    expect(store.phase).toBe('rolled-back')
    expect(store.activeMigration).toBeNull()
  })

  it('exposes an explicit snapshot refresh without letting the page bypass Pinia', async () => {
    const store = useStore()

    await store.refreshSnapshot()

    expect(repository.snapshot).toHaveBeenCalledOnce()
    expect(store.centralSnapshot).toEqual({
      authority: 'central',
      activeBatchId: 'batch-1',
      entities: [],
    })
  })

  it('hydrates a confirmed rollback window from the durable marker and central snapshot', async () => {
    localSource.loadActiveMigration.mockResolvedValueOnce(marker())
    const store = useStore()

    await store.hydrate()

    expect(store.phase).toBe('confirmed')
    expect(store.activeMigration).toEqual(marker())
    expect(store.centralSnapshot).toMatchObject({
      authority: 'central',
      activeBatchId: marker().batchId,
    })

    await store.rollback()

    expect(repository.rollback).toHaveBeenCalledWith(expect.objectContaining({
      batchId: marker().batchId,
    }))
    expect(localSource.rollback).toHaveBeenCalledWith(marker().backupId, marker().sourceHash)
    expect(store.activeMigration).toBeNull()
    expect(store.phase).toBe('rolled-back')
  })

  it('刷新时对中央仍为 applied 的同批次重放持久 confirm 命令', async () => {
    const pending = {
      batchId: 'batch-1',
      backupId: backup().backupId,
      sourceHash: SOURCE.sourceHash,
      snapshotSha256: backup().snapshotSha256,
      commandId: 'command-confirm-persisted',
    }
    localSource.loadPendingMigration.mockResolvedValueOnce(pending)
    repository.snapshot.mockResolvedValueOnce({
      authority: 'local',
      activeBatchId: 'batch-1',
      entities: [],
    })
    const store = useStore()

    await store.hydrate()

    expect(localSource.assertCurrentSource).toHaveBeenCalledWith(
      SOURCE.sourceHash,
      backup().snapshotSha256,
    )
    expect(repository.confirm).toHaveBeenCalledWith(expect.objectContaining({
      commandId: pending.commandId,
      batchId: pending.batchId,
    }))
    expect(localSource.confirmSwitch).toHaveBeenCalledWith(marker())
    expect(store.phase).toBe('confirmed')
  })

  it('刷新时识别中央已回滚但本地仍待恢复的持久标记', async () => {
    localSource.loadActiveMigration.mockResolvedValueOnce(marker())
    repository.snapshot.mockResolvedValueOnce({
      authority: 'local',
      activeBatchId: null,
      entities: [],
    })
    const store = useStore()

    await store.hydrate()

    expect(store.phase).toBe('rollback-pending')
    expect(store.activeMigration).toEqual(marker())
    await store.rollback()
    expect(localSource.rollback).toHaveBeenCalledWith(marker().backupId, marker().sourceHash)
    expect(store.phase).toBe('rolled-back')
  })

  it('导入失败不缓存失败结果，并用新 commandId 在页面内安全重试', async () => {
    repository.importBatch
      .mockResolvedValueOnce({
        ...batch('failed'),
        issues: [{
          id: 'apply-failed-1',
          batchId: 'batch-1',
          commandId: 'command-failed',
          entityType: 'projects',
          legacyId: 'project-1',
          serverId: null,
          field: 'entity',
          metricKey: 'apply-failed',
          sourceValue: 'project-1',
          expectedValue: null,
          actualValue: null,
          difference: null,
          attribution: 'system',
          reason: '临时写入失败',
        }],
      })
      .mockResolvedValueOnce(batch('applied'))
    const store = useStore()
    await store.preflight()
    await store.createBackup()
    await store.dryRun()

    await expect(store.importBatch()).rejects.toThrow('临时写入失败')
    expect(store.phase).toBe('failed')
    await expect(store.importBatch()).resolves.toMatchObject({ status: 'applied' })

    const first = repository.importBatch.mock.calls[0]![0]
    const second = repository.importBatch.mock.calls[1]![0]
    expect(second.commandId).not.toBe(first.commandId)
  })

  it('导入与确认前重核 production，确认前变化会撤回中央待确认批次', async () => {
    const beforeImport = useStore()
    await beforeImport.preflight()
    await beforeImport.createBackup()
    await beforeImport.dryRun()
    localSource.assertCurrentSource.mockRejectedValueOnce(new Error('本地来源已变化'))
    await expect(beforeImport.importBatch()).rejects.toThrow('本地来源已变化')
    expect(repository.importBatch).not.toHaveBeenCalled()

    const beforeConfirm = useStore()
    await beforeConfirm.preflight()
    await beforeConfirm.createBackup()
    await beforeConfirm.dryRun()
    await beforeConfirm.importBatch()
    localSource.assertCurrentSource.mockRejectedValueOnce(new Error('本地来源再次变化'))
    await expect(beforeConfirm.confirmSwitch()).rejects.toThrow('中央待确认批次已撤回')
    expect(repository.confirm).not.toHaveBeenCalled()
    expect(repository.rollback).toHaveBeenCalledWith(expect.objectContaining({
      batchId: 'batch-1',
    }))
    expect(localSource.rollback).not.toHaveBeenCalled()
  })

  it('来源变化但中央撤回失败时保留待切换锁', async () => {
    const store = useStore()
    await store.preflight()
    await store.createBackup()
    await store.dryRun()
    await store.importBatch()
    localSource.assertCurrentSource.mockRejectedValueOnce(new Error('本地来源再次变化'))
    repository.rollback.mockRejectedValueOnce(new Error('中央暂时不可用'))

    await expect(store.confirmSwitch()).rejects.toThrow('旧库保持只读')

    expect(localSource.abortSwitch).not.toHaveBeenCalled()
    expect(store.phase).toBe('cutover-pending')
  })
})
