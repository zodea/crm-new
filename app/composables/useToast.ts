interface ToastAction {
  label: string
  onClick: () => void
}

interface Toast {
  id: number
  message: string
  type: 'success' | 'error' | 'warning' | 'info'
  duration: number
  /** 可选行内操作按钮（撤回场景用）；点击后 toast 关闭 */
  action?: ToastAction
}

const toasts = ref<Toast[]>([])
let nextId = 0

export function useToast() {
  function show(message: string, type: Toast['type'] = 'info', duration = 3000) {
    const id = nextId++
    toasts.value.push({ id, message, type, duration })
    if (duration > 0) {
      setTimeout(() => dismiss(id), duration)
    }
    return id
  }

  function dismiss(id: number) {
    const idx = toasts.value.findIndex(t => t.id === id)
    if (idx !== -1) toasts.value.splice(idx, 1)
  }

  /**
   * 撤回 toast（软删除的限时撤回窗口，见 CONTEXT.md「撤回」）。
   * ms 内点「撤回」执行 onUndo 并弹「已撤回」；超时自动消失、不执行任何回调。
   */
  function undo(message: string, onUndo: () => void, ms = 5000) {
    const id = nextId++
    let settled = false
    const run = () => {
      if (settled) return
      settled = true
      dismiss(id)
      onUndo()
      show('已撤回', 'success')
    }
    toasts.value.push({
      id,
      message,
      type: 'info',
      duration: ms,
      action: { label: '撤回', onClick: run },
    })
    if (ms > 0) {
      setTimeout(() => {
        settled = true
        dismiss(id)
      }, ms)
    }
    return id
  }

  return {
    toasts: readonly(toasts),
    show,
    success: (msg: string) => show(msg, 'success'),
    error: (msg: string) => show(msg, 'error'),
    warning: (msg: string) => show(msg, 'warning'),
    info: (msg: string) => show(msg, 'info'),
    undo,
    dismiss,
  }
}
