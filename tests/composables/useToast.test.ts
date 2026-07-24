import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useToast } from '~/composables/useToast'

const sonner = vi.hoisted(() => {
  const toast = vi.fn(() => 'toast-default')
  return Object.assign(toast, {
    dismiss: vi.fn(),
    error: vi.fn(() => 'toast-error'),
    info: vi.fn(() => 'toast-info'),
    loading: vi.fn(() => 'toast-loading'),
    promise: vi.fn(),
    success: vi.fn(() => 'toast-success'),
    warning: vi.fn(() => 'toast-warning'),
  })
})

vi.mock('vue-sonner', () => ({ toast: sonner }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('undo toast', () => {
  it('等待异步撤回完成后才提示成功', async () => {
    let finish!: (restored: boolean) => void
    const restoring = new Promise<boolean>((resolve) => {
      finish = resolve
    })
    useToast().undo('已删除记录', () => restoring)
    const options = sonner.mock.calls[0]![1] as { action: { onClick: () => Promise<void> } }

    const action = options.action.onClick()
    expect(sonner.success).not.toHaveBeenCalled()
    finish(true)
    await action

    expect(sonner.success).toHaveBeenCalledWith('已撤回', expect.any(Object))
    expect(sonner.error).not.toHaveBeenCalled()
  })

  it('撤回返回 false 或抛错时显示失败而不是成功', async () => {
    useToast().undo('已删除记录', async () => false)
    let options = sonner.mock.calls[0]![1] as { action: { onClick: () => Promise<void> } }
    await options.action.onClick()
    expect(sonner.error).toHaveBeenCalledWith('撤回失败：记录已变化或不存在', expect.any(Object))
    expect(sonner.success).not.toHaveBeenCalled()

    vi.clearAllMocks()
    useToast().undo('已删除记录', async () => {
      throw new Error('数据库不可用')
    })
    options = sonner.mock.calls[0]![1] as { action: { onClick: () => Promise<void> } }
    await options.action.onClick()
    expect(sonner.error).toHaveBeenCalledWith('撤回失败：数据库不可用', expect.any(Object))
    expect(sonner.success).not.toHaveBeenCalled()
  })

  it('用户取消撤回时只提示内容保持不变', async () => {
    useToast().undo('已更新记录', async () => 'cancelled')
    const options = sonner.mock.calls[0]![1] as { action: { onClick: () => Promise<void> } }

    await options.action.onClick()

    expect(sonner.info).toHaveBeenCalledWith('已取消撤回，当前内容保持不变', expect.any(Object))
    expect(sonner.success).not.toHaveBeenCalled()
    expect(sonner.error).not.toHaveBeenCalled()
  })
})
