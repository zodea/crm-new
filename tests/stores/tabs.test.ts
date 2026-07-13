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
