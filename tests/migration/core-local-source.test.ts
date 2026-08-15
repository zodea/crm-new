import type { CoreMigrationLocalSourceDependencies } from '~/lib/migration/core-local-source'
import { describe, expect, it, vi } from 'vitest'
import { LATEST_VERSION } from '~/lib/db/migrations'
import {
  CORE_MIGRATION_CONTRACT_VERSION,
  CORE_MIGRATION_SOURCE_MODE,
  CORE_MIGRATION_SOURCE_VERSION,
  CORE_MIGRATION_TOPOLOGY,
} from '~/lib/migration/core-contract'
import { createCoreMigrationLocalSource } from '~/lib/migration/core-local-source'

function sourceRows(sql: string): Record<string, unknown>[] {
  if (sql.includes('FROM customers')) {
    return [
      { id: 'customer-local-1', name: '本地客户' },
      { id: 'customer_demo_001', name: '随包测试客户' },
    ]
  }
  if (sql.includes('FROM suppliers'))
    return [{ id: 'supplier-local-1', name: '本地分供方', deleted_at: null }]
  if (sql.includes('FROM crews'))
    return [{ id: 'crew-local-1', name: '本地班组', deleted_at: null }]
  if (sql.includes('FROM projects')) {
    return [{
      id: 'project-local-1',
      name: '本地项目',
      customer_id: 'customer-local-1',
      secondary_customer_id: null,
      area: 12.5,
      contract_amount: 100,
      deleted_at: null,
    }]
  }
  if (sql.includes('FROM workers')) {
    return [{
      id: 'worker-local-1',
      name: '本地工人',
      crew_id: 'crew-local-1',
      current_project_id: 'project-local-1',
      deleted_at: null,
    }]
  }
  if (sql.includes('FROM project_suppliers')) {
    return [{
      id: 'project-supplier-local-1',
      project_id: 'project-local-1',
      supplier_id: 'supplier-local-1',
      deleted_at: null,
    }]
  }
  throw new Error(`unexpected SQL: ${sql}`)
}

function dependencies(
  overrides: Partial<CoreMigrationLocalSourceDependencies> = {},
): CoreMigrationLocalSourceDependencies {
  return {
    isNative: () => false,
    isDemoActive: () => false,
    currentSchemaVersion: vi.fn().mockResolvedValue(LATEST_VERSION),
    select: vi.fn(async (sql: string) => sourceRows(sql)),
    closeDatabase: vi.fn().mockResolvedValue(undefined),
    loadProductionSnapshot: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    readSnapshotSource: vi.fn().mockRejectedValue(new Error('snapshot source not configured')),
    createBackup: vi.fn().mockResolvedValue({
      backupId: 'core-source-hash',
      createdAt: '2026-08-15T01:00:00.000Z',
      sourceSchemaVersion: LATEST_VERSION,
      sourceVersion: CORE_MIGRATION_SOURCE_VERSION,
      sourceHash: 'a'.repeat(64),
      snapshotSha256: 'b'.repeat(64),
      immutable: true,
      snapshotKey: 'production',
      byteLength: 3,
    }),
    loadBackup: vi.fn().mockResolvedValue(null),
    restoreBackup: vi.fn().mockResolvedValue(undefined),
    activateMigration: vi.fn().mockResolvedValue(undefined),
    clearMigration: vi.fn().mockResolvedValue(undefined),
    prepareMigration: vi.fn().mockResolvedValue(undefined),
    loadMigrationMarker: vi.fn().mockResolvedValue(null),
    loadPendingMigrationMarker: vi.fn().mockResolvedValue(null),
    now: () => '2026-08-15T01:00:00.000Z',
    ...overrides,
  }
}

describe('core migration local source', () => {
  it('与当前本地库最新 schema 版本保持同步', () => {
    expect(CORE_MIGRATION_SOURCE_VERSION).toBe(`sqlite-v${LATEST_VERSION}`)
  })

  it('构建确定性正式拓扑，不按与 demo 相同的 ID 猜测来源', async () => {
    const source = createCoreMigrationLocalSource(dependencies())

    const first = await source.readSource()
    const second = await source.readSource()

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      contractVersion: CORE_MIGRATION_CONTRACT_VERSION,
      mode: CORE_MIGRATION_SOURCE_MODE,
      sourceVersion: CORE_MIGRATION_SOURCE_VERSION,
      expectations: {
        counts: {
          customers: 2,
          suppliers: 1,
          crews: 1,
          projects: 1,
          workers: 1,
          project_suppliers: 1,
        },
        totals: [
          { entityType: 'projects', metric: 'quantity', expected: 12.5 },
          { entityType: 'projects', metric: 'amount', expected: '100.00' },
        ],
      },
    })
    expect(first.sourceHash).toMatch(/^[a-f0-9]{64}$/)
    expect(first.entities.customers).toEqual([
      { legacyId: 'customer-local-1', name: '本地客户', deletedAt: null },
      { legacyId: 'customer_demo_001', name: '随包测试客户', deletedAt: null },
    ])
    expect(first.entities.projects[0]).toEqual({
      legacyId: 'project-local-1',
      name: '本地项目',
      references: {
        customerId: 'customer-local-1',
        secondaryCustomerId: null,
      },
      quantity: 12.5,
      amount: '100.00',
      deletedAt: null,
    })
    expect(first.entities.project_suppliers[0]).toEqual({
      legacyId: 'project-supplier-local-1',
      name: 'project-local-1 × supplier-local-1',
      references: {
        projectId: 'project-local-1',
        supplierId: 'supplier-local-1',
      },
      deletedAt: null,
    })
    expect(Object.values(first.entities).flat().map(row => row.legacyId))
      .toContain('customer_demo_001')
  })

  it('遇到无法定位的正式行时显式阻断，不静默丢弃', async () => {
    const deps = dependencies({
      select: vi.fn(async (sql: string) => sql.includes('FROM customers')
        ? [{ id: '', name: '无法定位客户' }]
        : sourceRows(sql)),
    })
    const source = createCoreMigrationLocalSource(deps)

    await expect(source.readSource()).rejects.toMatchObject({
      code: 'unidentifiable-source-row',
    })
  })

  it('refuses to read the demo snapshot as a formal migration source', async () => {
    const deps = dependencies({ isDemoActive: () => true })
    const source = createCoreMigrationLocalSource(deps)

    await expect(source.readSource()).rejects.toMatchObject({
      code: 'demo-source-not-allowed',
    })
    expect(deps.select).not.toHaveBeenCalled()
  })

  it('tauri 桌面端不读取浏览器 IndexedDB 迁移源', async () => {
    const deps = dependencies({ isNative: () => true })
    const source = createCoreMigrationLocalSource(deps)

    await expect(source.readSource()).rejects.toMatchObject({ code: 'browser-only' })
    await expect(source.createBackup('a'.repeat(64))).rejects.toMatchObject({ code: 'browser-only' })
    expect(deps.select).not.toHaveBeenCalled()
    expect(deps.loadProductionSnapshot).not.toHaveBeenCalled()
  })

  it('flushes the production connection before creating an immutable backup', async () => {
    const events: string[] = []
    const protectedSource = await createCoreMigrationLocalSource(dependencies()).readSource()
    const deps = dependencies({
      closeDatabase: vi.fn(async () => {
        events.push('close')
      }),
      loadProductionSnapshot: vi.fn(async () => {
        events.push('snapshot')
        return new Uint8Array([1, 2, 3])
      }),
      readSnapshotSource: vi.fn(async () => {
        events.push('decode-snapshot')
        return protectedSource
      }),
      createBackup: vi.fn(async (input) => {
        events.push('backup')
        return {
          ...input,
          immutable: true as const,
          snapshotKey: 'production' as const,
          byteLength: input.snapshot.byteLength,
        }
      }),
    })
    const source = createCoreMigrationLocalSource(deps)

    const backup = await source.createBackup(protectedSource.sourceHash)

    expect(events).toEqual(['close', 'snapshot', 'decode-snapshot', 'backup'])
    expect(backup.backupId).toMatch(
      new RegExp(`^core-migration-${protectedSource.sourceHash}-[a-f0-9]{64}$`),
    )
    expect(deps.createBackup).toHaveBeenCalledWith({
      backupId: expect.stringMatching(
        new RegExp(`^core-migration-${protectedSource.sourceHash}-[a-f0-9]{64}$`),
      ),
      createdAt: '2026-08-15T01:00:00.000Z',
      sourceSchemaVersion: LATEST_VERSION,
      sourceVersion: CORE_MIGRATION_SOURCE_VERSION,
      sourceHash: protectedSource.sourceHash,
      snapshotSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      snapshot: new Uint8Array([1, 2, 3]),
    })
  })

  it('备份字节解析的来源与预检不同时拒绝绑定', async () => {
    const initial = await createCoreMigrationLocalSource(dependencies()).readSource()
    const changed = { ...initial, sourceHash: 'c'.repeat(64) }
    const deps = dependencies({
      readSnapshotSource: vi.fn().mockResolvedValue(changed),
    })
    const source = createCoreMigrationLocalSource(deps)

    await expect(source.createBackup(initial.sourceHash)).rejects.toMatchObject({
      code: 'source-changed-after-preflight',
    })
    expect(deps.createBackup).not.toHaveBeenCalled()
  })

  it('导入与确认前重新读取 production，来源变化时阻断旧批次', async () => {
    const initial = await createCoreMigrationLocalSource(dependencies()).readSource()
    const changed = { ...initial, sourceHash: 'c'.repeat(64) }
    const deps = dependencies({
      loadProductionSnapshot: vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6])),
      readSnapshotSource: vi.fn().mockResolvedValue(changed),
    })
    const source = createCoreMigrationLocalSource(deps)

    await expect(source.assertCurrentSource(initial.sourceHash, 'b'.repeat(64))).rejects.toMatchObject({
      code: 'source-changed-after-preflight',
    })
    expect(deps.closeDatabase).toHaveBeenCalledOnce()
  })

  it('locks the old source only after confirmation and restores the protected backup on rollback', async () => {
    const events: string[] = []
    const deps = dependencies({
      closeDatabase: vi.fn(async () => events.push('close')),
      loadBackup: vi.fn().mockResolvedValue({
        metadata: {
          backupId: 'core-source-hash',
          createdAt: '2026-08-15T01:00:00.000Z',
          sourceSchemaVersion: LATEST_VERSION,
          sourceVersion: CORE_MIGRATION_SOURCE_VERSION,
          sourceHash: 'a'.repeat(64),
          snapshotSha256: 'b'.repeat(64),
          immutable: true,
          snapshotKey: 'production',
          byteLength: 3,
        },
        snapshot: new Uint8Array([1, 2, 3]),
      }),
      readSnapshotSource: vi.fn().mockResolvedValue({
        contractVersion: CORE_MIGRATION_CONTRACT_VERSION,
        mode: CORE_MIGRATION_SOURCE_MODE,
        sourceVersion: CORE_MIGRATION_SOURCE_VERSION,
        sourceHash: 'a'.repeat(64),
        entities: Object.fromEntries(CORE_MIGRATION_TOPOLOGY.map(type => [type, []])),
      }),
      restoreBackup: vi.fn(async id => events.push(`restore:${id}`)),
      activateMigration: vi.fn(async marker => events.push(`activate:${marker.batchId}`)),
      clearMigration: vi.fn(async () => events.push('clear')),
      prepareMigration: vi.fn(async marker => events.push(`prepare:${marker.batchId}`)),
    })
    const source = createCoreMigrationLocalSource(deps)

    await source.confirmSwitch({
      batchId: 'batch-1',
      backupId: 'core-source-hash',
      sourceHash: 'a'.repeat(64),
      confirmedAt: '2026-08-15T01:00:00.000Z',
      rollbackExpiresAt: '2026-08-22T01:00:00.000Z',
    })
    await source.rollback('core-source-hash', 'a'.repeat(64))

    expect(events).toEqual([
      'close',
      'activate:batch-1',
      'close',
      'restore:core-source-hash',
      'clear',
    ])
  })

  it('queries every entity in the declared topology', async () => {
    const deps = dependencies()
    const source = createCoreMigrationLocalSource(deps)

    const result = await source.readSource()

    expect(Object.keys(result.entities)).toEqual([
      'customers',
      'suppliers',
      'crews',
      'projects',
      'workers',
      'project_suppliers',
    ])
  })
})
