import type { FormModalOptions, FormValues } from '~/lib/kit/form-modal'

// KitUI 原语（Vue 版）——对照设计稿 window.KitUI，改为单宿主 + composable 调用。
// 状态定义在模块级，任意页面 useKitUI() 拿到的都是同一份，由全局 <KitUIHost/> 渲染。

// ── Confirm（Promise 化确认弹窗）──
export interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

interface ConfirmState {
  id: number
  resolve: (ok: boolean) => void
}

const confirmState = ref<ConfirmState | null>(null)
const confirmOpts = ref<ConfirmOptions | null>(null) // 关闭动画期间保留视图内容
let confirmSeq = 0

function confirm(opts: ConfirmOptions): Promise<boolean> {
  confirmOpts.value = opts
  return new Promise<boolean>((resolve) => {
    confirmState.value = { id: confirmSeq++, resolve }
  })
}

function resolveConfirm(ok: boolean) {
  const s = confirmState.value
  if (!s) return
  confirmState.value = null
  s.resolve(ok)
}

// ── FormModal（字段配置驱动 + 必填校验）──
interface FormModalState {
  id: number
  resolve: (values: FormValues | null) => void
}

const formModalState = ref<FormModalState | null>(null)
const formModalOpts = ref<FormModalOptions | null>(null)
let formSeq = 0

/** 打开表单弹窗；提交返回字段值对象，取消/关闭返回 null。 */
function formModal(opts: FormModalOptions): Promise<FormValues | null> {
  formModalOpts.value = opts
  return new Promise<FormValues | null>((resolve) => {
    formModalState.value = { id: formSeq++, resolve }
  })
}

function resolveFormModal(values: FormValues | null) {
  const s = formModalState.value
  if (!s) return
  formModalState.value = null
  s.resolve(values)
}

// ── Ripple（蓝色水波动效，prefers-reduced-motion 退化）──
export interface RippleItem {
  id: number
  x: number
  y: number
  reduced: boolean
}

const ripples = ref<RippleItem[]>([])
let rippleSeq = 0

/** 以锚点元素中心（或视口中心）为落点播放水波；reduce 偏好下退化为静态 ✓。 */
function ripple(anchor?: HTMLElement | { x: number, y: number } | null) {
  let x = typeof window !== 'undefined' ? window.innerWidth / 2 : 0
  let y = typeof window !== 'undefined' ? window.innerHeight / 2 : 0

  if (anchor && 'getBoundingClientRect' in anchor) {
    const r = anchor.getBoundingClientRect()
    if (r.width || r.height) {
      x = r.left + r.width / 2
      y = r.top + r.height / 2
    }
  }
  else if (anchor && 'x' in anchor) {
    x = anchor.x
    y = anchor.y
  }

  const reduced = typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  const id = rippleSeq++
  ripples.value.push({ id, x, y, reduced })
  const ttl = reduced ? 900 : 1400
  setTimeout(() => {
    const i = ripples.value.findIndex(r => r.id === id)
    if (i !== -1) ripples.value.splice(i, 1)
  }, ttl)
}

/**
 * KitUI 原语统一入口（对照设计稿 window.KitUI）。
 * toast 家族复用既有单宿主 useToast；confirm/formModal/ripple 走本模块状态。
 */
export function useKitUI() {
  const toast = useToast()
  return {
    toast: toast.show,
    success: toast.success,
    error: toast.error,
    warning: toast.warning,
    info: toast.info,
    undoToast: toast.undo,
    confirm,
    formModal,
    ripple,
  }
}

/** 供 <KitUIHost/> 消费的内部状态与解析函数，业务页面不直接使用。 */
export function useKitUIHostState() {
  return {
    confirmState,
    confirmOpts,
    resolveConfirm,
    formModalState,
    formModalOpts,
    resolveFormModal,
    ripples,
  }
}
