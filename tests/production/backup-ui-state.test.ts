import type { ProductionBackupRun, ProductionBackupStatus } from '../../app/lib/production/backup-contract'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { createProductionBackupRepository, decodeBackupStatus } from '../../app/lib/production/backup-repository'
import { useProductionBackupStore } from '../../app/stores/production-backup'

const status: ProductionBackupStatus = { workspaceId: 'test-workspace', ownerId: 'test-owner', configured: true, protection: 'never', intervalHours: 12, latest: null, offline: null, baseline: null, running: false, recent: [], releaseState: 'awaiting-final-acceptance' }
afterEach(() => vi.unstubAllGlobals())

it('备份失响应后刷新重建界面仍使用原编号，成功回读后才清除', async () => {
  const values = new Map<string, string>()
  vi.stubGlobal('window', { sessionStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } })
  let result: ProductionBackupRun | null = null
  let requests = 0
  const repository = createProductionBackupRepository(async (_url, options) => {
    if (!options)
      return { ...status, ...(result ? { latest: result, recent: [result], protection: 'protected' } : {}) }
    requests++
    if (!result) {
      result = { commandId: options.body.commandId, action: 'backup', state: 'succeeded', startedAt: '2026-09-22T00:00:00.000Z', completedAt: '2026-09-22T00:00:01.000Z', capturedAt: '2026-09-22T00:00:00.000Z', packageId: 'backup-00000000-0000-0000-0000-000000000000', message: null }
      throw new Error('response lost')
    }
    expect(options.body.commandId).toBe(result.commandId)
    return result
  })
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { productionBackup: repository } }))
  setActivePinia(createPinia())
  const first = useProductionBackupStore()
  await first.refresh()
  await first.perform('backup')
  expect(first.pending?.commandId).toBe(result!.commandId)
  expect(first.problem).toContain('response lost')
  expect(values.size).toBe(1)
  setActivePinia(createPinia())
  const cold = useProductionBackupStore()
  await cold.refresh()
  await cold.perform('verify-restore')
  expect(requests).toBe(2)
  expect(cold.pending).toBeNull()
  expect(cold.lastResult?.state).toBe('succeeded')
  expect(values.size).toBe(0)
})

it('无法保存原键时不发送，坏成功响应不冒认完成', async () => {
  vi.stubGlobal('window', { sessionStorage: { getItem: () => null, setItem: () => {
    throw new Error('storage denied')
  } } })
  const execute = vi.fn()
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { productionBackup: { status: async () => status, execute } } }))
  setActivePinia(createPinia())
  const store = useProductionBackupStore()
  await store.refresh()
  await store.perform('backup')
  expect(execute).not.toHaveBeenCalled()
  expect(store.problem).toContain('无法可靠')
  expect(() => decodeBackupStatus({ ...status, latest: { state: 'succeeded' } })).toThrow('备份结果不完整，请保留原操作编号重新核对。')
})
