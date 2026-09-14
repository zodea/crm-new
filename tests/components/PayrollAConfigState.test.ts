import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, reactive, shallowRef } from 'vue'
import PayrollACommandState from '~/components/payroll/PayrollACommandState.vue'
import { usePayrollAConfig } from '~/composables/usePayrollAConfig'
import { payrollUiConfig } from '../helpers/payroll-a-ui-fixture'
import { feeConfigRead, feeDraft } from '../helpers/payroll-fees-ui-fixture'

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }))
const route = reactive({ path: '/subcontract/payroll/config', fullPath: '/subcontract/payroll/config?origin=real&project=project&month=2026-09&crew=crew&leader=worker', query: { origin: 'real', project: 'project', month: '2026-09', crew: 'crew', leader: 'worker' } })
const load = vi.fn()
const loadRead = vi.fn()
const saveSubject = vi.fn()
const savePrices = vi.fn()
const feeRepository = { aFeeConfig: vi.fn(), executeFees: vi.fn(), aForm: vi.fn() }
const push = vi.fn()
const closeGuard = shallowRef<(() => boolean | Promise<boolean>) | null>(null)
let ui: ReturnType<typeof usePayrollAConfig>
const Harness = defineComponent({ setup() {
  ui = usePayrollAConfig()
  return () => h('div', [h('p', ui.error.value), h(PayrollACommandState, { ref: ui.fees.errorPanel, error: ui.fees.error.value, pending: !!ui.fees.pending.value, busy: ui.fees.busy.value, focusable: true })])
} })
beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  setActivePinia(createPinia())
  feeRepository.aFeeConfig.mockImplementation(async () => feeConfigRead())
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { payroll: feeRepository } }))
  load.mockResolvedValue(payrollUiConfig())
  loadRead.mockResolvedValue({ projects: payrollUiConfig().options.projects })
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useRouter', () => ({ replace: vi.fn(), push }))
  vi.stubGlobal('useTabsStore', () => ({ close: vi.fn(), registerCloseGuard: (_key: string, guard: () => boolean | Promise<boolean>) => {
    closeGuard.value = guard
    return () => { }
  } }))
  vi.stubGlobal('usePayrollStore', () => ({ loadRead, loadAConfig: load, getAPending: () => null, saveASubjectConfig: saveSubject, saveAPrices: savePrices }))
  vi.stubGlobal('useKitUI', () => ({ success: vi.fn(), confirm: vi.fn().mockResolvedValue(false) }))
  vi.stubGlobal('useEventListener', vi.fn())
})
it('尚无工资的新项目从已验证配置读取得到项目候选', async () => {
  loadRead.mockResolvedValue({ projects: [] })
  const wrapper = mount(Harness, { global: { stubs: { KitButton: true } } })
  await flushPromises()
  expect(ui.matching.value?.scope.projectId).toBe('project')
  expect(ui.projects.value).toEqual(payrollUiConfig().options.projects)
  wrapper.unmount()
})
it('普通簿当月已发只锁费用修订，仍可显式新增独立管理关系', async () => {
  const value = feeConfigRead()
  value.eligibility.canSaveFees = false
  value.eligibility.feeReasons = ['当前普通簿已发冻结']
  feeRepository.aFeeConfig.mockResolvedValue(value)
  const wrapper = mount(Harness, { global: { stubs: { KitButton: true } } })
  await flushPromises()
  expect(ui.fees.editable.value).toBe(true)
  expect(ui.fees.canEditFees.value).toBe(false)
  expect(ui.fees.canEditManagement.value).toBe(true)
  ui.fees.addFee()
  expect(ui.fees.rows.value).toEqual([])
  ui.fees.editManagement('crew-managed')
  expect(ui.fees.management.value?.managementBookId).toBeNull()
  expect(ui.fees.management.value?.managementMode).toBe('crew-managed')
  await ui.fees.execute('fees')
  expect(feeRepository.executeFees).not.toHaveBeenCalled()
  wrapper.unmount()
})
it('费用unknown由整页唯一关闭守卫保稿，冷重开从原命令恢复字段', async () => {
  let wrapper = mount(Harness, { attachTo: document.body, global: { stubs: { KitButton: { template: '<button><slot /></button>' } } } })
  await flushPromises()
  ui.fees.addFee()
  ui.fees.changeFee(ui.fees.rows.value[0]!.key, { ...feeDraft(), name: '原补贴长名称', unitPrice: 0 })
  feeRepository.executeFees.mockRejectedValueOnce(new Error('提交响应未到达'))
  await ui.fees.execute('fees')
  const original = ui.fees.pending.value!.command
  expect(ui.fees.pending.value?.state).toBe('unknown')
  expect(document.activeElement?.getAttribute('aria-label')).toBe('工资提交核对')
  expect(await closeGuard.value!()).toBe(false)
  await ui.leave()
  expect(push).not.toHaveBeenCalled()
  wrapper.unmount()
  setActivePinia(createPinia())
  wrapper = mount(Harness, { global: { stubs: { KitButton: { template: '<button><slot /></button>' } } } })
  await flushPromises()
  expect(ui.fees.rows.value[0]?.draft).toMatchObject({ name: '原补贴长名称', unitPrice: 0 })
  expect(ui.fees.pending.value?.command).toEqual(original)
  wrapper.unmount()
})
it('重新读取费用撤权仍保原稿和原baseVersion', async () => {
  const wrapper = mount(Harness, { global: { stubs: { KitButton: { template: '<button><slot /></button>' } } } })
  await flushPromises()
  ui.fees.addFee()
  ui.fees.changeFee(ui.fees.rows.value[0]!.key, { ...feeDraft(), name: '保留原房补' })
  const next = feeConfigRead('fees-new')
  next.context = { ...next.context, readonly: true, capabilities: ['payroll:read'] }
  feeRepository.aFeeConfig.mockResolvedValueOnce(next)
  await ui.fees.load()
  expect(ui.fees.rows.value[0]?.draft.name).toBe('保留原房补')
  expect(ui.fees.matching.value?.baseVersion).toBe('fees-1')
  expect(ui.fees.current.value?.baseVersion).toBe('fees-new')
  expect(ui.fees.editable.value).toBe(false)
  await ui.fees.execute('fees')
  expect(feeRepository.executeFees).not.toHaveBeenCalled()
  wrapper.unmount()
})
it('两个修改区各持原依据；保存比例和KeepAlive回页不抬未保存单价依据', async () => {
  const visible = shallowRef(true)
  const Other = defineComponent({ render: () => h('p', '其他页') })
  const wrapper = mount(defineComponent({ setup: () => () => h(KeepAlive, () => visible.value ? h(Harness) : h(Other)) }), { global: { stubs: { KitButton: { template: '<button><slot /></button>' } } } })
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
  const wrapper = mount(defineComponent({ setup: () => () => h(KeepAlive, () => visible.value ? h(Harness) : h(Other)) }), { global: { stubs: { KitButton: { template: '<button><slot /></button>' } } } })
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
