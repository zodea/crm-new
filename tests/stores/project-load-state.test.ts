import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProjectStore } from '~/stores/project'

const { selectMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
}))

vi.mock('~/lib/db/connection', () => ({
  execute: vi.fn(),
  select: (...args: unknown[]) => selectMock(...args),
}))

describe('project store load state', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    selectMock.mockReset()
  })

  it('exposes an accessible retryable error while preserving load lifecycle', async () => {
    selectMock.mockRejectedValueOnce(new Error('数据库暂时不可用'))
    const store = useProjectStore()

    const loading = store.load()
    expect(store.loading).toBe(true)
    await expect(loading).rejects.toThrow('数据库暂时不可用')

    expect(store.loading).toBe(false)
    expect(store.loaded).toBe(true)
    expect(store.error).toBe('项目加载失败：数据库暂时不可用')

    let resolveRetry!: (rows: unknown[]) => void
    selectMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRetry = resolve
    }))
    const retry = store.load()
    expect(store.loading).toBe(true)
    expect(store.error).toBe('')
    resolveRetry([])
    await retry

    expect(store.error).toBe('')
    expect(store.list).toEqual([])
  })

  it('keeps the latest request authoritative when loads finish out of order', async () => {
    let rejectFirst!: (cause: Error) => void
    let resolveSecond!: (rows: unknown[]) => void
    selectMock
      .mockImplementationOnce(() => new Promise((_, reject) => {
        rejectFirst = reject
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSecond = resolve
      }))

    const store = useProjectStore()
    const first = store.load()
    const second = store.load()

    resolveSecond([])
    await second
    expect(store.loading).toBe(false)
    expect(store.loaded).toBe(true)
    expect(store.error).toBe('')

    rejectFirst(new Error('过期请求失败'))
    await expect(first).rejects.toThrow('过期请求失败')
    expect(store.loading).toBe(false)
    expect(store.error).toBe('')
    expect(store.list).toEqual([])
  })
})
