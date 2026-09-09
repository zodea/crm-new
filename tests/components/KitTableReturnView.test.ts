import type { KitTableView } from '~/lib/kit/table-view'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, inject, nextTick, onMounted, useTemplateRef, watch } from 'vue'
import KitTable from '~/components/ui/KitTable.vue'
import { KIT_TABLE_VIEW_KEY } from '~/lib/kit/table-view'

const recalculate = vi.fn<() => Promise<void>>()
const scrollTo = vi.fn<() => Promise<void>>()
let tableView: KitTableView | null = null
const VxeTable = defineComponent({
  emits: ['init-rendered', 'data-rendered'],
  setup(_, { expose }) {
    tableView = inject(KIT_TABLE_VIEW_KEY, null)
    expose({ recalculate, scrollTo, getScroll: () => ({ scrollLeft: 47 }) })
    return () => null
  },
})

function renderTable(left?: number) {
  return mount(KitTable, { props: { columns: [], data: [], restoreScrollLeft: left }, global: { components: { 'vxe-table': VxeTable, 'vxe-column': true } } })
}

beforeEach(() => {
  for (const [key, value] of Object.entries({ computed, nextTick, onMounted, useTemplateRef, watch }))
    vi.stubGlobal(key, value)
  recalculate.mockReset().mockResolvedValue(undefined)
  scrollTo.mockReset().mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllGlobals())

describe('kitTable 来源视图恢复公共契约', () => {
  it.each(['init-rendered', 'data-rendered'] as const)('%s 后等待布局及滚动完成，才通知领域恢复焦点', async (event) => {
    let finishLayout!: () => void
    let finishScroll!: () => void
    recalculate.mockReturnValue(new Promise(resolve => finishLayout = resolve))
    scrollTo.mockReturnValue(new Promise(resolve => finishScroll = resolve))
    const view = renderTable(110)
    await flushPromises()
    expect(recalculate).not.toHaveBeenCalled()
    expect(tableView?.scrollLeft()).toBe(47)
    view.getComponent(VxeTable).vm.$emit(event)
    await flushPromises()
    expect(recalculate).toHaveBeenCalledWith(true)
    expect(scrollTo).not.toHaveBeenCalled()
    finishLayout()
    await flushPromises()
    expect(scrollTo).toHaveBeenCalledWith(110)
    expect(view.emitted('viewRestored')).toBeUndefined()
    finishScroll()
    await flushPromises()
    expect(view.emitted('viewRestored')).toHaveLength(1)
    view.unmount()
  })

  it.each([undefined, -1, Number.NaN, Number.POSITIVE_INFINITY])('忽略无效位置 %s', async (left) => {
    const view = renderTable(left)
    view.getComponent(VxeTable).vm.$emit('data-rendered')
    await flushPromises()
    expect(recalculate).not.toHaveBeenCalled()
    expect(scrollTo).not.toHaveBeenCalled()
    expect(view.emitted('viewRestored')).toBeUndefined()
    view.unmount()
  })

  it('布局等待期间来源失效，取消旧位置和焦点恢复', async () => {
    let finish!: () => void
    recalculate.mockReturnValue(new Promise(resolve => finish = resolve))
    const view = renderTable(110)
    view.getComponent(VxeTable).vm.$emit('data-rendered')
    await flushPromises()
    await view.setProps({ restoreScrollLeft: undefined })
    finish()
    await flushPromises()
    expect(scrollTo).not.toHaveBeenCalled()
    expect(view.emitted('viewRestored')).toBeUndefined()
    view.unmount()
  })
})
