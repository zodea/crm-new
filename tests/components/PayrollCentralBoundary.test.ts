import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AttendanceScreen from '~/pages/subcontract/_components/AttendanceScreen.vue'
import SignedDayworkScreen from '~/pages/subcontract/daywork/_components/SignedDayworkScreen.vue'
import PayrollDraftFormPage from '~/pages/subcontract/payroll/_components/PayrollDraftFormPage.vue'
import PayrollScreen from '~/pages/subcontract/payroll/_components/PayrollScreen.vue'
import PayrollStatementDetailScreen from '~/pages/subcontract/payroll/_components/PayrollStatementDetailScreen.vue'

const runtime = vi.hoisted(() => ({ native: false }))
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
describe('工资浏览器入口边界', () => {
  it.each(cases)('$central 通过对应中央入口，不启动旧本地读写或输出', ({ component, central, native }) => {
    const wrapper = mount(component, { global: { stubs: { [central]: { template: '<div data-central>工资资料已接管</div>' }, [native]: { template: '<div data-native />' } } } })
    expect(wrapper.find('[data-central]').exists()).toBe(true)
    expect(wrapper.find('[data-native]').exists()).toBe(false)
    expect(legacy).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
