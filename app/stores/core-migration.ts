import type {
  BrowserCoreMigrationMarker,
  BrowserDatabaseBackupMetadata,
} from '~/lib/db/browser-storage'
import type {
  CoreMigrationBackupAttestationDTO,
  CoreMigrationBatchCommandDTO,
  CoreMigrationBatchDTO,
  CoreMigrationPreflightDTO,
  CoreMigrationSnapshotDTO,
  CoreMigrationSourceCommandDTO,
  CoreMigrationSourceDTO,
} from '~/lib/migration/core-contract'
import type { CoreMigrationRepository } from '~/lib/migration/core-http-repository'
import type { CoreMigrationLocalSource } from '~/lib/migration/core-local-source'
import { defineStore } from 'pinia'
import { computed, readonly, shallowRef } from 'vue'
import { CORE_MIGRATION_CAPABILITY } from '~/lib/migration/core-contract'
import { coreMigrationEnvelope } from '~/lib/migration/core-http-repository'
import { createCoreMigrationLocalSource } from '~/lib/migration/core-local-source'

export type CoreMigrationPhase
  = | 'idle'
    | 'preflighted'
    | 'backed-up'
    | 'dry-run'
    | 'imported'
    | 'confirmed'
    | 'cutover-pending'
    | 'rollback-pending'
    | 'rolled-back'
    | 'failed'

export interface CoreMigrationStoreDependencies {
  repository: CoreMigrationRepository
  localSource: CoreMigrationLocalSource
  createCommandId: () => string
}

export class CoreMigrationFlowError extends Error {
  constructor(
    public readonly code: 'invalid-step' | 'forbidden' | 'source-mismatch' | 'cutover-failed',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'CoreMigrationFlowError'
  }
}

function defaultDependencies(): CoreMigrationStoreDependencies {
  return {
    repository: useNuxtApp().$repositories.coreMigration,
    localSource: createCoreMigrationLocalSource(),
    createCommandId: () => crypto.randomUUID(),
  }
}

function assertStep<T>(value: T | null, message: string): T {
  if (value === null)
    throw new CoreMigrationFlowError('invalid-step', message)
  return value
}

function assertBatchStatus(
  batch: CoreMigrationBatchDTO,
  expected: CoreMigrationBatchDTO['status'],
): CoreMigrationBatchDTO {
  if (batch.status !== expected) {
    throw new CoreMigrationFlowError(
      'invalid-step',
      `迁移批次状态应为 ${expected}，实际为 ${batch.status}`,
    )
  }
  return batch
}

export function createCoreMigrationStoreDefinition(
  storeId = 'core-migration',
  resolveDependencies: () => CoreMigrationStoreDependencies = defaultDependencies,
) {
  return defineStore(storeId, () => {
    const dependencies = resolveDependencies()
    const phase = shallowRef<CoreMigrationPhase>('idle')
    const busy = shallowRef(false)
    const source = shallowRef<CoreMigrationSourceDTO | null>(null)
    const preflightResult = shallowRef<CoreMigrationPreflightDTO | null>(null)
    const backup = shallowRef<BrowserDatabaseBackupMetadata | null>(null)
    const batch = shallowRef<CoreMigrationBatchDTO | null>(null)
    const centralSnapshot = shallowRef<CoreMigrationSnapshotDTO | null>(null)
    const activeMigration = shallowRef<BrowserCoreMigrationMarker | null>(null)
    const lastError = shallowRef<Error | null>(null)
    const commandIds = new Map<string, string>()
    const preparationBlocked = computed(() => activeMigration.value !== null
      || ['confirmed', 'cutover-pending', 'rollback-pending'].includes(phase.value))

    function assertCanPrepareMigration() {
      if (preparationBlocked.value) {
        throw new CoreMigrationFlowError(
          'invalid-step',
          '当前迁移已切换或正在恢复，不能重新发起迁移',
        )
      }
    }

    function commandIdFor(step: string): string {
      let id = commandIds.get(step)
      if (!id) {
        id = dependencies.createCommandId()
        commandIds.set(step, id)
      }
      return id
    }

    async function sourceCommand(
      step: string,
      currentSource: CoreMigrationSourceDTO,
      protectedBackup: BrowserDatabaseBackupMetadata | null = null,
    ): Promise<CoreMigrationSourceCommandDTO> {
      const context = await dependencies.repository.context()
      if (!context.capabilities.includes(CORE_MIGRATION_CAPABILITY)) {
        throw new CoreMigrationFlowError('forbidden', '当前会话没有核心身份迁移权限')
      }
      return {
        ...coreMigrationEnvelope(context, commandIdFor(step)),
        source: currentSource,
        backup: protectedBackup
          ? {
            backupId: protectedBackup.backupId,
            sourceHash: protectedBackup.sourceHash,
            sourceVersion: protectedBackup.sourceVersion,
            snapshotSha256: protectedBackup.snapshotSha256,
            byteLength: protectedBackup.byteLength,
            createdAt: protectedBackup.createdAt,
            immutable: protectedBackup.immutable,
          } satisfies CoreMigrationBackupAttestationDTO
          : null,
      }
    }

    async function batchCommand(
      step: string,
      batchId: string,
    ): Promise<CoreMigrationBatchCommandDTO> {
      const context = await dependencies.repository.context()
      if (!context.capabilities.includes(CORE_MIGRATION_CAPABILITY)) {
        throw new CoreMigrationFlowError('forbidden', '当前会话没有核心身份迁移权限')
      }
      return {
        ...coreMigrationEnvelope(context, commandIdFor(step)),
        batchId,
      }
    }

    async function persistedBatchCommand(
      commandId: string,
      batchId: string,
    ): Promise<CoreMigrationBatchCommandDTO> {
      const context = await dependencies.repository.context()
      if (!context.capabilities.includes(CORE_MIGRATION_CAPABILITY))
        throw new CoreMigrationFlowError('forbidden', '当前会话没有核心身份迁移权限')
      return { ...coreMigrationEnvelope(context, commandId), batchId }
    }

    function verifySourceHash(result: { sourceHash: string }, currentSource: CoreMigrationSourceDTO) {
      if (result.sourceHash !== currentSource.sourceHash) {
        throw new CoreMigrationFlowError(
          'source-mismatch',
          '中央后台返回的迁移来源与当前受保护快照不一致',
        )
      }
    }

    async function run<T>(operation: () => Promise<T>): Promise<T> {
      if (busy.value)
        throw new CoreMigrationFlowError('invalid-step', '已有迁移动作正在执行')
      busy.value = true
      lastError.value = null
      try {
        return await operation()
      }
      catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause))
        lastError.value = error
        if (phase.value !== 'rollback-pending' && phase.value !== 'cutover-pending')
          phase.value = 'failed'
        throw error
      }
      finally {
        busy.value = false
      }
    }

    async function refreshSnapshotDirect(): Promise<CoreMigrationSnapshotDTO> {
      const result = await dependencies.repository.snapshot()
      centralSnapshot.value = result
      return result
    }

    async function refreshSnapshot(): Promise<CoreMigrationSnapshotDTO> {
      return run(refreshSnapshotDirect)
    }

    async function hydrate(): Promise<CoreMigrationSnapshotDTO> {
      return run(async () => {
        const [marker, pendingMarker, snapshot] = await Promise.all([
          dependencies.localSource.loadActiveMigration(),
          dependencies.localSource.loadPendingMigration(),
          dependencies.repository.snapshot(),
        ])
        centralSnapshot.value = snapshot
        activeMigration.value = marker

        if (!marker && pendingMarker) {
          phase.value = 'cutover-pending'
          if (snapshot.activeBatchId === pendingMarker.batchId) {
            if (snapshot.authority === 'local') {
              await dependencies.localSource.assertCurrentSource(
                pendingMarker.sourceHash,
                pendingMarker.snapshotSha256,
              )
            }
            const confirmed = assertBatchStatus(
              await dependencies.repository.confirm(
                await persistedBatchCommand(pendingMarker.commandId, pendingMarker.batchId),
              ),
              'confirmed',
            )
            const recoveredMarker: BrowserCoreMigrationMarker = {
              batchId: confirmed.batchId,
              backupId: pendingMarker.backupId,
              sourceHash: confirmed.sourceHash,
              confirmedAt: assertStep(confirmed.confirmedAt, '中央确认结果缺少确认时间'),
              rollbackExpiresAt: assertStep(confirmed.rollbackExpiresAt, '中央确认结果缺少回滚截止时间'),
            }
            await dependencies.localSource.confirmSwitch(recoveredMarker, pendingMarker.snapshotSha256)
            activeMigration.value = recoveredMarker
            batch.value = confirmed
            phase.value = 'confirmed'
            return snapshot
          }
          if (snapshot.authority === 'local' && snapshot.activeBatchId === null) {
            await dependencies.localSource.abortSwitch()
            phase.value = 'idle'
            return snapshot
          }
          throw new CoreMigrationFlowError('source-mismatch', '待切换标记与中央迁移状态不一致')
        }

        if (!marker) {
          if (snapshot.authority === 'central' || snapshot.activeBatchId !== null) {
            throw new CoreMigrationFlowError(
              'source-mismatch',
              '中央库已切换，但本机缺少受保护的回滚标记',
            )
          }
          phase.value = 'idle'
          return snapshot
        }

        if (snapshot.authority === 'local' && snapshot.activeBatchId === null) {
          phase.value = 'rollback-pending'
          return snapshot
        }
        if (snapshot.authority !== 'central' || snapshot.activeBatchId !== marker.batchId) {
          throw new CoreMigrationFlowError(
            'source-mismatch',
            '本机回滚标记与中央活动迁移批次不一致',
          )
        }
        phase.value = 'confirmed'
        return snapshot
      })
    }

    async function preflight(): Promise<CoreMigrationPreflightDTO> {
      assertCanPrepareMigration()
      return run(async () => {
        const nextSource = await dependencies.localSource.readSource()
        if (source.value?.sourceHash !== nextSource.sourceHash) {
          commandIds.clear()
          backup.value = null
          batch.value = null
        }
        source.value = nextSource
        const result = await dependencies.repository.preflight(
          await sourceCommand('preflight', nextSource),
        )
        verifySourceHash(result, nextSource)
        preflightResult.value = result
        phase.value = 'preflighted'
        return result
      })
    }

    async function createBackup(): Promise<BrowserDatabaseBackupMetadata> {
      assertCanPrepareMigration()
      return run(async () => {
        const currentSource = assertStep(source.value, '请先完成版本与来源预检')
        const checked = assertStep(preflightResult.value, '请先完成版本与来源预检')
        verifySourceHash(checked, currentSource)
        const result = await dependencies.localSource.createBackup(currentSource.sourceHash)
        backup.value = result
        phase.value = 'backed-up'
        return result
      })
    }

    async function dryRun(): Promise<CoreMigrationBatchDTO> {
      assertCanPrepareMigration()
      return run(async () => {
        const currentSource = assertStep(source.value, '请先完成版本与来源预检')
        const protectedBackup = assertStep(
          backup.value,
          'dry-run 前必须先创建受保护的本地备份',
        )
        const result = assertBatchStatus(
          await dependencies.repository.dryRun(
            await sourceCommand('dry-run', currentSource, protectedBackup),
          ),
          'dry-run',
        )
        verifySourceHash(result, currentSource)
        batch.value = result
        phase.value = 'dry-run'
        return result
      })
    }

    async function importBatch(): Promise<CoreMigrationBatchDTO> {
      assertCanPrepareMigration()
      return run(async () => {
        const currentBatch = assertStep(batch.value, '请先完成 dry-run')
        if (currentBatch.status !== 'dry-run' && currentBatch.status !== 'failed') {
          throw new CoreMigrationFlowError(
            'invalid-step',
            `迁移批次状态 ${currentBatch.status} 不允许导入`,
          )
        }
        const protectedBackup = assertStep(backup.value, '找不到受保护的本地备份')
        await dependencies.localSource.assertCurrentSource(
          currentBatch.sourceHash,
          protectedBackup.snapshotSha256,
        )
        const result = await dependencies.repository.importBatch(
          await batchCommand('import', currentBatch.batchId),
        )
        batch.value = result
        if (result.status === 'failed') {
          commandIds.delete('import')
          phase.value = 'failed'
          throw new CoreMigrationFlowError(
            'invalid-step',
            result.issues.find(issue => issue.metricKey === 'apply-failed')?.reason
            ?? '中央导入失败，可修复后安全重试',
          )
        }
        assertBatchStatus(result, 'applied')
        phase.value = 'imported'
        await refreshSnapshotDirect()
        return result
      })
    }

    async function confirmSwitch(): Promise<CoreMigrationBatchDTO> {
      return run(async () => {
        const currentBatch = assertBatchStatus(
          assertStep(batch.value, '请先完成正式导入'),
          'applied',
        )
        const protectedBackup = assertStep(backup.value, '找不到受保护的本地备份')
        const confirmCommand = await batchCommand('confirm', currentBatch.batchId)
        await dependencies.localSource.prepareSwitch({
          batchId: currentBatch.batchId,
          backupId: protectedBackup.backupId,
          sourceHash: currentBatch.sourceHash,
          snapshotSha256: protectedBackup.snapshotSha256,
          commandId: confirmCommand.commandId,
        })
        try {
          await dependencies.localSource.assertCurrentSource(
            currentBatch.sourceHash,
            protectedBackup.snapshotSha256,
          )
        }
        catch (cause) {
          phase.value = 'cutover-pending'
          let rolledBack: CoreMigrationBatchDTO
          try {
            rolledBack = assertBatchStatus(
              await dependencies.repository.rollback(
                await batchCommand('stale-source-compensation', currentBatch.batchId),
              ),
              'rolled-back',
            )
          }
          catch (rollbackCause) {
            throw new CoreMigrationFlowError(
              'cutover-failed',
              '本地来源已变化，但中央批次尚未成功撤回；旧库保持只读，请重试恢复',
              { cause: rollbackCause },
            )
          }
          await dependencies.localSource.abortSwitch()
          batch.value = rolledBack
          phase.value = 'failed'
          throw new CoreMigrationFlowError(
            'source-mismatch',
            '备份后本地正式数据已变化，中央待确认批次已撤回；请重新预检和备份',
            { cause },
          )
        }
        let confirmed: CoreMigrationBatchDTO
        try {
          confirmed = assertBatchStatus(
            await dependencies.repository.confirm(
              confirmCommand,
            ),
            'confirmed',
          )
        }
        catch (cause) {
          try {
            const snapshot = await refreshSnapshotDirect()
            if (snapshot.authority === 'local' && snapshot.activeBatchId === null)
              await dependencies.localSource.abortSwitch()
            else
              phase.value = 'cutover-pending'
          }
          catch {
            phase.value = 'cutover-pending'
          }
          throw cause
        }
        const marker: BrowserCoreMigrationMarker = {
          batchId: confirmed.batchId,
          backupId: protectedBackup.backupId,
          sourceHash: confirmed.sourceHash,
          confirmedAt: assertStep(confirmed.confirmedAt, '中央确认结果缺少确认时间'),
          rollbackExpiresAt: assertStep(
            confirmed.rollbackExpiresAt,
            '中央确认结果缺少回滚截止时间',
          ),
        }
        try {
          await dependencies.localSource.confirmSwitch(marker, protectedBackup.snapshotSha256)
        }
        catch (cause) {
          const rolledBack = assertBatchStatus(
            await dependencies.repository.rollback(
              await batchCommand('cutover-compensation', currentBatch.batchId),
            ),
            'rolled-back',
          )
          await dependencies.localSource.rollback(
            protectedBackup.backupId,
            protectedBackup.sourceHash,
          )
          batch.value = rolledBack
          activeMigration.value = null
          throw new CoreMigrationFlowError(
            'cutover-failed',
            '本地旧库未能安全切为只读，中央切换已回滚',
            { cause },
          )
        }
        batch.value = confirmed
        activeMigration.value = marker
        phase.value = 'confirmed'
        await refreshSnapshotDirect()
        return confirmed
      })
    }

    async function rollback(): Promise<CoreMigrationBatchDTO> {
      return run(async () => {
        if (phase.value !== 'confirmed' && phase.value !== 'rollback-pending')
          throw new CoreMigrationFlowError('invalid-step', '当前没有可回滚的已确认迁移')
        const durableMarker = activeMigration.value
        const currentBatch = batch.value?.status === 'confirmed' ? batch.value : null
        const batchId = durableMarker?.batchId ?? currentBatch?.batchId
        const backupId = durableMarker?.backupId ?? backup.value?.backupId
        const sourceHash = durableMarker?.sourceHash ?? currentBatch?.sourceHash ?? backup.value?.sourceHash
        if (!batchId || !backupId || !sourceHash)
          throw new CoreMigrationFlowError('invalid-step', '找不到受保护的迁移批次或本地备份')
        const rolledBack = assertBatchStatus(
          await dependencies.repository.rollback(
            await batchCommand('rollback', batchId),
          ),
          'rolled-back',
        )
        batch.value = rolledBack
        phase.value = 'rollback-pending'
        await dependencies.localSource.rollback(backupId, sourceHash)
        activeMigration.value = null
        phase.value = 'rolled-back'
        await refreshSnapshotDirect()
        return rolledBack
      })
    }

    return {
      phase: readonly(phase),
      preparationBlocked,
      busy: readonly(busy),
      source: readonly(source),
      preflightResult: readonly(preflightResult),
      backup: readonly(backup),
      batch: readonly(batch),
      centralSnapshot: readonly(centralSnapshot),
      activeMigration: readonly(activeMigration),
      lastError: readonly(lastError),
      preflight,
      createBackup,
      dryRun,
      importBatch,
      confirmSwitch,
      rollback,
      refreshSnapshot,
      hydrate,
    }
  })
}

export const useCoreMigrationStore = createCoreMigrationStoreDefinition()
