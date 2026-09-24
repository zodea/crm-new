import type { ScheduleProcessLibraryTask } from '~/lib/schedule/process-library'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadScheduleProcessLibraryTasks } from '~/lib/schedule/process-library'
import { useScheduleStore } from '~/stores/schedule'

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }))

vi.mock('~/lib/schedule/process-library', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/schedule/process-library')>()
  return {
    ...actual,
    loadScheduleProcessLibraryTasks: vi.fn(),
  }
})

function task(libraryId: string, name: string): ScheduleProcessLibraryTask {
  return {
    id: `${libraryId}-task`,
    libraryId,
    libraryVersion: 1,
    key: 'shared-key',
    name,
    durationDays: 3,
    trade: '',
    color: '#64748b',
    itemCodes: [],
    sortOrder: 10,
    predecessorKey: null,
    predecessorDisabled: false,
  }
}

describe('工序库快速切换', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(loadScheduleProcessLibraryTasks).mockReset()
  })

  it('a 后返回不会覆盖较新的 b 工序结果', async () => {
    let resolveA!: (tasks: ScheduleProcessLibraryTask[]) => void
    let resolveB!: (tasks: ScheduleProcessLibraryTask[]) => void
    vi.mocked(loadScheduleProcessLibraryTasks)
      .mockImplementationOnce(() => new Promise(resolve => resolveA = resolve))
      .mockImplementationOnce(() => new Promise(resolve => resolveB = resolve))

    const store = useScheduleStore()
    const requestA = store.loadProcessLibraryTasks('library-a')
    const requestB = store.loadProcessLibraryTasks('library-b')
    resolveB([task('library-b', 'B 工序')])
    await requestB
    resolveA([task('library-a', 'A 工序')])
    await requestA

    expect(store.processTasksLibraryId).toBe('library-b')
    expect(store.processTasks).toEqual([
      expect.objectContaining({ libraryId: 'library-b', name: 'B 工序' }),
    ])
  })
})
