import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, NavigationFailureType } from 'vue-router'
import { useWorkflowTab } from '~/composables/useWorkflowTab'
import { MAX_TABS } from '~/lib/tabs/tab-machine'
import { useTabsStore } from '~/stores/tabs'

async function realRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: {} },
      { path: '/workflow/:id', component: {} },
      { path: '/other', component: {} },
    ],
  })
  await router.push('/')
  await router.isReady()
  return router
}

describe('预占式工作流页签（导出/导入共用）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubEnvironment(push = vi.fn().mockResolvedValue(undefined)) {
    const warning = vi.fn()
    const tabsStore = useTabsStore()
    vi.stubGlobal('useRouter', () => ({ push }))
    vi.stubGlobal('useTabsStore', () => tabsStore)
    vi.stubGlobal('useToast', () => ({ warning }))
    return { push, warning, tabsStore }
  }

  it('预占成功后按 onClaimed → 导航顺序执行', async () => {
    const { push, tabsStore } = stubEnvironment()
    const onClaimed = vi.fn(() => {
      expect(push).not.toHaveBeenCalled()
    })

    const open = useWorkflowTab()
    await expect(open({ fullPath: '/workflow/1', title: '工作流' }, { onClaimed }))
      .resolves
      .toEqual({ status: 'opened', fullPath: '/workflow/1' })

    expect(onClaimed).toHaveBeenCalledOnce()
    expect(tabsStore.tabs).toContainEqual(expect.objectContaining({ fullPath: '/workflow/1' }))
  })

  it('超限阻断：提示一次且不执行 onClaimed、不导航', async () => {
    const { push, warning, tabsStore } = stubEnvironment()
    for (let index = 0; index < MAX_TABS; index++)
      tabsStore.open({ fullPath: `/occupied/${index}`, title: `占位 ${index}` })
    const onClaimed = vi.fn()

    const open = useWorkflowTab()
    await expect(open({ fullPath: '/workflow/1', title: '工作流' }, { onClaimed }))
      .resolves
      .toEqual({ status: 'blocked' })

    expect(onClaimed).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    expect(warning).toHaveBeenCalledWith(
      `页签已达上限 ${MAX_TABS} 个`,
      '请先关闭不需要的页签',
    )
  })

  it('守卫中止（aborted）：回滚 onRollback 并关闭本次新建的页签', async () => {
    const router = await realRouter()
    router.beforeEach(() => false)
    const { tabsStore } = stubEnvironment()
    vi.stubGlobal('useRouter', () => router)
    const onRollback = vi.fn()

    const open = useWorkflowTab()
    await expect(open({ fullPath: '/workflow/1', title: '工作流' }, { onRollback }))
      .rejects
      .toMatchObject({ type: NavigationFailureType.aborted })

    expect(onRollback).toHaveBeenCalledOnce()
    expect(tabsStore.tabs).not.toContainEqual(expect.objectContaining({ fullPath: '/workflow/1' }))
  })

  it('导航被更新请求取代（cancelled）：页签已被接管，不回滚不报错', async () => {
    const router = await realRouter()
    let hijacked = false
    router.beforeEach(async (to) => {
      // 模拟用户在导航完成前又点了别处：并发发起新导航使当前导航 cancelled。
      if (to.path.startsWith('/workflow') && !hijacked) {
        hijacked = true
        router.push('/other')
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      return true
    })
    const { tabsStore } = stubEnvironment()
    vi.stubGlobal('useRouter', () => router)
    const onRollback = vi.fn()

    const open = useWorkflowTab()
    await expect(open({ fullPath: '/workflow/1', title: '工作流' }, { onRollback }))
      .resolves
      .toEqual({ status: 'opened', fullPath: '/workflow/1' })

    expect(onRollback).not.toHaveBeenCalled()
    expect(tabsStore.tabs).toContainEqual(expect.objectContaining({ fullPath: '/workflow/1' }))
  })

  it('复用已有页签时导航异常不误关他人页签', async () => {
    const { tabsStore } = stubEnvironment(vi.fn().mockRejectedValue(new Error('boom')))
    tabsStore.open({ fullPath: '/workflow/1', title: '工作流' })

    const open = useWorkflowTab()
    await expect(open({ fullPath: '/workflow/1', title: '工作流' })).rejects.toThrow('boom')

    expect(tabsStore.tabs).toContainEqual(expect.objectContaining({ fullPath: '/workflow/1' }))
  })
})
