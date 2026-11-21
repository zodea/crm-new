import type { PayrollC1Command, PayrollC1ConfigRead } from '~/lib/payroll/central-c1-contract'
import { flushPromises, mount } from '@vue/test-utils'
import { useEventListener } from '@vueuse/core'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PayrollACommandState from '~/components/payroll/PayrollACommandState.vue'
import EntityFormShell from '~/components/ui/EntityFormShell.vue'
import PayrollC1ConfigScreen from '~/pages/subcontract/payroll/_components/PayrollC1ConfigScreen.vue'
import PayrollC1RateEditor from '~/pages/subcontract/payroll/_components/PayrollC1RateEditor.vue'
import { usePayrollC1Store } from '~/stores/payroll-c1'
import { c1Form, c1Frozen } from '../helpers/payroll-c1-ui'

const repo = { c1Config: vi.fn(), executeC1: vi.fn() }
const path = '/subcontract/payroll/config?origin=real&format=C1&project=p&month=2026-11&crew=c'
let config: PayrollC1ConfigRead
beforeEach(() => {
  sessionStorage.clear()
  vi.clearAllMocks()
  config = { context: c1Form().context, scope: { projectId: 'p', month: '2026-11', crewId: 'c' }, options: c1Form().options, rates: c1Frozen().rates, history: [], readonlyReasons: [] }
  repo.c1Config.mockImplementation(async () => structuredClone(config))
  repo.executeC1.mockImplementation(async (command: PayrollC1Command) => {
    if (command.action.kind !== 'save-c1-rates')
      throw new Error('不应提交其他动作')
    config = { ...config, context: { ...config.context, sourceVersion: 'v2' }, rates: config.rates.map(rate => ({ ...rate, configuredOvertimeRate: 54, overtimeRate: 54, overtimeRateSource: 'payroll-config' })) }
    if (repo.executeC1.mock.calls.length === 1)
      throw new Error('已保存，响应丢失')
    return { commandId: command.commandId, projectId: 'p', statementId: null, outcome: 'saved', sourceVersion: 'v2', rateRevisionIds: ['revision'], logIds: [] }
  })
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { payroll: repo } }))
  vi.stubGlobal('usePayrollC1Store', usePayrollC1Store)
  vi.stubGlobal('useRoute', () => ({ fullPath: path, query: { origin: 'real', format: 'C1', project: 'p', month: '2026-11', crew: 'c' } }))
  vi.stubGlobal('useRouter', () => ({ replace: vi.fn(), push: vi.fn() }))
  vi.stubGlobal('useTabTitle', vi.fn())
  vi.stubGlobal('useEventListener', useEventListener)
  vi.stubGlobal('useTabsStore', () => ({ registerCloseGuard: () => () => {} }))
  vi.stubGlobal('useKitUI', () => ({ success: vi.fn(), confirm: vi.fn().mockResolvedValue(false) }))
})
afterEach(() => vi.unstubAllGlobals())
function open() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = usePayrollC1Store()
  const view = mount(PayrollC1ConfigScreen, { global: { plugins: [pinia], components: { EntityFormShell, PayrollACommandState, PayrollC1RateEditor }, stubs: { KitButton: { template: '<button><slot /></button>' } } } })
  return { view, store }
}
it('冷实例重新打开同一配置，真实 store 保原编号及54/空日薪；读回成功才解除', async () => {
  const first = open()
  await flushPromises()
  await first.view.get('[aria-label="原工人加班价"]').setValue('54')
  await first.view.findAll('button').find(button => button.text() === '保存个人标准')!.trigger('click')
  await flushPromises()
  const original = first.store.getC1Pending(config)!
  expect(original.state).toBe('unknown')
  expect(original.command.action).toEqual({ kind: 'save-c1-rates', rates: [{ workerId: 'w', dailyWage: null, overtimeRate: 54 }] })
  first.view.unmount()

  const cold = open()
  await flushPromises()
  expect(cold.view.get('#section-scope').text()).toContain('真实项目')
  expect(cold.view.get('#section-scope').text()).toContain('原班组')
  expect((cold.view.get('[aria-label="原工人加班价"]').element as HTMLInputElement).value).toBe('54')
  expect((cold.view.get('[aria-label="原工人兜底日薪"]').element as HTMLInputElement).value).toBe('')
  expect(cold.store.getC1Pending(config)?.command).toEqual(original.command)
  await cold.view.findAll('button').find(button => button.text() === '核对原提交')!.trigger('click')
  await flushPromises()
  expect(repo.executeC1.mock.calls.map(([command]) => command)).toEqual([original.command, original.command])
  expect(cold.store.getC1Pending(config)).toBeNull()
  expect((cold.view.get('[aria-label="原工人兜底日薪"]').element as HTMLInputElement).value).toBe('')
  expect(cold.view.findAll('button').some(button => button.text() === '核对原提交')).toBe(false)
  cold.view.unmount()
})
