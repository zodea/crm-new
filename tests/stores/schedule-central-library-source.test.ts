import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useScheduleStore } from '~/stores/schedule'

const runtime = vi.hoisted(() => ({ demo: false, list: vi.fn(), detail: vi.fn(), select: vi.fn(), transaction: vi.fn() }))
vi.mock('~/stores/data-visibility', () => ({ useDataVisibilityStore: () => ({ get includeDemo() {
  return runtime.demo
} }) }))
vi.mock('~/lib/db/connection', () => ({ select: runtime.select, execute: vi.fn(), withTransaction: runtime.transaction }))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  runtime.demo = false
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { processLibraries: { list: runtime.list, detail: runtime.detail } } }))
})
afterEach(() => vi.unstubAllGlobals())

describe('浏览器 WBS 的工序库来源接管', () => {
  it('列表与模板都只读取当前来源中央库，失败不回退旧 SQLite', async () => {
    const store = useScheduleStore()
    runtime.list.mockResolvedValue({ libraries: [{ id: 'central', code: 'standard', version: 3 }] })
    runtime.detail.mockResolvedValue({ tasks: [{ id: 'task', key: 'a', libraryId: 'central' }] })
    await store.loadProcessLibraries()
    await store.loadProcessLibraryTasks('central')
    expect(runtime.list).toHaveBeenCalledWith('real')
    expect(runtime.detail).toHaveBeenCalledWith('central', 'real')
    expect(store.processTasksLibraryId).toBe('central')
    runtime.detail.mockRejectedValue(new Error('中央离线'))
    await expect(store.loadProcessLibraryTasks('other')).rejects.toThrow('中央离线')
    expect(store.processTasks).toEqual([])
    expect(store.processTasksLibraryId).toBe('')
    expect(runtime.select).not.toHaveBeenCalled()
  })

  it('来源切换后的迟到列表与模板不覆盖新来源', async () => {
    const store = useScheduleStore()
    let release!: (value: unknown) => void
    runtime.list.mockImplementationOnce(() => new Promise(resolve => release = resolve))
    const pending = store.loadProcessLibraries()
    runtime.demo = true
    store.setOrigin('demo')
    runtime.list.mockResolvedValue({ libraries: [{ id: 'demo' }] })
    await store.loadProcessLibraries()
    release({ libraries: [{ id: 'real' }] })
    await pending
    expect(store.processLibraries[0]?.id).toBe('demo')
    expect(runtime.list).toHaveBeenLastCalledWith('demo')
  })

  it('未读取项目写上下文时不能提交建组，也不写旧数据库', async () => {
    const store = useScheduleStore()
    runtime.list.mockResolvedValue({ libraries: [{ id: 'central', isDefault: true }] })
    runtime.detail.mockResolvedValue({ tasks: [{ key: 'a' }] })
    await expect(store.createGroup({ projectId: 'project', name: '新组', buildingIds: ['building'], processLibraryId: 'central', startDate: '2026-09-12', overlapMode: 'seq', tasks: [{ templateKey: 'a', durationDays: 1, enabled: true, anchorStart: null }] })).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(runtime.detail).not.toHaveBeenCalled()
    expect(runtime.transaction).not.toHaveBeenCalled()
    expect(runtime.select).not.toHaveBeenCalled()
  })
})
