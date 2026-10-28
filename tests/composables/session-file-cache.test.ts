import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, effectScope } from 'vue'
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

  it('附带的会话数据随原文件存亡；读取可被 computed 追踪，原文件释放后依赖方不再拿到旧值', async () => {
    vi.useFakeTimers()
    const scope = effectScope()
    const cache = scope.run(() => useSessionFileCache<{ region: string }>(10_000))!
    const view = scope.run(() => computed(() => ({ file: cache.get('a')?.name, meta: cache.getMeta('a')?.region })))!
    expect(view.value).toEqual({ file: undefined, meta: undefined })
    expect(cache.setMeta('a', { region: '早于上传' })).toBe(false)

    cache.set('a', new File(['x'], '原件.png'))
    expect(view.value).toEqual({ file: '原件.png', meta: undefined })
    expect(cache.setMeta('a', { region: '首次识别' })).toBe(true)
    expect(view.value).toEqual({ file: '原件.png', meta: '首次识别' })

    // 重新放入同 id 的原文件（重新上传）不沿用旧区域
    cache.set('a', new File(['y'], '新原件.png'))
    expect(view.value).toEqual({ file: '新原件.png', meta: undefined })
    cache.setMeta('a', { region: '再次识别' })

    cache.sync([])
    await vi.advanceTimersByTimeAsync(9_999)
    expect(view.value.meta).toBe('再次识别')
    await vi.advanceTimersByTimeAsync(1)
    expect(view.value).toEqual({ file: undefined, meta: undefined })
    scope.stop()
  })
})
