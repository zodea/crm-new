import type { EffectScope } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive, ref, toValue, watch } from 'vue'
import { useTabTitle } from '~/composables/useTabTitle'
import { useTabsStore } from '~/stores/tabs'

// useTabTitle 依赖 Nuxt 自动导入（vue 响应式 API + useRoute/useTabsStore），node 测试里
// 提供等价全局替身：route 是可变 reactive（模拟全局路由随导航变化），store 用真 Pinia。
const route = reactive({ fullPath: '/' })
vi.stubGlobal('watch', watch)
vi.stubGlobal('toValue', toValue)
vi.stubGlobal('useRoute', () => route)
vi.stubGlobal('useTabsStore', useTabsStore)

describe('useTabTitle：动态标题回填', () => {
  let scope: EffectScope

  beforeEach(() => {
    setActivePinia(createPinia())
    scope = effectScope()
    route.fullPath = '/'
  })

  afterEach(() => {
    scope.stop()
  })

  function tabTitle(key: string) {
    return useTabsStore().tabs.find(t => t.key === key)?.title
  }

  it('页签已建：setup 时 immediate 立即回填记录名', () => {
    const store = useTabsStore()
    route.fullPath = '/project/1'
    store.open({ fullPath: '/project/1', title: '项目详情' })

    scope.run(() => useTabTitle(() => '合和新城'))

    expect(tabTitle('/project/1')).toBe('合和新城')
  })

  it('页签后建（时序竞态）：tabs 依赖翻转后补一次回填', async () => {
    const store = useTabsStore()
    route.fullPath = '/project/1'
    // 页面 setup 先于 AppTabBar 路由 watcher：immediate 落空
    scope.run(() => useTabTitle(() => '合和新城'))
    expect(tabTitle('/project/1')).toBeUndefined()

    store.open({ fullPath: '/project/1', title: '项目详情' })
    await nextTick()

    expect(tabTitle('/project/1')).toBe('合和新城')
  })

  it('停用期间标题源变化：更新自己页签，不误标当前激活页签（#99）', async () => {
    const store = useTabsStore()
    route.fullPath = '/project/1'
    store.open({ fullPath: '/project/1', title: '项目详情' })
    const name = ref('合和新城')
    scope.run(() => useTabTitle(() => name.value))
    expect(tabTitle('/project/1')).toBe('合和新城')

    // 切走：KeepAlive 停用详情页组件，全局 route 指向新页签
    store.open({ fullPath: '/base/supplier', title: '分供方' })
    route.fullPath = '/base/supplier'
    await nextTick()

    // 停用期间记录改名（如在别的页签编辑），watcher 照常触发
    name.value = '合和新城（改）'
    await nextTick()

    expect(tabTitle('/base/supplier')).toBe('分供方') // 不被误标
    expect(tabTitle('/project/1')).toBe('合和新城（改）') // 自己的页签正确更新
  })

  it('空值忽略：记录未加载时保留静态标题', async () => {
    const store = useTabsStore()
    route.fullPath = '/project/1'
    store.open({ fullPath: '/project/1', title: '项目详情' })
    const name = ref<string | null>(null)
    scope.run(() => useTabTitle(() => name.value))

    expect(tabTitle('/project/1')).toBe('项目详情')

    name.value = '合和新城'
    await nextTick()
    expect(tabTitle('/project/1')).toBe('合和新城')
  })
})
