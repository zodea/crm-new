import type { CoreMigrationSnapshotDTO } from '~/lib/migration/core-contract'
import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { CORE_MIGRATION_CONTRACT_VERSION, CORE_MIGRATION_SOURCE_MODE, CORE_MIGRATION_SOURCE_VERSION, CORE_MIGRATION_TOPOLOGY, coreMigrationSourceHashInput } from '~/lib/migration/core-contract'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { prepareCoreMigrationCommandSources } from '../../server/utils/core-migration-preparation'
import { createCoreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { createBoqBuildingFixture } from '../helpers/boq-building-fixture'

const snapshot: CoreMigrationSnapshotDTO = { authority: 'central', activeBatchId: 'batch-quantity', entities: [] }

it('测试专用重置销毁默认合成清单更正，正常回滚仍保护原始来源及其他会话', async () => {
  const fixture = await createBoqBuildingFixture()
  const isolatedSession = 'reset-independent-owner'
  try {
    const current = fixture.core.snapshot(fixture.session)
    fixture.owner.synchronizeMigrationSnapshot(current, isolatedSession)
    const isolatedQuantity = await fixture.quantity.prepareMigrationSnapshot(current, isolatedSession)
    isolatedQuantity.commit()
    const independentOwner = fixture.owner.quantityBoqFacts(fixture.query.projectId, isolatedSession)
    const independentBytes = await fixture.quantity.exportSnapshotBytes(isolatedSession)
    const context = await fixture.service.read(fixture.query)
    await fixture.service.execute({ ...fixture.query, workspaceId: context.workspaceId, actorId: context.actorId, requiredCapability: 'owner-document:write', commandId: 'reset-corrected-boq', sourceVersion: context.sourceVersion, lineId: 'q-boq', buildingId: context.buildings[0]!.id, reason: '合成清单的原始楼栋更正' })
    await expect(fixture.core.rollback({ ...fixture.envelope('reset-protected-rollback'), batchId: fixture.batch.batchId }, fixture.session)).rejects.toThrow(/中央日常更正/)
    expect(fixture.core.snapshot(fixture.session)).toEqual(current)

    vi.doMock('../../server/utils/core-migration-test-instance', () => ({ coreMigrationTestInstance: fixture.core }))
    vi.doMock('../../server/utils/owner-commercial-document-command-test-instance', () => ({ ownerCommercialDocumentCommandTestInstance: fixture.owner }))
    vi.doMock('../../server/utils/quantity-runtime', () => ({ quantityTestInstance: fixture.quantity }))
    vi.stubGlobal('defineEventHandler', (handler: (event: unknown) => unknown) => handler)
    vi.stubGlobal('getHeader', () => '1')
    vi.stubEnv('NODE_ENV', 'test')
    const reset = (await import('../../server/api/testing/core-migration/reset.post')).default
    await expect(reset({} as Parameters<typeof reset>[0])).resolves.toEqual({ authority: 'local', activeBatchId: null })
    expect(fixture.core.snapshot(fixture.session)).toEqual({ authority: 'local', activeBatchId: null, entities: [] })
    expect(fixture.owner.quantityBoqFacts(fixture.query.projectId).lines).toEqual([])
    expect(fixture.owner.quantityBoqFacts(fixture.query.projectId, isolatedSession)).toEqual(independentOwner)
    expect(await fixture.quantity.exportSnapshotBytes(isolatedSession)).toEqual(independentBytes)
  }
  finally {
    vi.doUnmock('../../server/utils/core-migration-test-instance')
    vi.doUnmock('../../server/utils/owner-commercial-document-command-test-instance')
    vi.doUnmock('../../server/utils/quantity-runtime')
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    await fixture.close()
  }
}, 30_000)

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
  const batch = await core.dryRun({ ...envelope('dry-run'), source, backup: { backupId: `core-migration-${source.sourceHash}-${'e'.repeat(64)}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256: 'e'.repeat(64), byteLength: 442, createdAt: '2026-09-15T00:00:00.000Z', immutable: true } }, session)
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
