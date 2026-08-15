import type {
  CoreMigrationBackupAttestationDTO,
  CoreMigrationBatchCommandDTO,
  CoreMigrationSourceCommandDTO,
  CoreMigrationSourceDTO,
} from '../../app/lib/migration/core-contract'
import type { BusinessSession } from '../../server/utils/business-session'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  CORE_MIGRATION_CAPABILITY,
  CORE_MIGRATION_CONTRACT_VERSION,
  CORE_MIGRATION_SOURCE_MODE,
  CORE_MIGRATION_SOURCE_VERSION,
  CORE_MIGRATION_TOPOLOGY,
  coreMigrationSourceHashInput,
} from '../../app/lib/migration/core-contract'
import {
  parseCoreMigrationBatchCommand,
  parseCoreMigrationSourceCommand,
} from '../../server/utils/core-migration-request'
import { createCoreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'

const SESSION: BusinessSession = {
  workspaceId: 'workspace-default',
  actorId: 'actor-default',
  capabilities: [CORE_MIGRATION_CAPABILITY],
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function source(overrides: Partial<Omit<CoreMigrationSourceDTO, 'sourceHash'>> = {}): CoreMigrationSourceDTO {
  const unsigned = {
    contractVersion: CORE_MIGRATION_CONTRACT_VERSION,
    mode: CORE_MIGRATION_SOURCE_MODE,
    sourceVersion: CORE_MIGRATION_SOURCE_VERSION,
    entities: {
      customers: [
        { legacyId: 'customer-old-1', name: '第一客户' },
      ],
      suppliers: [
        { legacyId: 'supplier-old-1', name: '第一分供方' },
      ],
      crews: [
        { legacyId: 'crew-old-1', name: '泥水班组' },
      ],
      projects: [
        {
          legacyId: 'project-old-1',
          name: '完整关系项目',
          amount: '100.00',
          references: { customerId: 'customer-old-1' },
        },
        {
          legacyId: 'project-old-2',
          name: '缺客户关系项目',
          references: { customerId: 'customer-name-only' },
        },
      ],
      workers: [
        {
          legacyId: 'worker-old-1',
          name: '第一工人',
          quantity: 3,
          references: { crewId: 'crew-old-1', projectId: 'project-old-1' },
        },
      ],
      project_suppliers: [
        {
          legacyId: 'project-supplier-old-1',
          name: '项目分供方关系',
          references: { projectId: 'project-old-1', supplierId: 'supplier-old-1' },
        },
        {
          legacyId: 'project-supplier-orphan',
          name: '孤儿关系',
          references: { projectId: 'project-old-1', supplierId: 'supplier-name-only' },
        },
      ],
    },
    expectations: {
      counts: { projects: 2, project_suppliers: 2 },
      totals: [
        { entityType: 'projects', metric: 'amount', expected: '100.00' },
        { entityType: 'workers', metric: 'quantity', expected: 3 },
      ],
    },
    ...overrides,
  }
  return {
    ...unsigned,
    sourceHash: sha256(coreMigrationSourceHashInput(unsigned)),
  }
}

function cleanSource(overrides: Partial<Omit<CoreMigrationSourceDTO, 'sourceHash'>> = {}): CoreMigrationSourceDTO {
  const baseline = source()
  return source({
    ...baseline,
    entities: {
      ...baseline.entities,
      projects: [{
        legacyId: 'project-old-1',
        name: '完整关系项目',
        amount: '100.00',
        references: { customerId: 'customer-old-1' },
      }],
      project_suppliers: [{
        legacyId: 'project-supplier-old-1',
        name: '项目分供方关系',
        references: { projectId: 'project-old-1', supplierId: 'supplier-old-1' },
      }],
    },
    expectations: {
      counts: { projects: 1, project_suppliers: 1 },
      totals: [
        { entityType: 'projects', metric: 'amount', expected: '100.00' },
        { entityType: 'workers', metric: 'quantity', expected: 3 },
      ],
    },
    ...overrides,
  })
}

function attestation(migrationSource: CoreMigrationSourceDTO): CoreMigrationBackupAttestationDTO {
  return {
    backupId: `core-migration-${migrationSource.sourceHash}-${'b'.repeat(64)}`,
    sourceHash: migrationSource.sourceHash,
    sourceVersion: migrationSource.sourceVersion,
    snapshotSha256: 'b'.repeat(64),
    byteLength: 4096,
    createdAt: '2026-08-15T07:59:00.000Z',
    immutable: true,
  }
}

function sourceCommand(
  commandId: string,
  migrationSource: CoreMigrationSourceDTO = source(),
  backup: CoreMigrationBackupAttestationDTO | null = null,
): CoreMigrationSourceCommandDTO {
  return {
    workspaceId: SESSION.workspaceId,
    actorId: SESSION.actorId,
    requiredCapability: CORE_MIGRATION_CAPABILITY,
    commandId,
    source: migrationSource,
    backup,
  }
}

async function dryRunWithAttestation(
  instance: ReturnType<typeof createCoreMigrationTestInstance>,
  commandPrefix: string,
  migrationSource = source(),
) {
  await instance.preflight(sourceCommand(`${commandPrefix}-preflight`, migrationSource), SESSION)
  return instance.dryRun(
    sourceCommand(`${commandPrefix}-dry-run`, migrationSource, attestation(migrationSource)),
    SESSION,
  )
}

function batchCommand(commandId: string, batchId: string): CoreMigrationBatchCommandDTO {
  return {
    workspaceId: SESSION.workspaceId,
    actorId: SESSION.actorId,
    requiredCapability: CORE_MIGRATION_CAPABILITY,
    commandId,
    batchId,
  }
}

describe('core migration test instance', () => {
  it('解析网络命令后保持来源哈希与字段顺序无关', async () => {
    const baseline = source()
    const migrationSource = source({
      ...baseline,
      entities: {
        ...baseline.entities,
        projects: [{
          legacyId: 'project-old-1',
          name: '完整关系项目',
          deletedAt: null,
          references: { customerId: 'customer-old-1', secondaryCustomerId: null },
          quantity: 125.5,
          amount: '8800.00',
        }],
      },
    })
    const parsed = parseCoreMigrationSourceCommand(
      JSON.parse(JSON.stringify(sourceCommand('network-order', migrationSource))),
    )

    expect(coreMigrationSourceHashInput(parsed.source))
      .toBe(coreMigrationSourceHashInput(migrationSource))
    await expect(createCoreMigrationTestInstance().preflight(parsed, SESSION))
      .resolves
      .toMatchObject({ sourceHash: migrationSource.sourceHash })
  })

  it('服务端重算来源哈希，预检仅接受未备份命令且 dry-run 必须先有同一来源预检', async () => {
    const instance = createCoreMigrationTestInstance()
    const migrationSource = source()
    const forged = { ...migrationSource, sourceHash: 'a'.repeat(64) }

    await expect(instance.preflight(sourceCommand('forged-hash', forged), SESSION))
      .rejects
      .toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(instance.preflight(
      sourceCommand('preflight-has-backup', migrationSource, attestation(migrationSource)),
      SESSION,
    )).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(instance.dryRun(
      sourceCommand('dry-run-before-preflight', migrationSource, attestation(migrationSource)),
      SESSION,
    )).rejects.toMatchObject({ problem: { code: 'conflict' } })
  })

  it('拒绝不匹配或非不可变的备份证明', async () => {
    const migrationSource = source()
    const valid = sourceCommand('strict-backup', migrationSource, attestation(migrationSource))
    expect(parseCoreMigrationSourceCommand(valid)).toEqual(valid)
    expect(() => parseCoreMigrationSourceCommand({
      ...valid,
      backup: { ...attestation(migrationSource), immutable: false },
    })).toThrowError(expect.objectContaining({ problem: expect.objectContaining({ code: 'validation-failed' }) }))
    expect(() => parseCoreMigrationSourceCommand({
      ...valid,
      backup: { ...attestation(migrationSource), byteLength: 1.5 },
    })).toThrowError(expect.objectContaining({ problem: expect.objectContaining({ code: 'validation-failed' }) }))

    const instance = createCoreMigrationTestInstance()
    await instance.preflight(sourceCommand('strict-backup-preflight', migrationSource), SESSION)
    await expect(instance.dryRun(sourceCommand('missing-backup', migrationSource), SESSION))
      .rejects
      .toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(instance.dryRun(sourceCommand('wrong-backup', migrationSource, {
      ...attestation(migrationSource),
      sourceHash: 'c'.repeat(64),
    }), SESSION)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await instance.dryRun(sourceCommand('stored-backup', migrationSource, attestation(migrationSource)), SESSION)
    await expect(instance.dryRun(sourceCommand('swapped-backup', migrationSource, {
      ...attestation(migrationSource),
      backupId: `core-migration-${migrationSource.sourceHash}-${'d'.repeat(64)}`,
      snapshotSha256: 'd'.repeat(64),
    }), SESSION)).rejects.toMatchObject({ problem: { code: 'conflict' } })
  })

  it('确认会拒绝阻塞问题，软删除记录本身不阻塞切换', async () => {
    const blockingSource = source({
      entities: {
        ...source().entities,
        projects: [{
          legacyId: 'project-old-1',
          name: '缺客户关系项目',
          amount: '100.00',
          references: { customerId: 'customer-name-only' },
        }],
      },
    })
    const instance = createCoreMigrationTestInstance()
    const blockingBatch = await dryRunWithAttestation(instance, 'blocking', blockingSource)
    await instance.importBatch(batchCommand('blocking-import', blockingBatch.batchId), SESSION)
    await expect(instance.confirm(batchCommand('blocking-confirm', blockingBatch.batchId), SESSION))
      .rejects
      .toMatchObject({ problem: { code: 'conflict' } })
    await instance.rollback(batchCommand('blocking-rollback', blockingBatch.batchId), SESSION)

    const cleanBaseline = cleanSource()
    const softDeletedSource = cleanSource({
      entities: {
        ...cleanBaseline.entities,
        suppliers: [{
          legacyId: 'supplier-old-1',
          name: '第一分供方',
          deletedAt: '2026-08-01T00:00:00.000Z',
        }],
      },
    })
    const softDeletedBatch = await dryRunWithAttestation(instance, 'soft-delete', softDeletedSource)
    await instance.importBatch(batchCommand('soft-delete-import', softDeletedBatch.batchId), SESSION)
    await expect(instance.confirm(batchCommand('soft-delete-confirm', softDeletedBatch.batchId), SESSION))
      .resolves
      .toMatchObject({ status: 'confirmed', authority: 'central' })
  })

  it('导入后按实际中央状态重新核对，不能只信任计划实体', async () => {
    const migrationSource = source({
      entities: {
        ...source().entities,
        suppliers: [{
          legacyId: 'supplier-old-1',
          name: '第一分供方',
          deletedAt: '2026-08-01T00:00:00.000Z',
        }],
      },
    })
    const instance = createCoreMigrationTestInstance({
      afterApply: (entities, batchId) => {
        const project = entities.find(entity => entity.entityType === 'projects' && entity.batchId === batchId)!
        project.amount = '98.00'
        project.references.customerId = 'missing-customer'
        const supplier = entities.find(entity => entity.entityType === 'suppliers' && entity.batchId === batchId)!
        supplier.deletedAt = null
        const projectSupplier = entities.find(entity => entity.entityType === 'project_suppliers' && entity.batchId === batchId)!
        projectSupplier.references.supplierId = 'missing-supplier'
        entities.push({ ...project, id: 'server:projects:unexpected', legacyId: 'unexpected-project' })
      },
    })
    const batch = await dryRunWithAttestation(instance, 'actual-reconcile', migrationSource)
    const imported = await instance.importBatch(batchCommand('actual-reconcile-import', batch.batchId), SESSION)
    expect(imported.issues.map(issue => issue.metricKey)).toEqual(expect.arrayContaining([
      'count',
      'amount',
      'missing-relation',
      'soft-delete',
      'orphan',
    ]))
    await expect(instance.confirm(batchCommand('actual-reconcile-confirm', batch.batchId), SESSION))
      .rejects
      .toMatchObject({ problem: { code: 'conflict' } })
  })

  it('预检版本/模式并按 canonical 拓扑 dry-run，不按名称猜关系', async () => {
    const instance = createCoreMigrationTestInstance({
      now: () => '2026-08-15T08:00:00.000Z',
      createServerId: ({ entityType, legacyId }) => `server:${entityType}:${legacyId}`,
    })

    await expect(instance.preflight(
      sourceCommand('preflight-invalid', source({ contractVersion: 'core-migration.v0' })),
      SESSION,
    )).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(instance.preflight(sourceCommand('preflight-1'), SESSION)).resolves.toMatchObject({
      eligible: true,
      contractVersion: CORE_MIGRATION_CONTRACT_VERSION,
      mode: CORE_MIGRATION_SOURCE_MODE,
      sourceHash: source().sourceHash,
    })

    const migrationSource = source()
    await instance.preflight(sourceCommand('preflight-dry-run-1', migrationSource), SESSION)
    const batch = await instance.dryRun(sourceCommand('dry-run-1', migrationSource, attestation(migrationSource)), SESSION)
    expect(batch.status).toBe('dry-run')
    expect(batch.steps.map(step => step.entityType)).toEqual(CORE_MIGRATION_TOPOLOGY)
    expect(batch.mappings).toContainEqual({
      entityType: 'customers',
      legacyId: 'customer-old-1',
      serverId: 'server:customers:customer-old-1',
    })
    expect(batch.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityType: 'projects',
        legacyId: 'project-old-2',
        field: 'customerId',
        metricKey: 'missing-relation',
        sourceValue: 'customer-name-only',
        commandId: 'dry-run-1',
      }),
      expect.objectContaining({
        entityType: 'project_suppliers',
        legacyId: 'project-supplier-orphan',
        field: 'supplierId',
        metricKey: 'orphan',
        sourceValue: 'supplier-name-only',
      }),
    ]))
    expect(instance.snapshot(SESSION)).toMatchObject({
      authority: 'local',
      entities: [],
    })
  })

  it('完整解码来源与批次信封，拒绝伪造身份、非有限数值和非法日期', async () => {
    const decodedSource = source()
    expect(parseCoreMigrationSourceCommand(sourceCommand('decode-1', decodedSource, attestation(decodedSource))))
      .toEqual(sourceCommand('decode-1', decodedSource, attestation(decodedSource)))
    expect(parseCoreMigrationBatchCommand({
      workspaceId: SESSION.workspaceId,
      actorId: SESSION.actorId,
      requiredCapability: CORE_MIGRATION_CAPABILITY,
      commandId: 'batch-1',
    }, 'core-batch-1')).toEqual(batchCommand('batch-1', 'core-batch-1'))

    const nonFinite = sourceCommand('decode-nan')
    Reflect.set(nonFinite.source.entities.projects[0], 'amount', Number.NaN)
    expect(() => parseCoreMigrationSourceCommand(nonFinite)).toThrowError(
      expect.objectContaining({ problem: expect.objectContaining({ code: 'validation-failed' }) }),
    )

    const invalidDate = sourceCommand('decode-date')
    invalidDate.source.entities.customers[0].deletedAt = '2026-02-30T00:00:00.000Z'
    expect(() => parseCoreMigrationSourceCommand(invalidDate)).toThrowError(
      expect.objectContaining({ problem: expect.objectContaining({ code: 'validation-failed' }) }),
    )

    const instance = createCoreMigrationTestInstance()
    await expect(instance.preflight({
      ...sourceCommand('forged-workspace'),
      workspaceId: 'forged-workspace',
    }, SESSION)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  })

  it('按 command、source 和 batch 幂等，导入显式映射并保留软删除与可定位对账', async () => {
    const instance = createCoreMigrationTestInstance({
      now: () => '2026-08-15T08:00:00.000Z',
      createServerId: ({ entityType, legacyId }) => `server:${entityType}:${legacyId}`,
    })
    const migrationSource = source({
      entities: {
        ...source().entities,
        suppliers: [{
          legacyId: 'supplier-old-1',
          name: '第一分供方',
          deletedAt: '2026-08-01T00:00:00.000Z',
        }],
      },
    })

    await instance.preflight(sourceCommand('preflight-idem', migrationSource), SESSION)
    const dryRun = await instance.dryRun(sourceCommand('dry-run-idem', migrationSource, attestation(migrationSource)), SESSION)
    const commandReplay = await instance.dryRun(sourceCommand('dry-run-idem', {
      ...migrationSource,
      contractVersion: 'forged-after-first-result',
    }), SESSION)
    const sourceReplay = await instance.dryRun(sourceCommand('dry-run-source-replay', migrationSource, attestation(migrationSource)), SESSION)
    expect(commandReplay).toEqual(dryRun)
    expect(sourceReplay.batchId).toBe(dryRun.batchId)
    expect(dryRun.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metricKey: 'soft-delete',
        entityType: 'suppliers',
        legacyId: 'supplier-old-1',
      }),
      expect.objectContaining({
        metricKey: 'count',
        entityType: 'project_suppliers',
        expectedValue: 2,
        actualValue: 1,
      }),
    ]))

    const imported = await instance.importBatch(batchCommand('import-idem', dryRun.batchId), SESSION)
    const commandReplayImport = await instance.importBatch(
      batchCommand('import-idem', 'missing-batch'),
      SESSION,
    )
    const batchReplayImport = await instance.importBatch(
      batchCommand('import-batch-replay', dryRun.batchId),
      SESSION,
    )
    expect(commandReplayImport).toEqual(imported)
    expect(batchReplayImport.status).toBe('applied')
    expect(instance.snapshot(SESSION).entities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityType: 'projects',
        legacyId: 'project-old-1',
        references: expect.objectContaining({ customerId: 'server:customers:customer-old-1' }),
      }),
      expect.objectContaining({
        entityType: 'suppliers',
        deletedAt: '2026-08-01T00:00:00.000Z',
      }),
    ]))
    expect(instance.snapshot(SESSION).entities).toHaveLength(7)
  })

  it('批次写入失败时原子不落盘且定位实体，重试成功后才缓存 command 结果', async () => {
    let failOnce = true
    const instance = createCoreMigrationTestInstance({
      now: () => '2026-08-15T08:00:00.000Z',
      beforeCommit: (entity) => {
        if (entity.entityType === 'projects' && failOnce) {
          failOnce = false
          throw new Error('simulated central write failure')
        }
      },
    })
    const dryRun = await dryRunWithAttestation(instance, 'atomic')
    const failed = await instance.importBatch(batchCommand('atomic-import', dryRun.batchId), SESSION)
    expect(failed).toMatchObject({ status: 'failed' })
    expect(failed.issues).toContainEqual(expect.objectContaining({
      metricKey: 'apply-failed',
      commandId: 'atomic-import',
      entityType: 'projects',
      legacyId: 'project-old-1',
      reason: 'simulated central write failure',
    }))
    expect(instance.snapshot(SESSION)).toEqual({
      authority: 'local',
      activeBatchId: null,
      entities: [],
    })
    const retried = await instance.importBatch(
      batchCommand('atomic-import', dryRun.batchId),
      SESSION,
    )
    expect(retried.status).toBe('applied')
    expect(retried.issues).not.toContainEqual(expect.objectContaining({ metricKey: 'apply-failed' }))
    await expect(instance.importBatch(
      batchCommand('atomic-import', 'forged-after-failure'),
      SESSION,
    )).resolves.toEqual(retried)
  })

  it('同一 workspace 不允许第二批次覆盖待确认的活动批次', async () => {
    const instance = createCoreMigrationTestInstance()
    const firstSource = cleanSource()
    const changedBaseline = cleanSource()
    const secondSource = cleanSource({
      entities: {
        ...changedBaseline.entities,
        customers: [{ legacyId: 'customer-old-1', name: '更名后客户' }],
      },
    })
    const first = await dryRunWithAttestation(instance, 'active-first', firstSource)
    const second = await dryRunWithAttestation(instance, 'active-second', secondSource)
    await instance.importBatch(batchCommand('active-first-import', first.batchId), SESSION)

    await expect(instance.importBatch(
      batchCommand('active-second-import', second.batchId),
      SESSION,
    )).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(instance.snapshot(SESSION).activeBatchId).toBe(first.batchId)
  })

  it('确认后切换中央权威，并只在服务端窗口内恢复导入前快照', async () => {
    let clock = '2026-08-15T08:00:00.000Z'
    const instance = createCoreMigrationTestInstance({
      now: () => clock,
      rollbackWindowMs: 60_000,
    })
    const dryRun = await dryRunWithAttestation(instance, 'lifecycle', cleanSource())
    const imported = await instance.importBatch(batchCommand('lifecycle-import', dryRun.batchId), SESSION)
    expect(imported.rollbackExpiresAt).toBeNull()

    clock = '2026-08-15T08:00:30.000Z'
    const confirmed = await instance.confirm(batchCommand('lifecycle-confirm', dryRun.batchId), SESSION)
    expect(confirmed).toMatchObject({ status: 'confirmed', authority: 'central' })
    expect(confirmed.rollbackExpiresAt).toBe('2026-08-15T08:01:30.000Z')
    expect(instance.snapshot(SESSION).authority).toBe('central')

    clock = '2026-08-15T08:01:00.000Z'
    const rolledBack = await instance.rollback(batchCommand('lifecycle-rollback', dryRun.batchId), SESSION)
    expect(rolledBack).toMatchObject({ status: 'rolled-back', authority: 'local' })
    expect(instance.snapshot(SESSION)).toEqual({
      authority: 'local',
      activeBatchId: null,
      entities: [],
    })

    clock = '2026-08-15T09:00:00.000Z'
    const expiredInstance = createCoreMigrationTestInstance({
      now: () => clock,
      rollbackWindowMs: 60_000,
    })
    const expiredDryRun = await dryRunWithAttestation(expiredInstance, 'expired', cleanSource())
    await expiredInstance.importBatch(batchCommand('expired-import', expiredDryRun.batchId), SESSION)
    await expiredInstance.confirm(batchCommand('expired-confirm', expiredDryRun.batchId), SESSION)
    clock = '2026-08-15T09:01:00.001Z'
    await expect(expiredInstance.rollback(
      batchCommand('expired-rollback', expiredDryRun.batchId),
      SESSION,
    )).rejects.toMatchObject({ problem: { code: 'conflict' } })
  })
})
