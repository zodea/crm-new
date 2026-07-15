import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useTabsStore } from '~/stores/tabs'

describe('页签缓存失效', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('软刷新只更新当前页签缓存键并记录失效项', () => {
    const store = useTabsStore()
    store.open({ fullPath: '/project', title: '项目列表' })
    store.open({ fullPath: '/base/supplier', title: '分供方' })

    const projectKey = store.pageCacheKey('/project')
    const supplierKey = store.pageCacheKey('/base/supplier')

    store.refreshActive()

    expect(store.pageCacheKey('/project')).toBe(projectKey)
    expect(store.pageCacheKey('/base/supplier')).not.toBe(supplierKey)
    expect(store.invalidatedKeys).toEqual(['/base/supplier'])
  })

  it('关闭页签后重开得到全新缓存键', () => {
    const store = useTabsStore()
    store.open({ fullPath: '/project', title: '项目列表' })
    const before = store.pageCacheKey('/project')

    store.close('/project')
    expect(store.invalidatedKeys).toEqual(['/project'])

    store.open({ fullPath: '/project', title: '项目列表' })
    expect(store.pageCacheKey('/project')).not.toBe(before)
  })

  it('批量关闭会一次失效所有被移除页签', () => {
    const store = useTabsStore()
    store.open({ fullPath: '/project', title: '项目列表' })
    store.open({ fullPath: '/base/supplier', title: '分供方' })
    store.open({ fullPath: '/finance/ledger', title: '发票台账' })

    store.closeOther('/project')

    expect(store.invalidatedKeys).toEqual(['/base/supplier', '/finance/ledger'])
  })

  it('缓存边界完成卸载后可逐批确认失效项', () => {
    const store = useTabsStore()
    store.open({ fullPath: '/project', title: '项目列表' })
    store.refreshActive()
    store.open({ fullPath: '/base/supplier', title: '分供方' })
    store.refreshActive()

    expect(store.invalidatedKeys).toEqual(['/project', '/base/supplier'])
    store.acknowledgeInvalidations(['/project'])
    expect(store.invalidatedKeys).toEqual(['/base/supplier'])
  })
})

describe('动态标题保持（#98）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('切走→切回（KeepAlive 缓存组件不重建）：setTitle 回填的记录名不被路由 watcher 的静态标题打回', () => {
    const store = useTabsStore()
    // 打开详情页：AppTabBar 路由 watcher 用静态路由标题建签
    store.open({ fullPath: '/project/1', title: '项目详情' })
    // 页面 useTabTitle 回填记录名
    store.setTitle('/project/1', '合和新城')
    // 切走：KeepAlive 缓存详情页组件
    store.open({ fullPath: '/base/supplier', title: '分供方' })
    // 切回：路由 watcher 再次 open 静态标题；组件不重建、无人再 setTitle
    store.open({ fullPath: '/project/1', title: '项目详情' })

    expect(store.activeKey).toBe('/project/1')
    expect(store.tabs.find(t => t.key === '/project/1')!.title).toBe('合和新城')
  })

  it('预占页签：先建签再回填后缀，导航确认后的复用 open 不打回静态名', () => {
    const store = useTabsStore()
    // useExportWorkflowTab 在导航前预占页签
    store.open({ fullPath: '/export/config/exp1', title: '导出配置' })
    // 页面 setup 的 immediate setTitle 先于路由 watcher 执行
    store.setTitle('/export/config/exp1', '导出配置 · 分供方采购合同')
    // 导航确认后 AppTabBar 路由 watcher 复用 open
    store.open({ fullPath: '/export/config/exp1', title: '导出配置' })

    expect(store.tabs.find(t => t.key === '/export/config/exp1')!.title).toBe('导出配置 · 分供方采购合同')
  })
})
