import { computed, shallowRef } from 'vue'

/**
 * 原图上当前强调的识别字段：聚焦（或点击）字段输入框 / 变动清单条目后保持，悬停临时覆盖。
 * 重新识别比对保持最近聚焦的字段（窄屏切到“原件”面板时仍能看到）；首次识别点字段定位在失焦时 release，
 * 不常驻框。草稿或所选发票变化时 reset。
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
    /** 撤回某字段的保持（失焦）；已切到其他字段时不影响 */
    release(key: string) {
      if (locked.value === key)
        locked.value = null
    },
    reset() {
      locked.value = null
      hovered.value = null
    },
  }
}
