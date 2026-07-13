import type { MaybeRefOrGetter } from 'vue'
import { deriveKey } from '~/lib/tabs/tab-machine'

/**
 * 详情页回填页签标题：把 store 里的记录名（如「合和新城」/「华东建材」/「发票·00058761」）
 * 同步到当前页签，取代路由推导的通用名（「项目详情」）。空值忽略（记录未加载时保留默认名）。
 *
 * 同时依赖「页签是否已建」：页面 setup 先于 AppTabBar 的路由 watcher 执行时（如数据已在
 * store 里、title 一开始就有值），immediate setTitle 会早于 open() 落空——页签建好后由
 * tabs 依赖再触发一次回填，消除时序竞态。
 * 用法：`useTabTitle(() => project.value?.name)`
 */
export function useTabTitle(title: MaybeRefOrGetter<string | null | undefined>) {
  const route = useRoute()
  const tabsStore = useTabsStore()

  watch(
    [
      () => toValue(title),
      () => tabsStore.tabs.some(t => t.key === deriveKey(route.fullPath)),
    ],
    ([t, tabExists]) => {
      if (t && tabExists)
        tabsStore.setTitle(deriveKey(route.fullPath), t)
    },
    { immediate: true },
  )
}
