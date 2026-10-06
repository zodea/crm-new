import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useImportMappingTab } from '~/composables/useImportMappingTab'
import { MAX_TABS } from '~/lib/tabs/tab-machine'
import { useTabsStore } from '~/stores/tabs'

describe('打开导入映射页签', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('已登记实体：预占页签并按实体键导航', async () => {
    const push = vi.fn().mockResolvedValue(undefined)
    const warning = vi.fn()
    const tabsStore = useTabsStore()
    vi.stubGlobal('useRouter', () => ({ push }))
    vi.stubGlobal('useTabsStore', () => tabsStore)
    vi.stubGlobal('useToast', () => ({ warning }))

    const openImportTab = useImportMappingTab()
    const result = await openImportTab({ entity: 'demo-supplier' })

    expect(result).toEqual({
      status: 'opened',
      fullPath: '/import/mapping/demo-supplier',
    })
    expect(tabsStore.tabs).toContainEqual({
      key: '/import/mapping/demo-supplier',
      title: '导入映射',
      fullPath: '/import/mapping/demo-supplier',
      closable: true,
    })
    expect(push).toHaveBeenCalledWith('/import/mapping/demo-supplier')
    expect(warning).not.toHaveBeenCalled()
  })

  it('未登记实体：直接报错，不预占页签', async () => {
    const push = vi.fn()
    const tabsStore = useTabsStore()
    vi.stubGlobal('useRouter', () => ({ push }))
    vi.stubGlobal('useTabsStore', () => tabsStore)
    vi.stubGlobal('useToast', () => ({ warning: vi.fn() }))

    const openImportTab = useImportMappingTab()

    await expect(openImportTab({ entity: 'unknown-entity' }))
      .rejects
      .toThrow('未登记的导入实体：unknown-entity')
    expect(tabsStore.tabs).toHaveLength(1)
    expect(push).not.toHaveBeenCalled()
  })

  it('页签达到上限时提示并阻断', async () => {
    const push = vi.fn()
    const warning = vi.fn()
    const tabsStore = useTabsStore()
    for (let index = 0; index < MAX_TABS; index++)
      tabsStore.open({ fullPath: `/occupied/${index}`, title: `占位 ${index}` })

    vi.stubGlobal('useRouter', () => ({ push }))
    vi.stubGlobal('useTabsStore', () => tabsStore)
    vi.stubGlobal('useToast', () => ({ warning }))

    const openImportTab = useImportMappingTab()

    await expect(openImportTab({ entity: 'demo-supplier' }))
      .resolves
      .toEqual({ status: 'blocked' })
    expect(push).not.toHaveBeenCalled()
    expect(warning).toHaveBeenCalledWith(
      `页签已达上限 ${MAX_TABS} 个`,
      '请先关闭不需要的页签',
    )
  })

  it('导航失败时回滚预占页签', async () => {
    const navigationError = new Error('navigation failed')
    const push = vi.fn().mockRejectedValue(navigationError)
    const tabsStore = useTabsStore()
    vi.stubGlobal('useRouter', () => ({ push }))
    vi.stubGlobal('useTabsStore', () => tabsStore)
    vi.stubGlobal('useToast', () => ({ warning: vi.fn() }))

    const openImportTab = useImportMappingTab()

    await expect(openImportTab({ entity: 'demo-supplier' })).rejects.toBe(navigationError)
    expect(tabsStore.tabs).not.toContainEqual(expect.objectContaining({
      fullPath: '/import/mapping/demo-supplier',
    }))
  })

  it('仅创建通用入口不加载导入领域，首次执行仍复用原登记与工作流结果', async () => {
    const push = vi.fn().mockResolvedValue(undefined)
    const tabsStore = useTabsStore()
    vi.stubGlobal('useRouter', () => ({ push }))
    vi.stubGlobal('useTabsStore', () => tabsStore)
    vi.stubGlobal('useToast', () => ({ warning: vi.fn() }))
    let loaded = 0
    let enter!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      enter = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.resetModules()
    vi.doMock('~/lib/kit/import-entities', async (original) => {
      loaded++
      enter()
      await gate
      return await original()
    })
    try {
      const { useImportMappingTab: createImportTab } = await import('~/composables/useImportMappingTab')
      const open = createImportTab()
      expect(loaded, '通用壳取得原语时不应求值所有导入领域').toBe(0)
      const options = { entity: 'demo-supplier' }
      const pending = open(options)
      await started
      options.entity = 'unknown-entity'
      release()
      await expect(pending).resolves.toEqual({ status: 'opened', fullPath: '/import/mapping/demo-supplier' })
      expect(loaded).toBe(1)
      expect(push).toHaveBeenCalledWith('/import/mapping/demo-supplier')
      const unknown = { entity: 'unknown-entity' }
      const rejected = open(unknown)
      unknown.entity = 'demo-supplier'
      await expect(rejected).rejects.toThrow('未登记的导入实体：unknown-entity')
      expect(loaded).toBe(1)
    }
    finally {
      release()
      vi.doUnmock('~/lib/kit/import-entities')
      vi.resetModules()
    }
  })
})
