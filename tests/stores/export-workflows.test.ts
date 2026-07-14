import type { ConfiguredExportSource } from '~/lib/kit/export'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryHistory,
  createRouter,
  NavigationFailureType,
} from 'vue-router'
import { useExportWorkflowTab } from '~/composables/useExportWorkflowTab'
import { MAX_TABS } from '~/lib/tabs/tab-machine'
import { useExportWorkflowsStore } from '~/stores/export-workflows'
import { useTabsStore } from '~/stores/tabs'

vi.mock('~/lib/util/id', () => ({
  generateId: () => 'workflow-1',
}))

const source: ConfiguredExportSource = {
  label: '采购合同',
  fields: [
    { key: 'projectName', label: '项目' },
    { key: 'supplierName', label: '分供方' },
  ],
  files: [{
    row: {
      projectName: '滨江壹号',
      supplierName: '华东建材',
    },
    data: '合同正文',
    mimeType: 'text/plain',
  }],
}

describe('配置导出工作流上下文', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('按页签 id 注册并取回完整导出上下文', () => {
    const store = useExportWorkflowsStore()
    const options = {
      source,
      structure: {
        levels: [{ field: 'projectName' }, { field: 'supplierName' }],
      },
      naming: {
        parts: [{ field: 'supplierName' }],
        extension: 'txt',
      },
    }

    store.register('export-1', options)

    expect(store.get('export-1')).toEqual({
      id: 'export-1',
      ...options,
    })
  })

  it('移除指定上下文且保留其他导出任务', () => {
    const store = useExportWorkflowsStore()
    store.register('export-1', { source })
    store.register('export-2', { source })

    store.remove('export-1')

    expect(store.get('export-1')).toBeUndefined()
    expect(store.get('export-2')).toMatchObject({ id: 'export-2', source })
  })
})

describe('打开配置导出页签', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('先预占页签，再用仅含 id 的路由承接内存上下文', async () => {
    const push = vi.fn().mockResolvedValue(undefined)
    const warning = vi.fn()
    const tabsStore = useTabsStore()
    const workflowsStore = useExportWorkflowsStore()
    vi.stubGlobal('useRouter', () => ({ push }))
    vi.stubGlobal('useTabsStore', () => tabsStore)
    vi.stubGlobal('useExportWorkflowsStore', () => workflowsStore)
    vi.stubGlobal('useToast', () => ({ warning }))

    const openExportTab = useExportWorkflowTab()
    const result = await openExportTab({ source })

    expect(result).toEqual({
      status: 'opened',
      id: 'workflow-1',
      fullPath: '/export/config/workflow-1',
    })
    expect(tabsStore.tabs).toContainEqual({
      key: '/export/config/workflow-1',
      title: '导出配置',
      fullPath: '/export/config/workflow-1',
      closable: true,
    })
    expect(workflowsStore.get('workflow-1')).toEqual({ id: 'workflow-1', source })
    expect(push).toHaveBeenCalledWith('/export/config/workflow-1')
    expect(warning).not.toHaveBeenCalled()
  })

  it('达到页签上限时提示并且不注册、不导航', async () => {
    const push = vi.fn().mockResolvedValue(undefined)
    const warning = vi.fn()
    const tabsStore = useTabsStore()
    const workflowsStore = useExportWorkflowsStore()
    for (let index = 0; index < MAX_TABS; index++)
      tabsStore.open({ fullPath: `/occupied/${index}`, title: `占位 ${index}` })

    vi.stubGlobal('useRouter', () => ({ push }))
    vi.stubGlobal('useTabsStore', () => tabsStore)
    vi.stubGlobal('useExportWorkflowsStore', () => workflowsStore)
    vi.stubGlobal('useToast', () => ({ warning }))

    const openExportTab = useExportWorkflowTab()

    await expect(openExportTab({ source })).resolves.toEqual({ status: 'blocked' })
    expect(workflowsStore.get('workflow-1')).toBeUndefined()
    expect(push).not.toHaveBeenCalled()
    expect(warning).toHaveBeenCalledWith(
      `页签已达上限 ${MAX_TABS} 个`,
      '请先关闭不需要的页签',
    )
  })

  it('导航失败时回滚已注册上下文与预占页签', async () => {
    const navigationError = new Error('navigation failed')
    const push = vi.fn().mockRejectedValue(navigationError)
    const warning = vi.fn()
    const tabsStore = useTabsStore()
    const workflowsStore = useExportWorkflowsStore()
    vi.stubGlobal('useRouter', () => ({ push }))
    vi.stubGlobal('useTabsStore', () => tabsStore)
    vi.stubGlobal('useExportWorkflowsStore', () => workflowsStore)
    vi.stubGlobal('useToast', () => ({ warning }))

    const openExportTab = useExportWorkflowTab()

    await expect(openExportTab({ source })).rejects.toBe(navigationError)
    expect(workflowsStore.get('workflow-1')).toBeUndefined()
    expect(tabsStore.tabs).not.toContainEqual(expect.objectContaining({
      fullPath: '/export/config/workflow-1',
    }))
  })

  it('导航守卫中止时也回滚上下文与预占页签', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: {} },
        { path: '/export/config/:id', component: {} },
      ],
    })
    await router.push('/')
    await router.isReady()
    router.beforeEach(() => false)

    const warning = vi.fn()
    const tabsStore = useTabsStore()
    const workflowsStore = useExportWorkflowsStore()
    vi.stubGlobal('useRouter', () => router)
    vi.stubGlobal('useTabsStore', () => tabsStore)
    vi.stubGlobal('useExportWorkflowsStore', () => workflowsStore)
    vi.stubGlobal('useToast', () => ({ warning }))

    const openExportTab = useExportWorkflowTab()

    await expect(openExportTab({ source })).rejects.toMatchObject({
      type: NavigationFailureType.aborted,
    })
    expect(workflowsStore.get('workflow-1')).toBeUndefined()
    expect(tabsStore.tabs).not.toContainEqual(expect.objectContaining({
      fullPath: '/export/config/workflow-1',
    }))
  })
})
