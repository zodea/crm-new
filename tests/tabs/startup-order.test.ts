// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import tabSessionPlugin from '~/plugins/tab-session.client'

// 导入真实插件属于测试准备；不要把整个恢复依赖图的加载计入导航顺序断言的时限。
vi.hoisted(() => {
  vi.stubGlobal('defineNuxtPlugin', (value: unknown) => value)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('nuxt 初始导航与页签恢复顺序', () => {
  it('追加的恢复 hook 在初始 force 导航之后执行，且首次挂载之前已到目标', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: {} }, { path: '/project', component: {} }],
    })
    await router.push('/')
    const events: string[] = []
    const hooks: Array<() => Promise<void>> = [async () => {
      events.push('nuxt-initial-navigation')
      await router.replace({ path: '/', force: true })
    }]
    const session = {
      initialize: vi.fn(() => events.push('session-initialize')),
      cancel: vi.fn(),
      navigationSucceeded: vi.fn(),
      startupPath: vi.fn(async () => '/project'),
      finishStartup: vi.fn(() => events.push('session-ready')),
      dispose: vi.fn(),
      unavailable: vi.fn(),
    }
    vi.stubGlobal('useRouter', () => router)
    vi.stubGlobal('useTabSessionStore', () => session)
    vi.stubGlobal('useDataVisibilityStore', () => ({ includeDemo: false }))
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([])
    const app = {
      $repositories: { projectCommands: { context: async () => ({ workspaceId: 'w', actorId: 'a', capabilities: [] }) } },
      hook(name: string, callback: () => Promise<void>) {
        expect(name).toBe('app:created')
        hooks.push(callback)
      },
    }
    const plugin = tabSessionPlugin as unknown as { setup: (app: unknown) => void | Promise<void> }
    await plugin.setup(app)
    expect(session.initialize).not.toHaveBeenCalled()
    for (const hook of hooks)
      await hook()
    events.push('mount')
    expect(events).toEqual(['nuxt-initial-navigation', 'session-initialize', 'session-ready', 'mount'])
    expect(router.currentRoute.value.fullPath).toBe('/project')
    expect(session.finishStartup).toHaveBeenCalledWith('/project')
    expect(session.unavailable).not.toHaveBeenCalled()
  })
})
