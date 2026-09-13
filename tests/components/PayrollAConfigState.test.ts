import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, reactive, shallowRef } from 'vue'
import { usePayrollAConfig } from '~/composables/usePayrollAConfig'
import { payrollUiConfig } from '../helpers/payroll-a-ui-fixture'

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }))
const route = reactive({ path: '/subcontract/payroll/config', fullPath: '/subcontract/payroll/config?origin=real&project=project&month=2026-09&crew=crew&leader=worker', query: { origin: 'real', project: 'project', month: '2026-09', crew: 'crew', leader: 'worker' } })
const load = vi.fn()
const saveSubject = vi.fn()
const savePrices = vi.fn()
let ui: ReturnType<typeof usePayrollAConfig>
const Harness = defineComponent({ setup() {
  ui = usePayrollAConfig()
  return () => h('p', ui.error.value)
} })
beforeEach(() => {
  vi.clearAllMocks()
  load.mockResolvedValue(payrollUiConfig())
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useRouter', () => ({ replace: vi.fn(), push: vi.fn() }))
  vi.stubGlobal('useTabsStore', () => ({ close: vi.fn(), registerCloseGuard: () => () => {} }))
  vi.stubGlobal('usePayrollStore', () => ({ loadRead: vi.fn().mockResolvedValue({ projects: payrollUiConfig().options.projects }), loadAConfig: load, getAPending: () => null, saveASubjectConfig: saveSubject, saveAPrices: savePrices }))
  vi.stubGlobal('useKitUI', () => ({ success: vi.fn(), confirm: vi.fn().mockResolvedValue(false) }))
  vi.stubGlobal('useEventListener', vi.fn())
})
it('两个修改区各持原依据；保存比例和KeepAlive回页不抬未保存单价依据', async () => {
  const visible = shallowRef(true)
  const Other = defineComponent({ render: () => h('p', '其他页') })
  const wrapper = mount(defineComponent({ setup: () => () => h(KeepAlive, () => visible.value ? h(Harness) : h(Other)) }))
  await flushPromises()
  expect(ui.editable.value).toBe(true)
  ui.subject.value.initialPayRatio = 0
  const price = { priceId: null, itemId: 'item', unit: '㎡', mode: 'baseline' as const, workerId: null, effectiveMonth: '2026-09', unitPrice: null, scope: { kind: 'project' as const } }
  ui.prices.value = [price]
  load.mockResolvedValue(payrollUiConfig('v2'))
  await ui.save('subject')
  expect(saveSubject).toHaveBeenCalledWith(expect.objectContaining({ context: expect.objectContaining({ sourceVersion: 'v1' }) }), expect.objectContaining({ initialPayRatio: 0 }))
  expect(ui.priceRead.value?.context.sourceVersion).toBe('v1')
  visible.value = false
  await flushPromises()
  visible.value = true
  await flushPromises()
  expect(ui.prices.value).toEqual([price])
  expect(ui.priceRead.value?.context.sourceVersion).toBe('v1')
  savePrices.mockRejectedValue(new Error('配置已变化'))
  await ui.save('prices')
  expect(savePrices).toHaveBeenCalledWith(expect.objectContaining({ context: expect.objectContaining({ sourceVersion: 'v1' }) }), [price])
  expect(ui.prices.value[0]?.unitPrice).toBeNull()
  expect(ui.error.value).toBe('配置已变化')
  wrapper.unmount()
})
it('keepAlive回来遇403仍保原比例和单价稿，禁止继续发起配置保存', async () => {
  const visible = shallowRef(true)
  const Other = defineComponent({ render: () => h('p', '其他页') })
  const wrapper = mount(defineComponent({ setup: () => () => h(KeepAlive, () => visible.value ? h(Harness) : h(Other)) }))
  await flushPromises()
  ui.subject.value.initialPayRatio = 0.7
  ui.prices.value = [{ priceId: null, itemId: 'item', unit: '㎡', mode: 'baseline', workerId: null, effectiveMonth: '2026-09', unitPrice: 123.45, scope: { kind: 'project' } }]
  visible.value = false
  await flushPromises()
  load.mockRejectedValue(new Error('无权读取工资配置'))
  visible.value = true
  await flushPromises()
  expect(ui.subject.value.initialPayRatio).toBe(0.7)
  expect(ui.prices.value[0]?.unitPrice).toBe(123.45)
  expect(ui.subjectRead.value?.context.sourceVersion).toBe('v1')
  expect(ui.editable.value).toBe(false)
  await ui.save('subject')
  await ui.save('prices')
  expect(saveSubject).not.toHaveBeenCalled()
  expect(savePrices).not.toHaveBeenCalled()
  wrapper.unmount()
})
