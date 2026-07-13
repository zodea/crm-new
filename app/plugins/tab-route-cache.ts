import { wrapTabRouteComponents } from '~/lib/tabs/page-cache'

/**
 * Vue KeepAlive 的 include 按组件名裁剪；参数路由却共享同一个页面组件。
 * 在 beforeResolve（异步页面已解析）阶段为每个 fullPath 换成稳定的命名 wrapper，
 * 让关闭/刷新只卸载目标页签，不影响同页面的其他参数实例。
 */
export default defineNuxtPlugin(() => {
  const router = useRouter()

  // Nuxt 内置 router 插件可能已完成首次导航；挂载前先包装当前已解析组件。
  wrapTabRouteComponents(router.currentRoute.value)
  router.beforeResolve(wrapTabRouteComponents)
})
