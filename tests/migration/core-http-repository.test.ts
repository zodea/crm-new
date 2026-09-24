import type {
  CoreMigrationBatchCommandDTO,
  CoreMigrationBatchDTO,
  CoreMigrationSourceCommandDTO,
  CoreMigrationSourceDTO,
} from '~/lib/migration/core-contract'
import { describe, expect, it, vi } from 'vitest'
import {
  CORE_MIGRATION_CAPABILITY,
  CORE_MIGRATION_CONTRACT_VERSION,
  CORE_MIGRATION_SOURCE_MODE,
  CORE_MIGRATION_SOURCE_VERSION,
  CORE_MIGRATION_TOPOLOGY,
} from '~/lib/migration/core-contract'
import {
  CoreMigrationHttpError,
  createHttpCoreMigrationRepository,
} from '~/lib/migration/core-http-repository'

const EMPTY_ENTITIES = Object.fromEntries(
  CORE_MIGRATION_TOPOLOGY.map(entityType => [entityType, []]),
) as CoreMigrationSourceDTO['entities']

const SOURCE: CoreMigrationSourceDTO = {
  contractVersion: CORE_MIGRATION_CONTRACT_VERSION,
  mode: CORE_MIGRATION_SOURCE_MODE,
  sourceVersion: CORE_MIGRATION_SOURCE_VERSION,
  sourceHash: 'a'.repeat(64),
  entities: EMPTY_ENTITIES,
}

const SOURCE_COMMAND: CoreMigrationSourceCommandDTO = {
  workspaceId: 'workspace-default',
  actorId: 'actor-default',
  requiredCapability: CORE_MIGRATION_CAPABILITY,
  commandId: 'command-preflight',
  source: SOURCE,
  backup: null,
}

const BATCH_COMMAND: CoreMigrationBatchCommandDTO = {
  workspaceId: 'workspace-default',
  actorId: 'actor-default',
  requiredCapability: CORE_MIGRATION_CAPABILITY,
  commandId: 'command-batch',
  batchId: 'batch-1',
}

const BATCH: CoreMigrationBatchDTO = {
  batchId: 'batch-1',
  sourceVersion: CORE_MIGRATION_SOURCE_VERSION,
  sourceHash: 'a'.repeat(64),
  status: 'dry-run',
  authority: 'local',
  steps: [{
    entityType: 'customers',
    sourceCount: 1,
    importableCount: 1,
    skippedCount: 0,
  }],
  mappings: [{ entityType: 'customers', legacyId: 'legacy-1', serverId: 'server-1' }],
  sourceRefs: [{
    batchId: 'batch-1',
    sourceHash: 'a'.repeat(64),
    entityType: 'customers',
    legacyId: 'legacy-1',
    serverId: 'server-1',
  }],
  issues: [],
  createdAt: '2026-08-15T01:00:00.000Z',
  updatedAt: '2026-08-15T01:00:00.000Z',
  rollbackExpiresAt: null,
  confirmedAt: null,
  rolledBackAt: null,
}

describe('hTTP core migration repository', () => {
  it('uses the migration endpoints and strictly decodes every successful step', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url === '/api/read/business-session') {
        return {
          workspaceId: 'workspace-default',
          actorId: 'actor-default',
          capabilities: [CORE_MIGRATION_CAPABILITY],
        }
      }
      if (url.endsWith('/preflight')) {
        return {
          eligible: true,
          contractVersion: CORE_MIGRATION_CONTRACT_VERSION,
          mode: CORE_MIGRATION_SOURCE_MODE,
          sourceVersion: CORE_MIGRATION_SOURCE_VERSION,
          sourceHash: 'a'.repeat(64),
          entityCount: 0,
        }
      }
      if (url.endsWith('/snapshot')) {
        return { authority: 'central', activeBatchId: 'batch-1', entities: [] }
      }
      return BATCH
    })
    const repository = createHttpCoreMigrationRepository({ fetcher })

    await expect(repository.context()).resolves.toMatchObject({ workspaceId: 'workspace-default' })
    await expect(repository.preflight(SOURCE_COMMAND)).resolves.toMatchObject({ eligible: true })
    await expect(repository.dryRun(SOURCE_COMMAND)).resolves.toEqual(BATCH)
    await expect(repository.importBatch(BATCH_COMMAND)).resolves.toEqual(BATCH)
    await expect(repository.confirm(BATCH_COMMAND)).resolves.toEqual(BATCH)
    await expect(repository.rollback(BATCH_COMMAND)).resolves.toEqual(BATCH)
    await expect(repository.snapshot()).resolves.toEqual({
      authority: 'central',
      activeBatchId: 'batch-1',
      entities: [],
    })

    expect(fetcher.mock.calls).toEqual([
      ['/api/read/business-session'],
      ['/api/migrations/core/preflight', { method: 'POST', body: SOURCE_COMMAND }],
      ['/api/migrations/core/dry-run', { method: 'POST', body: SOURCE_COMMAND }],
      ['/api/migrations/core/batch-1/import', { method: 'POST', body: BATCH_COMMAND }],
      ['/api/migrations/core/batch-1/confirm', { method: 'POST', body: BATCH_COMMAND }],
      ['/api/migrations/core/batch-1/rollback', { method: 'POST', body: BATCH_COMMAND }],
      ['/api/migrations/core/snapshot'],
    ])
  })

  it('rejects malformed nested batch data instead of letting it enter Pinia state', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ...BATCH,
      mappings: [{ entityType: 'customers', legacyId: 'legacy-1', serverId: 42 }],
    })
    const repository = createHttpCoreMigrationRepository({ fetcher })

    await expect(repository.dryRun(SOURCE_COMMAND)).rejects.toBeInstanceOf(CoreMigrationHttpError)
    await expect(repository.dryRun(SOURCE_COMMAND)).rejects.toMatchObject({
      code: 'internal-error',
    })
  })

  it('decodes a server ProblemDTO without converting it into a false success', async () => {
    const fetcher = vi.fn().mockRejectedValue({
      response: {
        _data: {
          code: 'conflict',
          message: '迁移批次状态已变化',
          retryable: false,
          fieldErrors: {},
          traceId: 'migration-trace-1',
        },
      },
    })
    const repository = createHttpCoreMigrationRepository({ fetcher })

    await expect(repository.confirm(BATCH_COMMAND)).rejects.toMatchObject({
      code: 'conflict',
      message: '迁移批次状态已变化',
      retryable: false,
    })
  })

  it('拒绝伪造的非 canonical ProblemDTO code', async () => {
    const fetcher = vi.fn().mockRejectedValue({
      response: {
        _data: {
          code: 'migration-magic-failed',
          message: '伪造错误',
          retryable: false,
          fieldErrors: {},
          traceId: null,
        },
      },
    })
    const repository = createHttpCoreMigrationRepository({ fetcher })

    await expect(repository.confirm(BATCH_COMMAND)).rejects.toMatchObject({
      code: 'unavailable',
      retryable: true,
    })
  })
})
