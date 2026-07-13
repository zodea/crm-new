// Sonner 风格 toast（双泳道）——底座换为 vue-sonner，本文件仅是「保持既有签名」的薄封装。
// 计时器 / hover 暂停 / 堆叠 / promise / action 全部交给 vue-sonner 原生实现（少维护）。
// 双泳道用 vue-sonner 的多 Toaster 路由（toasterId）：
//   - system 道（右上，展开可读）：系统消息 / 需确认后的结果类。
//   - process 道（右下，折叠堆叠、hover 展开、新消息最上层）：上传/识别等过程提示。
// 公共 API（success/error/warning/info/show/loading/promise/undo/update/dismiss）签名不变，
// 页面与 useKitUI 无感。Toaster 宿主见 components/shared/ToastHost.vue。
import { toast as sonner } from 'vue-sonner'

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading' | 'default'
export type ToastLane = 'system' | 'process'

export const TOASTER_SYSTEM = 'system'
export const TOASTER_PROCESS = 'process'

type ToastId = string | number

interface ToastAction {
  label: string
  onClick: () => void
}

interface PushOptions {
  lane?: ToastLane
  type?: ToastType
  message: string
  description?: string
  duration?: number
  action?: ToastAction
}

// 记住每条 toast 落在哪个泳道，供 update/dismiss 定向到同一 Toaster
const laneById = new Map<ToastId, ToastLane>()

function toasterOf(lane: ToastLane) {
  return lane === 'process' ? TOASTER_PROCESS : TOASTER_SYSTEM
}

function emit(opts: PushOptions): ToastId {
  const lane = opts.lane ?? 'system'
  const type = opts.type ?? 'default'
  const common = {
    description: opts.description,
    duration: opts.duration,
    toasterId: toasterOf(lane),
    action: opts.action,
    // 关闭按钮只给 default 类型（undo）：品牌语义类型(success/error/warning/info/loading)
    // 已有图标/颜色/自动消失作反馈，不需要额外 ×
    closeButton: type === 'default',
    // 自动消失/手动关闭都清掉泳道记账，防 laneById 只增不减
    onDismiss: (t: { id: ToastId }) => laneById.delete(t.id),
    onAutoClose: (t: { id: ToastId }) => laneById.delete(t.id),
  }
  let id: ToastId
  switch (type) {
    case 'success':
      id = sonner.success(opts.message, common)
      break
    case 'error':
      id = sonner.error(opts.message, common)
      break
    case 'warning':
      id = sonner.warning(opts.message, common)
      break
    case 'info':
      id = sonner.info(opts.message, common)
      break
    case 'loading':
      id = sonner.loading(opts.message, { ...common, duration: opts.duration ?? Number.POSITIVE_INFINITY })
      break
    default:
      id = sonner(opts.message, common)
  }
  laneById.set(id, lane)
  return id
}

// —— 语义快捷方式（system 道）——
function show(message: string, type: ToastType = 'info', duration?: number) {
  return emit({ lane: 'system', type, message, duration })
}
const success = (msg: string, description?: string) => emit({ lane: 'system', type: 'success', message: msg, description })
const error = (msg: string, description?: string) => emit({ lane: 'system', type: 'error', message: msg, description })
const warning = (msg: string, description?: string) => emit({ lane: 'system', type: 'warning', message: msg, description })
const info = (msg: string, description?: string) => emit({ lane: 'system', type: 'info', message: msg, description })

// —— 过程提示（process 道，折叠堆叠）——
/** 加载态 toast（不自动关闭），返回 id，后续用 update/dismiss 收尾 */
function loading(message: string, opts?: { lane?: ToastLane, description?: string }) {
  return emit({ lane: opts?.lane ?? 'process', type: 'loading', message, description: opts?.description })
}

function processError(message: string, description?: string) {
  return emit({ lane: 'process', type: 'error', message, description })
}

/** HeroUI 式 promise toast：加载中 → 自动变成功/失败（vue-sonner 原生） */
function promise<T>(p: Promise<T>, opts: {
  loading: string
  success: string | ((v: T) => string)
  error: string | ((e: unknown) => string)
  lane?: ToastLane
}): Promise<T> {
  sonner.promise(p, {
    loading: opts.loading,
    success: (v: T) => (typeof opts.success === 'function' ? opts.success(v) : opts.success),
    error: (e: unknown) => (typeof opts.error === 'function' ? opts.error(e) : opts.error),
    toasterId: toasterOf(opts.lane ?? 'process'),
  })
  return p
}

/**
 * 原地更新一条 toast（进度提示：loading → loading %），或收尾（loading → success/error）。
 * 定向回原泳道对应的 Toaster；无 type 时按 loading 续显。
 *
 * ⚠ vue-sonner 的自动关闭定时器用 `remainingTime`，而它只在 onMounted 按当时 duration 设一次、
 * 之后不随 duration 同步（Toast.vue）。我们的 loading 以 Infinity 创建 → remainingTime 恒为
 * Infinity，即便 upsert 成有限时长的终态也不会自动关闭。故：
 *   - loading → loading：原地 upsert（同一 toast，进度平滑变化）；
 *   - loading → 终态：dismiss 旧的 + 新建终态 toast（全新挂载，定时器按新 duration 正常启动，
 *     并恢复 hover 暂停）。
 */
function update(id: ToastId, patch: { type?: ToastType, message?: string, description?: string, duration?: number }) {
  const lane = laneById.get(id) ?? 'process'
  const type = patch.type ?? 'loading'
  const msg = patch.message ?? ''

  // 进度更新：仍是 loading，原地 upsert
  if (type === 'loading') {
    sonner.loading(msg, {
      id,
      description: patch.description,
      toasterId: toasterOf(lane),
      duration: Number.POSITIVE_INFINITY,
      onDismiss: t => laneById.delete(t.id),
      onAutoClose: t => laneById.delete(t.id),
    })
    return
  }

  // 收尾：换成全新终态 toast，绕开 remainingTime 陈旧导致的「不自动关闭」
  sonner.dismiss(id)
  laneById.delete(id)
  emit({ lane, type, message: msg, description: patch.description, duration: patch.duration })
}

function dismiss(id: ToastId) {
  sonner.dismiss(id)
  laneById.delete(id)
}

/** 撤回 toast（软删除限时撤回，system 道；ADR 0003：窗口 10 秒） */
function undo(message: string, onUndo: () => void, ms = 10000): ToastId {
  const id = emit({
    lane: 'system',
    type: 'default',
    message,
    duration: ms,
    action: {
      label: '撤回',
      onClick: () => {
        // vue-sonner 的 action 点击直接删 toast、不回调 onDismiss，需手动清泳道记账
        laneById.delete(id)
        onUndo()
        success('已撤回')
      },
    },
  })
  return id
}

export function useToast() {
  return {
    show,
    success,
    error,
    warning,
    info,
    loading,
    processError,
    promise,
    undo,
    update,
    dismiss,
  }
}
