import { afterEach, describe, expect, it, vi } from 'vitest'
import { withTabRestoreDeadline } from '~/lib/tabs/restore-deadline'

afterEach(() => vi.useRealTimers())

describe('恢复等待边界', () => {
  it('适配不响应时超时结束等待，迟到结果不能覆盖超时', async () => {
    vi.useFakeTimers()
    let finish!: (value: string) => void
    let signal!: AbortSignal
    const request = withTabRestoreDeadline((current) => {
      signal = current
      return new Promise<string>((resolve) => {
        finish = resolve
      })
    }, undefined, 10)
    const failure = expect(request).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(10)
    await failure
    expect(signal.aborted).toBe(true)
    finish('迟到记录')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('用户切页立即停止等待，预先取消不会发起读取', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const read = vi.fn(() => new Promise<string>(() => {}))
    const request = withTabRestoreDeadline(read, controller.signal)
    const failure = expect(request).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await failure
    expect(vi.getTimerCount()).toBe(0)
    await expect(withTabRestoreDeadline(read, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(read).toHaveBeenCalledOnce()
  })
})
