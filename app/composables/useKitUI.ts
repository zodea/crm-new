import type { ConfirmImpact, ConfirmVariant } from '~/lib/kit/confirm'
import type { FormModalOptions, FormValues } from '~/lib/kit/form-modal'
import { shallowRef } from 'vue'

// KitUI 原语（Vue 版）——单宿主 + composable 调用，底座 shadcn-vue（ADR 0008）：
// confirm/formModal/typeSelect 走 reka-ui Dialog，toast 走 vue-sonner；语义对照 DC 设计稿 window.KitUI。
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

export interface TypeSelectOption {
  value: string
  label: string
  hint?: string
}

export interface TypeSelectOptions {
  title: string
  options: readonly TypeSelectOption[]
  defaultValue?: string
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

// 具名导出：业务页面统一走 useKitUI()，此处导出供单宿主/测试直接驱动原语。
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  // #86 并发二次调用：旧 confirm 未落定就被覆写会让其 await 卡死；先以 false 落定旧 promise。
  const prev = confirmState.value
  if (prev) {
    confirmState.value = null
    prev.resolve(false)
  }
  confirmOpts.value = opts
  return new Promise<boolean>((resolve) => {
    confirmState.value = { id: confirmSeq++, resolve }
  })
}

function resolveConfirm(ok: boolean) {
  const s = confirmState.value
  if (!s)
    return
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
export function formModal(opts: FormModalOptions): Promise<FormValues | null> {
  // #86 并发二次调用：旧 formModal 未落定就被覆写会让其 await 卡死；先以 null 落定旧 promise。
  const prev = formModalState.value
  if (prev) {
    formModalState.value = null
    prev.resolve(null)
  }
  formModalOpts.value = opts
  return new Promise<FormValues | null>((resolve) => {
    formModalState.value = { id: formSeq++, resolve }
  })
}

function resolveFormModal(values: FormValues | null) {
  const s = formModalState.value
  if (!s)
    return
  formModalState.value = null
  s.resolve(values)
}

// ── TypeSelect（大单据三段式新建的业务类型首段）──
interface TypeSelectState {
  id: number
  resolve: (value: string | null) => void
}

const typeSelectState = shallowRef<TypeSelectState | null>(null)
const typeSelectOpts = shallowRef<TypeSelectOptions | null>(null)
let typeSelectSeq = 0

/** 打开业务类型选择弹窗；确定返回 option.value，所有安全退出路径返回 null。 */
export function typeSelect(opts: TypeSelectOptions): Promise<string | null> {
  const prev = typeSelectState.value
  if (prev) {
    typeSelectState.value = null
    prev.resolve(null)
  }
  typeSelectOpts.value = {
    ...opts,
    options: opts.options.map(option => ({ ...option })),
  }
  return new Promise<string | null>((resolve) => {
    typeSelectState.value = { id: typeSelectSeq++, resolve }
  })
}

function resolveTypeSelect(value: string | null) {
  const state = typeSelectState.value
  if (!state)
    return
  typeSelectState.value = null
  state.resolve(value)
}

// 注：ripple（蓝色水波动效）已全域废弃（见 ADR 0004），不提供该原语。

/**
 * KitUI 原语统一入口（语义对照 DC 设计稿 window.KitUI，底座 shadcn-vue，ADR 0008）。
 * toast 家族复用既有单宿主 useToast；confirm/formModal/typeSelect 走本模块状态。
 */
export function useKitUI() {
  const toast = useToast()
  const openExportTab = useExportWorkflowTab()
  const exportFile = useExportFile(openExportTab)
  const openImportTab = useImportMappingTab()
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
    undoToast: toast.undo,
    confirm,
    formModal,
    typeSelect,
    exportFile,
    openExportTab,
    openImportTab,
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
    typeSelectState,
    typeSelectOpts,
    resolveTypeSelect,
  }
}
