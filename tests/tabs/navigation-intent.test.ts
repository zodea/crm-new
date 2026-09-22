// @vitest-environment jsdom
import type { TabRestoreValidator } from '~/lib/tabs/restoration-contract'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useTabNavigation } from '~/composables/useTabNavigation'
import { tabSessionStorageKey } from '~/lib/tabs/session-persistence'
import { useTabSessionStore } from '~/stores/tab-session'
import { useTabsStore } from '~/stores/tabs'

const { validate } = vi.hoisted(() => ({ validate: vi.fn<TabRestoreValidator>() }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }))
vi.mock('~/lib/tabs/restore-target', async original => ({
  ...await original<typeof import('~/lib/tabs/restore-target')>(),
  createTabRestoreValidator: () => validate,
}))

const scope = { workspaceId: 'reopen-workspace', actorId: 'reopen-actor' }
const target = '/finance/payment/application-1/detail'
const list = '/finance/payment'

async function boot(initialPath = list, browserReload = false) {
  localStorage.setItem(tabSessionStorageKey(scope), JSON.stringify({
    schemaVersion: 1,
    scope,
    activeKey: list,
    tabs: [target, list].map((fullPath, index) => ({
      key: fullPath,
      fullPath,
      title: '旧记录名称',
      origin: fullPath === target ? 'real' : null,
      targetVersion: 1,
      sourceVersion: 'old-version',
      updatedAt: index + 1,
      closable: true,
    })),
  }))
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ['/', list, target, '/base/supplier'].map(path => ({ path, component: {} })),
  })
  await router.push(initialPath)
  const hooks: Array<() => Promise<void>> = []
  vi.stubGlobal('defineNuxtPlugin', (value: unknown) => value)
  vi.stubGlobal('useRouter', () => router)
  vi.stubGlobal('useTabSessionStore', useTabSessionStore)
  vi.stubGlobal('useDataVisibilityStore', () => ({ includeDemo: false }))
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue(browserReload ? [{ type: 'reload' } as PerformanceNavigationTiming] : [])
  const plugin = (await import('~/plugins/tab-session.client')).default as unknown as { setup: (app: unknown) => void }
  plugin.setup({
    $repositories: { projectCommands: { context: async () => ({ ...scope, capabilities: [] }) } },
    hook: (_name: string, callback: () => Promise<void>) => hooks.push(callback),
  })
  for (const hook of hooks)
    await hook()
  expect(useTabSessionStore().storageProblem).toBe('')
  expect(useTabSessionStore().diagnostics).toEqual([])
  return { router, session: useTabSessionStore(), tabs: useTabsStore(), ...useTabNavigation() }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  validate.mockReset()
  validate.mockImplementation(async tab => tab.fullPath === target
    ? { state: 'not-connected', message: '该详情的只读恢复尚未接入' }
    : { state: 'resolved', title: '当前可读页面', fullPath: tab.fullPath, sourceVersion: 'current' })
})
afterEach(() => {
  useTabSessionStore().dispose()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('普通业务导航与旧页签恢复意图', () => {
  it('旧详情尚未接入恢复，也能从有效业务列表主动重新打开', async () => {
    const { router, session } = await boot()
    await router.push(target)
    expect(router.currentRoute.value.fullPath).toBe(target)
    expect(validate.mock.calls.filter(([tab]) => tab.fullPath === target)).toHaveLength(0)
    expect(session.problems).toEqual([])
  })

  it('与旧页签同 key 的普通直接深链仍优先表达当前用户意图', async () => {
    const { router } = await boot(target)
    expect(router.currentRoute.value.fullPath).toBe(target)
    expect(validate.mock.calls.filter(([tab]) => tab.fullPath === target)).toHaveLength(0)
  })

  it('恢复失败后业务导航成功才撤掉旧问题与版本，随后切页签不再恢复旧身份', async () => {
    const { router, session, openStoredTab } = await boot()
    await openStoredTab(target)
    expect(router.currentRoute.value.fullPath).toBe(list)
    expect(session.problems).toMatchObject([{ key: target, state: 'not-connected' }])
    await router.push(target)
    expect(router.currentRoute.value.fullPath).toBe(target)
    expect(session.problems).toEqual([])
    expect(JSON.parse(localStorage.getItem(tabSessionStorageKey(scope))!).tabs.find((tab: { key: string }) => tab.key === target).sourceVersion).toBeNull()
    await router.push(list)
    await openStoredTab(target)
    expect(router.currentRoute.value.fullPath).toBe(target)
    expect(validate.mock.calls.filter(([tab]) => tab.fullPath === target)).toHaveLength(1)
  })

  it('无权旧页签连续点击仍重新核验，不因上次失败放行', async () => {
    const { router, session, openStoredTab } = await boot()
    validate.mockImplementation(async tab => tab.fullPath === target
      ? { state: 'forbidden', message: '当前没有查看权限' }
      : { state: 'resolved', title: '付款申请', fullPath: tab.fullPath, sourceVersion: null })
    await openStoredTab(target)
    await openStoredTab(target)
    expect(router.currentRoute.value.fullPath).toBe(list)
    expect(session.problems).toMatchObject([{ key: target, state: 'forbidden' }])
    expect(validate.mock.calls.filter(([tab]) => tab.fullPath === target)).toHaveLength(2)
  })

  it('业务导航被取消不能抹掉旧恢复问题或让下一次页签激活跳过校验', async () => {
    const { router, session, openStoredTab } = await boot()
    await openStoredTab(target)
    router.beforeResolve(to => to.fullPath !== target)
    await router.push(target)
    expect(router.currentRoute.value.fullPath).toBe(list)
    expect(session.problems).toMatchObject([{ key: target, state: 'not-connected' }])
    await openStoredTab(target)
    expect(validate.mock.calls.filter(([tab]) => tab.fullPath === target)).toHaveLength(2)
  })

  it('普通新导航使未完成的恢复失效，迟到结果不抢路由或重写旧事实', async () => {
    const { router, session, openStoredTab } = await boot()
    let finish!: (value: Awaited<ReturnType<TabRestoreValidator>>) => void
    validate.mockImplementation(() => new Promise(resolve => finish = resolve))
    const pending = openStoredTab(target)
    await vi.waitFor(() => expect(session.loadingKey).toBe(target))
    await router.push('/base/supplier')
    finish({ state: 'resolved', title: '迟到名称', fullPath: target, sourceVersion: 'late' })
    await pending
    expect(router.currentRoute.value.fullPath).toBe('/base/supplier')
    expect(session.loadingKey).toBeNull()
    expect(session.problems).toEqual([])
    expect(localStorage.getItem(tabSessionStorageKey(scope))).not.toContain('迟到名称')
  })

  it('关闭当前页后回到旧页签仍走恢复核验，未接入时回首页', async () => {
    const { router, session, tabs, openStoredTab } = await boot()
    expect(await tabs.requestClose(list)).toBe(true)
    await openStoredTab(tabs.activeFullPath)
    expect(router.currentRoute.value.fullPath).toBe('/')
    expect(session.problems).toMatchObject([{ key: target, state: 'not-connected' }])
    expect(validate.mock.calls.filter(([tab]) => tab.fullPath === target)).toHaveLength(1)
  })

  it('浏览器刷新同一详情仍保留自动恢复核验和安全回退', async () => {
    const { router, session } = await boot(target, true)
    expect(router.currentRoute.value.fullPath).toBe(list)
    expect(session.problems).toMatchObject([{ key: target, state: 'not-connected' }])
    expect(validate.mock.calls.filter(([tab]) => tab.fullPath === target)).toHaveLength(1)
  })
})
