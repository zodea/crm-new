import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import {
  getTabPageWrapper,
  pruneTabPageWrappers,
  tabPageCacheName,
  unwrapTabPageComponent,
} from '~/lib/tabs/page-cache'

describe('页签页面缓存身份', () => {
  it('为每个页签生成稳定且互不相同的组件名', () => {
    expect(tabPageCacheName('/project/1')).toBe(tabPageCacheName('/project/1'))
    expect(tabPageCacheName('/project/1')).not.toBe(tabPageCacheName('/project/2'))
  })

  it('同一基础页面按页签复用 wrapper，不同页签相互隔离', () => {
    const base = defineComponent({ name: 'ProjectDetail' })
    const first = getTabPageWrapper(base, '/project/1')
    const same = getTabPageWrapper(base, '/project/1')
    const other = getTabPageWrapper(base, '/project/2')

    expect(first).toBe(same)
    expect(first).not.toBe(other)
    expect(first.name).toBe(tabPageCacheName('/project/1'))
    expect(unwrapTabPageComponent(first)).toBe(base)
  })

  it('关闭页签后同步释放 wrapper registry', () => {
    const base = defineComponent({ name: 'SupplierDetail' })
    const before = getTabPageWrapper(base, '/base/supplier/1')

    pruneTabPageWrappers([])

    expect(getTabPageWrapper(base, '/base/supplier/1')).not.toBe(before)
  })
})
