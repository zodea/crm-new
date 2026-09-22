import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { useSessionFileCache } from '~/composables/useSessionFileCache'

afterEach(() => vi.useRealTimers())

describe('会话原文件生命周期', () => {
  it('持续同步不延长已失活文件期限，恢复活动的文件继续保留', async () => {
    vi.useFakeTimers()
    const scope = effectScope()
    const released = vi.fn()
    const cache = scope.run(() => useSessionFileCache(10_000, released))!
    const file = new File(['test'], '原件.pdf')
    cache.set('expired', file)
    cache.set('restored', file)
    cache.sync([])
    await vi.advanceTimersByTimeAsync(5_000)
    cache.sync(['restored'])
    await vi.advanceTimersByTimeAsync(5_000)
    expect(cache.get('expired')).toBeUndefined()
    expect(cache.get('restored')).toBe(file)
    expect(released).toHaveBeenCalledExactlyOnceWith('expired')

    scope.stop()
    expect(cache.get('restored')).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('反复入池出池后归零，仅使用一个清理计时器', async () => {
    vi.useFakeTimers()
    const scope = effectScope()
    const released = vi.fn()
    const cache = scope.run(() => useSessionFileCache(10_000, released))!
    for (let index = 0; index < 20; index++) {
      cache.set(String(index), new File([new Uint8Array(1024 * 1024)], `${index}.pdf`))
      cache.sync([])
    }
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(released).toHaveBeenCalledTimes(20)
    for (let index = 0; index < 20; index++)
      expect(cache.get(String(index))).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
    scope.stop()
  })
})
