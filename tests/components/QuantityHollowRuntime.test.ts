import { mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { computed, defineComponent, h } from 'vue'
import UnitRoute from '~/pages/subcontract/quantity/[pid]/[uid].vue'

afterEach(() => vi.unstubAllGlobals())

it.each(['new?origin=real&draftKey=original', 'form/record?origin=real', 'record?origin=real'])('%s 户深链挂载中央空鼓页面并由原页读取权限', (suffix) => {
  const read = vi.fn()
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('useDataVisibilityStore', () => ({ includeDemo: false }))
  const child = defineComponent({ setup() {
    read()
    return () => h('div', '中央空鼓子页面')
  } })
  const fullPath = `/subcontract/quantity/project/unit/hollow/${suffix}`
  vi.stubGlobal('useRoute', () => ({ path: fullPath.split('?')[0], fullPath, params: { pid: 'project', uid: 'unit' }, query: { origin: 'real' } }))
  const browser = mount(UnitRoute, { global: { stubs: { NuxtPage: child } } })
  expect(read).toHaveBeenCalledOnce()
  expect(browser.text()).toContain('中央空鼓子页面')
  browser.unmount()
})
