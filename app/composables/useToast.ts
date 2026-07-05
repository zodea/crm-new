// Sonner 风格 toast 状态层（双泳道）。
// - system 道（expand）：系统消息 / 需确认后的结果类，展开可读，右上。
// - process 道（collapse）：上传/识别等过程提示，重叠堆叠省空间、hover 展开，右下。
// 兼容旧 API：success/error/warning/info/show/undo/dismiss 一律进 system 道。

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading' | 'default'
export type ToastLane = 'system' | 'process'

interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: number
  lane: ToastLane
  type: ToastType
  message: string
  description?: string
  /** ms；Infinity = 不自动关闭（loading 态） */
  duration: number
  action?: ToastAction
  /** 到期时间戳（0=不自动关闭）；hover 暂停用 */
  expiresAt: number
  /** hover 暂停时记录的剩余毫秒（内部） */
  remaining?: number
}

interface PushOptions {
  lane?: ToastLane
  type?: ToastType
  message: string
  description?: string
  duration?: number
  action?: ToastAction
}

const toasts = ref<Toast[]>([])
let nextId = 0
const timers = new Map<number, ReturnType<typeof setTimeout>>()
const pausedLanes = new Set<ToastLane>()

function clearTimer(id: number) {
  const h = timers.get(id)
  if (h) {
    clearTimeout(h)
    timers.delete(id)
  }
}

function arm(id: number, ms: number) {
  clearTimer(id)
  const t = toasts.value.find(x => x.id === id)
  if (!t) return
  // 泳道被 hover 暂停时：只记剩余时间，不启动倒计时（含 promise 解析后的续期）
  if (pausedLanes.has(t.lane)) {
    t.remaining = ms
    t.expiresAt = 0
    return
  }
  t.expiresAt = Date.now() + ms
  timers.set(id, setTimeout(() => dismiss(id), ms))
}

function dismiss(id: number) {
  clearTimer(id)
  const i = toasts.value.findIndex(t => t.id === id)
  if (i !== -1) toasts.value.splice(i, 1)
}

function push(opts: PushOptions): number {
  const id = nextId++
  const type = opts.type ?? 'default'
  const duration = opts.duration ?? (type === 'loading' ? Infinity : 3500)
  toasts.value.push({
    id,
    lane: opts.lane ?? 'system',
    type,
    message: opts.message,
    description: opts.description,
    action: opts.action,
    duration,
    expiresAt: 0,
  })
  if (Number.isFinite(duration) && duration > 0) arm(id, duration)
  return id
}

/** 原地更新一条 toast（promise 态迁移用：loading → success/error） */
function update(id: number, patch: Partial<Omit<Toast, 'id'>>) {
  const t = toasts.value.find(x => x.id === id)
  if (!t) return
  Object.assign(t, patch)
  const duration = patch.duration ?? t.duration
  t.duration = duration
  if (Number.isFinite(duration) && duration > 0) arm(id, duration)
  else clearTimer(id)
}

// —— 语义快捷方式（system 道）——
function show(message: string, type: ToastType = 'info', duration?: number) {
  return push({ lane: 'system', type, message, duration })
}
const success = (msg: string, description?: string) => push({ lane: 'system', type: 'success', message: msg, description })
const error = (msg: string, description?: string) => push({ lane: 'system', type: 'error', message: msg, description })
const warning = (msg: string, description?: string) => push({ lane: 'system', type: 'warning', message: msg, description })
const info = (msg: string, description?: string) => push({ lane: 'system', type: 'info', message: msg, description })

// —— 过程提示（process 道，重叠堆叠）——
/** 加载态 toast（不自动关闭），返回 id，后续用 update/dismiss 收尾 */
function loading(message: string, opts?: { lane?: ToastLane, description?: string }) {
  return push({ lane: opts?.lane ?? 'process', type: 'loading', message, description: opts?.description, duration: Infinity })
}

/** HeroUI 式 promise toast：加载中 → 自动变成功/失败 */
function promise<T>(p: Promise<T>, opts: {
  loading: string
  success: string | ((v: T) => string)
  error: string | ((e: unknown) => string)
  lane?: ToastLane
}): Promise<T> {
  const id = push({ lane: opts.lane ?? 'process', type: 'loading', message: opts.loading, duration: Infinity })
  p.then((v) => {
    update(id, { type: 'success', message: typeof opts.success === 'function' ? opts.success(v) : opts.success, duration: 3500 })
  }).catch((e) => {
    update(id, { type: 'error', message: typeof opts.error === 'function' ? opts.error(e) : opts.error, duration: 5000 })
  })
  return p
}

/** 撤回 toast（软删除限时撤回，system 道，见 CONTEXT.md「撤回」；ADR 0003：窗口 10 秒） */
function undo(message: string, onUndo: () => void, ms = 10000) {
  const id = nextId++
  let settled = false
  const run = () => {
    if (settled) return
    settled = true
    dismiss(id)
    onUndo()
    success('已撤回')
  }
  toasts.value.push({
    id,
    lane: 'system',
    type: 'info',
    message,
    duration: ms,
    action: { label: '撤回', onClick: run },
    expiresAt: 0,
  })
  if (ms > 0) arm(id, ms)
  return id
}

// —— hover 暂停/恢复计时（按泳道）——
function pauseLane(lane: ToastLane) {
  pausedLanes.add(lane)
  const now = Date.now()
  for (const t of toasts.value) {
    if (t.lane === lane && t.expiresAt) {
      clearTimer(t.id)
      t.remaining = Math.max(0, t.expiresAt - now)
      t.expiresAt = 0
    }
  }
}
function resumeLane(lane: ToastLane) {
  pausedLanes.delete(lane)
  for (const t of toasts.value) {
    if (t.lane === lane && t.remaining != null) {
      const ms = t.remaining
      t.remaining = undefined
      arm(t.id, ms)
    }
  }
}

export function useToast() {
  return {
    toasts: readonly(toasts),
    show,
    success,
    error,
    warning,
    info,
    loading,
    promise,
    undo,
    update,
    dismiss,
    pauseLane,
    resumeLane,
  }
}
