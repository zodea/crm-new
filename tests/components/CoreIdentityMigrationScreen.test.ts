import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CoreIdentityMigrationScreen from '~/components/migration/CoreIdentityMigrationScreen.vue'

vi.mock('~/composables/useKitUI', async (importOriginal) => {
  const original = await importOriginal<typeof import('~/composables/useKitUI')>()
  return { ...original, useKitUI: () => ({ confirm: original.confirm }) }
})

const migrationStore = vi.hoisted(() => ({
  phase: 'idle',
  busy: false,
  preparationBlocked: false,
  source: null as any,
  preflightResult: null as any,
  backup: null as any,
  batch: null as any,
  centralSnapshot: null as any,
  activeMigration: null as any,
  lastError: null as Error | null,
  hydrate: vi.fn(async () => {}),
  preflight: vi.fn(async () => {}),
  createBackup: vi.fn(async () => {}),
  dryRun: vi.fn(async () => {}),
  importBatch: vi.fn(async () => {}),
  confirmSwitch: vi.fn(async () => {}),
  rollback: vi.fn(async () => {}),
}))

vi.mock('~/stores/core-migration', () => ({
  useCoreMigrationStore: () => migrationStore,
}))

function batch(overrides: Record<string, unknown> = {}) {
  return {
    batchId: 'batch-1',
    sourceHash: 'source-hash',
    status: 'dry-run',
    issues: [],
    rollbackExpiresAt: null,
    steps: [],
    ...overrides,
  }
}

describe('核心身份迁移整页流程', () => {
  beforeEach(() => {
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
      if (url === '/api/read/target-costs/import')
        return { context: { workspaceId: 'component-workspace', actorId: 'component-owner', capabilities: ['target-cost:read', 'target-cost:import'] }, sources: [] }
      throw new Error('此组件场景没有授权该领域读取')
    }))
    Object.assign(migrationStore, {
      phase: 'idle',
      busy: false,
      preparationBlocked: false,
      source: null,
      preflightResult: null,
      backup: null,
      batch: null,
      centralSnapshot: null,
      activeMigration: null,
      lastError: null,
    })
    for (const action of [
      migrationStore.hydrate,
      migrationStore.preflight,
      migrationStore.createBackup,
      migrationStore.dryRun,
      migrationStore.importBatch,
      migrationStore.confirmSwitch,
      migrationStore.rollback,
    ]) {
      action.mockClear()
    }
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('初次进入只恢复既有迁移状态，不静默启动迁移', async () => {
    render(CoreIdentityMigrationScreen, { global: { plugins: [createPinia()] } })

    expect(await screen.findByRole('heading', { name: '本地数据迁移' })).not.toBeNull()
    expect(screen.getByText(/旧项目别名尚未迁移/)).toBeTruthy()
    await waitFor(() => expect(migrationStore.hydrate).toHaveBeenCalledOnce())
    expect(migrationStore.preflight).not.toHaveBeenCalled()

    await fireEvent.click(screen.getByRole('button', { name: '运行预检' }))
    expect(migrationStore.preflight).toHaveBeenCalledOnce()
    expect((screen.getByRole('button', { name: '创建不可变备份' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '执行 dry-run' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('dry-run 显示缺关系问题但仍允许导入可导入记录', async () => {
    Object.assign(migrationStore, {
      phase: 'dry-run',
      source: { sourceVersion: 'sqlite-v40', sourceHash: 'source-hash' },
      preflightResult: { eligible: true, sourceVersion: 'sqlite-v40', sourceHash: 'source-hash' },
      backup: { backupId: 'backup-1', sourceSchemaVersion: 40, byteLength: 512 },
      batch: batch({
        issues: [{
          id: 'issue-1',
          commandId: 'command-dry-run',
          entityType: 'projects',
          legacyId: 'project-legacy',
          metricKey: 'missing-relation',
          reason: 'customerId 指向不存在的客户',
        }],
      }),
    })

    render(CoreIdentityMigrationScreen, { global: { plugins: [createPinia()] } })

    expect(await screen.findByText('customerId 指向不存在的客户')).not.toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '导入可导入记录' }))
    expect(migrationStore.importBatch).toHaveBeenCalledOnce()
    expect((screen.getByRole('button', { name: '确认切换中央后台' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('导入且对账通过后展示中央计数并允许确认切换', async () => {
    Object.assign(migrationStore, {
      phase: 'imported',
      source: { sourceVersion: 'sqlite-v40', sourceHash: 'source-hash' },
      preflightResult: { eligible: true, sourceVersion: 'sqlite-v40', sourceHash: 'source-hash' },
      backup: { backupId: 'backup-1', sourceSchemaVersion: 40, byteLength: 512 },
      batch: batch({ status: 'applied' }),
      centralSnapshot: {
        authority: 'local',
        activeBatchId: null,
        entities: [
          { entityType: 'customers', id: 'customer-server-1' },
          { entityType: 'projects', id: 'project-server-1' },
        ],
      },
    })

    render(CoreIdentityMigrationScreen, { global: { plugins: [createPinia()] } })

    expect(await screen.findByText('客户 1 条')).not.toBeNull()
    expect(screen.getByText('项目 1 条')).not.toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '确认切换中央后台' }))
    expect(migrationStore.confirmSwitch).toHaveBeenCalledOnce()
  })

  it('已保留的软删除只作对账证据，不阻塞后台确认', async () => {
    Object.assign(migrationStore, {
      phase: 'imported',
      source: { sourceVersion: 'sqlite-v40', sourceHash: 'source-hash' },
      preflightResult: { eligible: true, sourceVersion: 'sqlite-v40', sourceHash: 'source-hash' },
      backup: { backupId: 'backup-1' },
      batch: batch({
        status: 'applied',
        issues: [{
          id: 'soft-delete-1',
          entityType: 'suppliers',
          legacyId: 'supplier-1',
          commandId: 'dry-run-1',
          metricKey: 'soft-delete',
          reason: '软删除状态已保留',
        }],
      }),
    })

    render(CoreIdentityMigrationScreen, { global: { plugins: [createPinia()] } })

    await fireEvent.click(await screen.findByRole('button', { name: '确认切换中央后台' }))
    expect(migrationStore.confirmSwitch).toHaveBeenCalledOnce()
  })

  it('导入后仍有缺失关系时保持切换阻塞', async () => {
    Object.assign(migrationStore, {
      phase: 'imported',
      source: { sourceVersion: 'sqlite-v40', sourceHash: 'source-hash' },
      preflightResult: { eligible: true, sourceVersion: 'sqlite-v40', sourceHash: 'source-hash' },
      backup: { backupId: 'backup-1' },
      batch: batch({
        status: 'applied',
        issues: [{
          id: 'missing-relation-1',
          entityType: 'projects',
          legacyId: 'project-1',
          commandId: 'dry-run-1',
          metricKey: 'missing-relation',
          reason: '缺失客户关系',
        }],
      }),
    })

    render(CoreIdentityMigrationScreen, { global: { plugins: [createPinia()] } })

    expect((await screen.findByRole('button', { name: '确认切换中央后台' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('切换后展示回滚窗口并可恢复受保护快照', async () => {
    Object.assign(migrationStore, {
      phase: 'confirmed',
      source: { sourceVersion: 'sqlite-v40', sourceHash: 'source-hash' },
      preflightResult: { eligible: true, sourceVersion: 'sqlite-v40', sourceHash: 'source-hash' },
      backup: { backupId: 'backup-1', sourceSchemaVersion: 40, byteLength: 512 },
      batch: batch({
        status: 'confirmed',
        rollbackExpiresAt: '2026-08-16T08:00:00.000Z',
      }),
    })

    render(CoreIdentityMigrationScreen, { global: { plugins: [createPinia()] } })

    expect(await screen.findByText('2026-08-16T08:00:00.000Z')).not.toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '回滚到本地快照' }))
    expect(migrationStore.rollback).toHaveBeenCalledOnce()
  })

  it('刷新已确认批次时显示已核验摘要，不误报尚未对账', async () => {
    Object.assign(migrationStore, {
      phase: 'confirmed',
      batch: null,
      activeMigration: {
        batchId: 'batch-1',
        backupId: 'backup-1',
        sourceHash: 'source-hash',
        confirmedAt: '2026-08-15T08:00:00.000Z',
        rollbackExpiresAt: '2026-08-16T08:00:00.000Z',
      },
    })

    render(CoreIdentityMigrationScreen, { global: { plugins: [createPinia()] } })

    expect(await screen.findByText('中央切换前已完成对账')).not.toBeNull()
    expect(screen.queryByText('尚未执行迁移对账')).toBeNull()
  })

  it.each([false, true])('本地恢复失败优先显示待恢复状态并锁定新迁移，保留历史行=%s', async (withRows) => {
    Object.assign(migrationStore, {
      phase: 'rollback-pending',
      preparationBlocked: true,
      preflightResult: { eligible: true, sourceVersion: 'sqlite-v40', sourceHash: 'source-hash' },
      backup: { backupId: 'backup-1' },
      batch: batch({
        status: 'rolled-back',
        issues: withRows
          ? [{
              id: 'preserved-delete',
              entityType: 'suppliers',
              legacyId: 'supplier-1',
              metricKey: 'soft-delete',
              reason: '历史软删除已保留',
            }]
          : [],
      }),
      activeMigration: { rollbackExpiresAt: '2026-09-17T08:00:00.000Z' },
    })
    render(CoreIdentityMigrationScreen, { global: { plugins: [createPinia()] } })
    expect(await screen.findByText('中央已回滚，等待恢复本地快照')).not.toBeNull()
    expect(screen.queryByText('对账通过，未发现迁移差异')).toBeNull()
    expect(screen.queryByText('对账未通过')).toBeNull()
    expect(screen.getByText('历史对账已完成')).not.toBeNull()
    for (const name of ['运行预检', '创建不可变备份', '执行 dry-run', '导入可导入记录', '确认切换中央后台'])
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    if (withRows)
      expect(screen.getByText('历史软删除已保留')).not.toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '回滚到本地快照' }))
    expect(migrationStore.rollback).toHaveBeenCalledOnce()
  })
})
