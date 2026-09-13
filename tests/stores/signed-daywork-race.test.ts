import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSignedDayworkStore } from '~/stores/signed-daywork'

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }))

const mocks = vi.hoisted(() => ({ list: vi.fn(), options: vi.fn() }))
vi.mock('~/lib/db/connection', () => ({ getDb: vi.fn().mockResolvedValue({}), withTransaction: vi.fn() }))
vi.mock('~/lib/payroll/daywork', () => ({ listSignedDayworkRecords: mocks.list, saveSignedDayworkRecord: vi.fn() }))
vi.mock('~/lib/payroll/statements', async importOriginal => ({
  ...await importOriginal<typeof import('~/lib/payroll/statements')>(),
  loadPayrollWorkbenchOptions: mocks.options,
}))

beforeEach(() => {
  setActivePinia(createPinia())
  mocks.list.mockReset()
  mocks.options.mockReset().mockImplementation(async (_db, projectId) => ({ projects: [{ id: projectId }], crews: [], workers: [], c2SubjectConfigs: [] }))
})

describe('桌面签工读取范围与竞态', () => {
  it('同范围状态筛选保留记录与空快照，切换月份立即清空', async () => {
    const store = useSignedDayworkStore()
    store.filters.projectId = 'project-a'
    mocks.list.mockResolvedValueOnce([{ id: 'old' }])
    await store.load()
    let resolve!: (rows: unknown[]) => void
    mocks.list.mockImplementationOnce(() => new Promise(done => resolve = done))
    store.filters.status = ['confirmed']
    const pending = store.load()
    expect(store.records.map(item => item.id)).toEqual(['old'])
    expect(store.hasSnapshot).toBe(true)
    await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2))
    resolve([])
    await pending
    expect(store.records).toEqual([])
    expect(store.hasSnapshot).toBe(true)
    mocks.list.mockResolvedValue([])
    const emptyRefresh = store.load()
    expect(store.hasSnapshot).toBe(true)
    await emptyRefresh
    store.filters.month = '2026-01'
    const otherMonth = store.load()
    expect(store.hasSnapshot).toBe(false)
    await otherMonth
  })

  it('旧项目请求迟到不能覆写当前项目、记录与loading', async () => {
    const store = useSignedDayworkStore()
    let resolveOld!: (rows: unknown[]) => void
    mocks.list.mockImplementationOnce(() => new Promise(done => resolveOld = done)).mockResolvedValueOnce([{ id: 'new' }])
    store.filters.projectId = 'project-a'
    const old = store.load()
    await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1))
    store.filters.projectId = 'project-b'
    await store.load()
    resolveOld([{ id: 'old' }])
    await old
    expect(store.filters.projectId).toBe('project-b')
    expect(store.records.map(item => item.id)).toEqual(['new'])
    expect(store.loading).toBe(false)
  })
})
