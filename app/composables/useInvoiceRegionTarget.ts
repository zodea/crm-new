import { computed, shallowRef } from 'vue'

/**
 * 原图上当前强调的识别变动字段：聚焦（或点击）字段输入框 / 变动清单条目后保持，悬停临时覆盖；
 * 窄屏切到“原件”面板时仍能看到最近聚焦的字段。草稿结束时 reset。
 */
export function useInvoiceRegionTarget() {
  const locked = shallowRef<string | null>(null)
  const hovered = shallowRef<string | null>(null)
  const active = computed(() => hovered.value ?? locked.value)

  return {
    active,
    locate(key: string) {
      locked.value = key
    },
    preview(key: string | null) {
      hovered.value = key
    },
    reset() {
      locked.value = null
      hovered.value = null
    },
  }
}
