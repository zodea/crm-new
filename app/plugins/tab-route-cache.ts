import type { Component } from 'vue'
import { getTabPageWrapper } from '~/lib/tabs/page-cache'
import { deriveKey } from '~/lib/tabs/tab-machine'

/**
 * Vue KeepAlive 的 include 按组件名裁剪；参数路由却共享同一个页面组件。
 * 在 beforeResolve（异步页面已解析）阶段为每个 fullPath 换成稳定的命名 wrapper，
 * 让关闭/刷新只卸载目标页签，不影响同页面的其他参数实例。
 */
export default defineNuxtPlugin(() => {
  const router = useRouter()

  router.beforeResolve((to) => {
    const tabKey = deriveKey(to.fullPath)
    for (const record of to.matched) {
      const component = record.components?.default
      if (!component)
        continue

      // 正常情况下 beforeResolve 已完成异步组件解析；保留保护分支避免误包 loader。
      if (typeof component === 'function' && !('displayName' in component))
        continue

      record.components!.default = getTabPageWrapper(component as Component, tabKey)
    }
  })
})
