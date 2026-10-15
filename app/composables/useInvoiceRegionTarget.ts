import type { MaybeRefOrGetter } from 'vue'
import { computed, shallowRef, toValue, watch } from 'vue'

/**
 * 原图上当前强调的识别字段：聚焦（或点击）字段输入框 / 变动清单条目后保持，悬停临时覆盖。
 * 重新识别比对保持最近聚焦的字段；首次识别点字段定位在失焦时 release，不常驻框。
 * revealLast 由 false 转 true（窄屏切到“原件”面板）时恢复最近一次定位，期间的失焦不撤框；
 * 转回 false 时撤回保持，之后按新焦点更新。草稿或所选发票变化时 reset。
 */
export function useInvoiceRegionTarget(options: { revealLast?: MaybeRefOrGetter<boolean> } = {}) {
  const locked = shallowRef<string | null>(null)
  const last = shallowRef<string | null>(null)
  const hovered = shallowRef<string | null>(null)
  const active = computed(() => hovered.value ?? locked.value)

  watch(() => toValue(options.revealLast) ?? false, (reveal) => {
    locked.value = reveal ? last.value : null
  }, { flush: 'sync' })

  return {
    active,
    locate(key: string) {
      locked.value = key
      last.value = key
    },
    preview(key: string | null) {
      hovered.value = key
    },
    /** 撤回某字段的保持（失焦）；已切到其他字段时不影响。revealLast 期间的失焦由切面板引起（指针切换先换面板后失焦），保留。 */
    release(key: string) {
      if (locked.value === key && !toValue(options.revealLast))
        locked.value = null
    },
    reset() {
      locked.value = null
      last.value = null
      hovered.value = null
    },
  }
}
