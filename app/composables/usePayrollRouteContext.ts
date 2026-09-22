import type { LocationQuery } from 'vue-router'
import { onActivated, onMounted, watch } from 'vue'

/** 同路径页签只在来源 query 改变时应用预筛，切回原来源保留页面输入。 */
export function usePayrollRouteContext(path: string, restore: (query: LocationQuery) => void | Promise<void>) {
  const route = useRoute()
  let appliedPath: string | undefined

  function restoreIfChanged() {
    if (route.path !== path || route.fullPath === appliedPath)
      return
    appliedPath = route.fullPath
    void restore(route.query)
  }

  onMounted(restoreIfChanged)
  onActivated(restoreIfChanged)
  watch(() => route.fullPath, restoreIfChanged)
}
