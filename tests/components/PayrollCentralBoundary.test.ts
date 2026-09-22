import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AttendanceScreen from '~/components/payroll/AttendanceScreen.vue'
import PayrollDraftFormPage from '~/components/payroll/PayrollDraftFormPage.vue'
import PayrollScreen from '~/components/payroll/PayrollScreen.vue'
import PayrollStatementDetailScreen from '~/components/payroll/PayrollStatementDetailScreen.vue'
import SignedDayworkScreen from '~/components/payroll/SignedDayworkScreen.vue'
import PayrollSourcesPage from '~/pages/subcontract/payroll/sources.vue'

const runtime = vi.hoisted(() => ({ native: false }))
vi.mock('~/lib/platform/runtime', () => ({ isDesktopRuntime: () => runtime.native }))
const legacy = vi.fn(() => {
  throw new Error('浏览器不应初始化旧工资写工作台')
})
const cases = [
  { component: PayrollScreen, central: 'CentralPayrollScreen', native: 'NativePayrollScreen' },
  { component: PayrollStatementDetailScreen, central: 'CentralPayrollDetailScreen', native: 'NativePayrollStatementDetailScreen' },
  { component: PayrollDraftFormPage, central: 'CentralPayrollFormPage', native: 'NativePayrollDraftFormPage' },
  { component: AttendanceScreen, central: 'CentralAttendanceScreen', native: 'NativeAttendanceScreen' },
  { component: SignedDayworkScreen, central: 'CentralSignedDayworkScreen', native: 'NativeSignedDayworkScreen' },
]
beforeEach(() => {
  runtime.native = false
  vi.clearAllMocks()
  vi.stubGlobal('useRoute', () => ({ path: '/subcontract/payroll', fullPath: '/subcontract/payroll?origin=real', params: { id: 'statement-a' }, query: { origin: 'real' } }))
  for (const name of ['usePayrollStore', 'useAttendanceStore', 'useSignedDayworkStore', 'usePayrollStatementDetailStore'])
    vi.stubGlobal(name, legacy)
})
describe('工资浏览器与桌面入口边界', () => {
  it.each(cases)('$central 通过对应中央入口，不启动旧本地读写或输出', ({ component, central, native }) => {
    const wrapper = mount(component, { global: { stubs: { [central]: { template: '<div data-central>工资资料已接管</div>' }, [native]: { template: '<div data-native />' } } } })
    expect(wrapper.find('[data-central]').exists()).toBe(true)
    expect(wrapper.find('[data-native]').exists()).toBe(false)
    expect(legacy).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('桌面入口保留原适配，不伪装成中央运行验收', () => {
    runtime.native = true
    for (const { component, central, native } of cases) {
      const wrapper = mount(component, { global: { stubs: { [central]: { template: '<div data-central />' }, [native]: { template: '<div data-native />' } } } })
      expect(wrapper.find('[data-native]').exists()).toBe(true)
      expect(wrapper.find('[data-central]').exists()).toBe(false)
      wrapper.unmount()
    }
  })
  it('新的独立来源路由在桌面明确提示原工作台，不挂浏览器来源页', () => {
    runtime.native = true
    const wrapper = mount(PayrollSourcesPage, { global: { stubs: { CentralPayrollSourcesScreen: { template: '<div data-central />' }, NuxtLink: { template: '<a><slot /></a>' } } } })
    expect(wrapper.find('[data-payroll-native-sources]').exists()).toBe(true)
    expect(wrapper.find('[data-central]').exists()).toBe(false)
    expect(wrapper.text()).toContain('打开本地考勤')
    expect(legacy).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
