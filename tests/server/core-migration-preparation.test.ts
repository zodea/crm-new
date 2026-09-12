import type { CoreMigrationSnapshotDTO } from '~/lib/migration/core-contract'
import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { CORE_MIGRATION_CONTRACT_VERSION, CORE_MIGRATION_SOURCE_MODE, CORE_MIGRATION_SOURCE_VERSION, CORE_MIGRATION_TOPOLOGY, coreMigrationSourceHashInput } from '~/lib/migration/core-contract'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { prepareCoreMigrationCommandSources } from '../../server/utils/core-migration-preparation'
import { createCoreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'

const snapshot: CoreMigrationSnapshotDTO = { authority: 'central', activeBatchId: 'batch-quantity', entities: [] }

async function appliedBatch(core: ReturnType<typeof createCoreMigrationTestInstance>) {
  const session = resolveBusinessSession()
  const emptySource = {
    contractVersion: CORE_MIGRATION_CONTRACT_VERSION,
    mode: CORE_MIGRATION_SOURCE_MODE,
    sourceVersion: CORE_MIGRATION_SOURCE_VERSION,
    entities: Object.fromEntries(CORE_MIGRATION_TOPOLOGY.map(type => [type, []])) as Parameters<typeof core.preflight>[0]['source']['entities'],
  }
  const source = { ...emptySource, sourceHash: createHash('sha256').update(coreMigrationSourceHashInput(emptySource)).digest('hex') }
  const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, commandId, requiredCapability: 'core:migration:write' as const })
  await core.preflight({ ...envelope('preflight'), source, backup: null }, session)
  const batch = await core.dryRun({ ...envelope('dry-run'), source, backup: { backupId: `core-migration-${source.sourceHash}-${'e'.repeat(64)}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256: 'e'.repeat(64), byteLength: 442, createdAt: new Date().toISOString(), immutable: true } }, session)
  await core.importBatch({ ...envelope('import'), batchId: batch.batchId }, session)
  return { session, envelope, batch }
}

it('异步SQL准备失败时丢弃已准备资源，其他领域既不取旧快照也不切换', async () => {
  const steps: string[] = []
  await expect(prepareCoreMigrationCommandSources(snapshot, [{
    prepareMigrationSnapshot() {
      steps.push('map-prepare')
      return () => steps.push('map-commit')
    },
  }], [{
    async prepareMigrationSnapshot() {
      steps.push('sql-prepare')
      return {
        commit() { steps.push('sql-commit') },
        abort() { steps.push('sql-discard') },
      }
    },
  }, {
    async prepareMigrationSnapshot() {
      await Promise.resolve()
      throw new Error('SQL导入故障')
    },
  }])).rejects.toThrow('SQL导入故障')
  expect(steps).toEqual(['sql-prepare', 'sql-discard'])
})

it('返回准备结果后发生的中央更正保留到最终同步提交，准备期间不提前复制旧Map', async () => {
  let current = '迁移前'
  let result = ''
  const prepared = await prepareCoreMigrationCommandSources(snapshot, [{
    prepareMigrationSnapshot() {
      const captured = current
      return () => {
        result = captured
      }
    },
  }])
  current = '等待期间的中央更正'
  prepared.commit()
  expect(result).toBe('等待期间的中央更正')
})

it('总确认等待异步准备且失败不切authority，重试在同一提交步发布领域与权威', async () => {
  let release!: () => void
  let fail = true
  let domain = 'local'
  const core = createCoreMigrationTestInstance({
    prepareTransition: async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      if (fail)
        throw new Error('候选SQL故障')
      return {
        commit() { domain = 'central' },
        abort() {},
      }
    },
  })
  const { session, envelope, batch } = await appliedBatch(core)
  const confirming = core.confirm({ ...envelope('confirm'), batchId: batch.batchId }, session)
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  expect(core.snapshot(session).authority).toBe('local')
  expect(domain).toBe('local')
  release()
  await expect(confirming).rejects.toThrow('候选SQL故障')
  expect(core.snapshot(session).authority).toBe('local')
  fail = false
  release = undefined as unknown as () => void
  const retry = core.confirm({ ...envelope('confirm'), batchId: batch.batchId }, session)
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  release()
  await retry
  expect(core.snapshot(session).authority).toBe('central')
  expect(domain).toBe('central')
})

it('同工作区确认与回滚按受理顺序准备，不让迟到确认覆盖已受理回滚', async () => {
  let release!: () => void
  let entered!: () => void
  const began = new Promise<void>((resolve) => {
    entered = resolve
  })
  const preparationOrder: string[] = []
  let domain = 'local'
  const core = createCoreMigrationTestInstance({
    prepareTransition: async (next) => {
      preparationOrder.push(next.authority)
      if (next.authority === 'central') {
        entered()
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
      return {
        commit() { domain = next.authority },
        abort() {},
      }
    },
  })
  const { session, envelope, batch } = await appliedBatch(core)
  const confirming = core.confirm({ ...envelope('confirm'), batchId: batch.batchId }, session)
  await began
  const rollback = core.rollback({ ...envelope('rollback'), batchId: batch.batchId }, session)
  await Promise.resolve()
  const beforeRelease = [...preparationOrder]
  release()
  await Promise.all([confirming, rollback])
  expect(beforeRelease).toEqual(['central'])
  expect(preparationOrder).toEqual(['central', 'local'])
  expect(core.snapshot(session).authority).toBe('local')
  expect(domain).toBe('local')
})

it('兼容通知钩子抛错会丢弃候选，不在领域提交以后才报告失败', async () => {
  const steps: string[] = []
  let fail = true
  const core = createCoreMigrationTestInstance({
    prepareTransition: async () => ({
      commit() { steps.push('commit') },
      abort() { steps.push('abort') },
    }),
    afterConfirm: async () => {
      if (fail)
        throw new Error('确认附加校验失败')
    },
  })
  const { session, envelope, batch } = await appliedBatch(core)
  await expect(core.confirm({ ...envelope('confirm'), batchId: batch.batchId }, session)).rejects.toThrow('确认附加校验失败')
  expect(steps).toEqual(['abort'])
  expect(core.snapshot(session).authority).toBe('local')
  fail = false
  await core.confirm({ ...envelope('confirm'), batchId: batch.batchId }, session)
  expect(steps).toEqual(['abort', 'commit'])
  expect(core.snapshot(session).authority).toBe('central')
})
