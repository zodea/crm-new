import type { ConfirmImpact, ConfirmVariant } from '~/lib/kit/confirm'
import type { FormModalOptions, FormValues } from '~/lib/kit/form-modal'

// KitUI 原语（Vue 版）——单宿主 + composable 调用，底座 shadcn-vue（ADR 0008）：
// confirm/formModal 走 reka-ui Dialog，toast 走 vue-sonner；语义对照 DC 设计稿 window.KitUI。
// 状态定义在模块级，任意页面 useKitUI() 拿到的都是同一份，由全局 <KitUIHost/> 渲染。

// ── Confirm（Promise 化确认弹窗，三档 simple/batch/cascade，ADR 0003 + 规格 §01）──
export interface ConfirmOptions {
  /** 变体，缺省 simple。simple=高后果轻量 / batch=批量删除 / cascade=删有下游关联的父级 */
  variant?: ConfirmVariant
  title?: string
  message: string
  /** batch：显示「将删除 N 条」 */
  count?: number
  /** cascade：杀伤清单（只读 count），如 [{label:'合同',n:3}] */
  impact?: ConfirmImpact[]
  /** cascade：需精确打入的记录自身名称（打字确认门控） */
  requireTyping?: string
  /** cascade：预提交挂起时长（ms），缺省 ≥3000；关联多可传更大 */
  holdMs?: number
  confirmLabel?: string
  cancelLabel?: string
}

interface ConfirmState {
  id: number
  resolve: (ok: boolean) => void
}

const confirmState = shallowRef<ConfirmState | null>(null)
const confirmOpts = shallowRef<ConfirmOptions | null>(null) // 关闭动画期间保留视图内容
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

const formModalState = shallowRef<FormModalState | null>(null)
const formModalOpts = shallowRef<FormModalOptions | null>(null)
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

// 注：ripple（蓝色水波动效）已全域废弃（见 ADR 0004），不提供该原语。

/**
 * KitUI 原语统一入口（语义对照 DC 设计稿 window.KitUI，底座 shadcn-vue，ADR 0008）。
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
    // 过程提示（右下重叠道）+ HeroUI 式 promise/loading
    loading: toast.loading,
    promise: toast.promise,
    updateToast: toast.update,
    dismissToast: toast.dismiss,
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
