import type { MaybeRefOrGetter } from 'vue'
import { deriveKey } from '~/lib/tabs/tab-machine'

/**
 * 详情页回填页签标题：把 store 里的记录名（如「合和新城」/「华东建材」）同步到当前页签，
 * 取代路由推导的通用名（「项目详情」）。空值忽略（记录未加载时保留默认名）。
 * 用法：`useTabTitle(() => project.value?.name)`
 */
export function useTabTitle(title: MaybeRefOrGetter<string | null | undefined>) {
  const route = useRoute()
  const tabsStore = useTabsStore()

  watch(
    () => toValue(title),
    (t) => {
      if (t)
        tabsStore.setTitle(deriveKey(route.fullPath), t)
    },
    { immediate: true },
  )
}
