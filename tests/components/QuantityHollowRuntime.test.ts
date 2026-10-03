import { mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { computed, defineComponent, h } from 'vue'
import UnitRoute from '~/pages/subcontract/quantity/[pid]/[uid].vue'

const runtime = vi.hoisted(() => ({ native: true }))
vi.mock('~/lib/platform/runtime', () => ({ isDesktopRuntime: () => runtime.native }))
afterEach(() => vi.unstubAllGlobals())

it.each(['new?origin=real&draftKey=original', 'form/record?origin=real', 'record?origin=real'])('%s 桌面原户深链不挂载中央空鼓页面，浏览器仍由原页读取权限', (suffix) => {
  const read = vi.fn()
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('useDataVisibilityStore', () => ({ includeDemo: false }))
  const child = defineComponent({ setup() {
    read()
    return () => h('div', '中央空鼓子页面')
  } })
  const fullPath = `/subcontract/quantity/project/unit/hollow/${suffix}`
  vi.stubGlobal('useRoute', () => ({ path: fullPath.split('?')[0], fullPath, params: { pid: 'project', uid: 'unit' }, query: { origin: 'real' } }))
  runtime.native = true
  const native = mount(UnitRoute, { global: { stubs: { NuxtPage: child } } })
  expect(read).not.toHaveBeenCalled()
  expect(native.text()).toContain('桌面端尚未接入空鼓检查与整改')
  native.unmount()
  runtime.native = false
  const browser = mount(UnitRoute, { global: { stubs: { NuxtPage: child } } })
  expect(read).toHaveBeenCalledOnce()
  expect(browser.text()).toContain('中央空鼓子页面')
  browser.unmount()
})
