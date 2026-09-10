import type { DomainRepositories } from '~/plugins/repositories'
import { isTauri } from '@tauri-apps/api/core'
import { withTabRestoreDeadline } from '~/lib/tabs/restore-deadline'
import { createTabRestoreValidator } from '~/lib/tabs/restore-target'

export default defineNuxtPlugin({
  name: 'tab-session',
  dependsOn: ['nuxt:router', 'domain-repositories', 'data-visibility'],
  setup(app) {
    if (isTauri())
      return
    const router = useRouter()
    const session = useTabSessionStore()
    const visibility = useDataVisibilityStore()
    const repositories = app.$repositories as DomainRepositories
    // Nuxt router 先注册的 app:created 会 force 导航初始地址；恢复必须排在其后，
    // 并由 entry 在首次 mount 前等待完成。声明式 hooks 的注册顺序不满足此约束。
    app.hook('app:created', async () => {
      try {
        const context = await withTabRestoreDeadline(() => repositories.projectCommands.context())
        const initialPath = router.currentRoute.value.fullPath
        session.initialize({
          scope: { workspaceId: context.workspaceId, actorId: context.actorId },
          storage: window.localStorage,
          validate: createTabRestoreValidator({
            repositories,
            includeDemo: () => visibility.includeDemo,
            capabilities: () => context.capabilities,
          }),
        })
        router.beforeEach(async (to) => {
          const path = await session.beforeNavigation(to.fullPath)
          return path === null ? false : path === to.fullPath ? true : { path, replace: true }
        })
        const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
        const target = await session.startupPath(initialPath, navigation?.type === 'reload')
        if (target !== null && router.currentRoute.value.fullPath === initialPath && target !== initialPath)
          await router.replace(target)
        session.finishStartup(router.currentRoute.value.fullPath)
      }
      catch {
        session.dispose()
        session.unavailable()
      }
    })
  },
})
