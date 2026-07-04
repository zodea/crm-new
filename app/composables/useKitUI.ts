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

// 注：ripple（蓝色水波动效）暂缓——待补动态图后再实现，先不提供该原语。

/**
 * KitUI 原语统一入口（对照设计稿 window.KitUI）。
 * toast 家族复用既有单宿主 useToast；confirm/formModal 走本模块状态。
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
  }
}
