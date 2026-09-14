import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PayrollC2ConfigScreen from '~/components/payroll/PayrollC2ConfigScreen.vue'
import { c2Config } from '../helpers/payroll-c2-ui'

const load = vi.fn()
const save = vi.fn()
const pending = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  pending.mockReturnValue(null)
  load.mockResolvedValue({ ...c2Config(), draft: { crewId: 'c', unitRate: null, ruleText: null } })
  vi.stubGlobal('useRoute', () => ({ path: '/subcontract/payroll/config', fullPath: '/subcontract/payroll/config?origin=real&format=C2&project=p&leader=w', query: { origin: 'real', format: 'C2', project: 'p', leader: 'w' } }))
  vi.stubGlobal('useRouter', () => ({ push: vi.fn(), replace: vi.fn() }))
  vi.stubGlobal('usePayrollC2Store', () => ({ loadC2Config: load, saveC2Config: save, getC2Pending: pending }))
  vi.stubGlobal('useKitUI', () => ({ success: vi.fn(), confirm: vi.fn() }))
  vi.stubGlobal('useTabTitle', vi.fn())
  vi.stubGlobal('useEventListener', vi.fn())
  vi.stubGlobal('useTabsStore', () => ({ registerCloseGuard: () => () => {} }))
})
afterEach(() => vi.unstubAllGlobals())
const stubs = { EntityFormShell: { template: '<main><slot/><slot name="footer"/></main>' }, KitButton: { template: '<button><slot/></button>' }, SectionHeader: true, PayrollACommandState: true, PayrollSourceEvidence: true }
it('原缺单价不伪零、规则 null 不伪空；显式选择空规则后按原固定读提交', async () => {
  save.mockRejectedValue(new Error('验证失败'))
  const view = mount(PayrollC2ConfigScreen, { global: { stubs } })
  await flushPromises()
  expect((view.get('[aria-label="大工单价"]').element as HTMLInputElement).value).toBe('')
  expect(view.text()).toContain('原规则未记录')
  await view.get('[aria-label="大工单价"]').setValue('350')
  await view.findAll('button').find(button => button.text() === '明确保存空规则')!.trigger('click')
  await view.findAll('button').find(button => button.text() === '保存主体配置')!.trigger('click')
  await flushPromises()
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ scope: { projectId: 'p', leaderWorkerId: 'w' } }), { crewId: 'c', unitRate: 350, ruleText: '' })
  expect((view.get('[aria-label="大工单价"]').element as HTMLInputElement).value).toBe('350')
  view.unmount()
})
it('冷配置未决原键保原空规则与单价，禁用 lookup 仍明确显示原主体名称', async () => {
  pending.mockReturnValue({ state: 'unknown', command: { action: { kind: 'save-c2-config', config: { crewId: 'c', unitRate: 351, ruleText: '' } } } })
  const view = mount(PayrollC2ConfigScreen, { global: { stubs } })
  await flushPromises()
  expect((view.get('[aria-label="大工单价"]').element as HTMLInputElement).value).toBe('351')
  expect((view.get('[aria-label="大工单价"]').element as HTMLInputElement).disabled).toBe(true)
  expect(view.get('#section-scope').text()).toContain('真实项目')
  expect(view.get('#section-scope').text()).toContain('原工人')
  view.unmount()
})
