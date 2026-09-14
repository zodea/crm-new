import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, shallowRef } from 'vue'
import PayrollAPriceDialog from '~/components/payroll/PayrollAPriceDialog.vue'
import PayrollAPriceEditor from '~/components/payroll/PayrollAPriceEditor.vue'
import { payrollUiConfig, payrollUiLine } from '../helpers/payroll-a-ui-fixture'

const save = vi.fn()
const load = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  load.mockResolvedValue(payrollUiConfig())
  vi.stubGlobal('usePayrollStore', () => ({ loadAConfig: load, getAPending: () => null, saveAPrices: save }))
})
it('调价弹层切页后撤权，原价格仍保留但保存按钮禁用', async () => {
  const visible = shallowRef(true)
  const Other = defineComponent({ render: () => h('p', '其他页') })
  const Price = defineComponent({ setup: () => () => h(PayrollAPriceDialog, { open: true, line: payrollUiLine(), projectId: 'project', month: '2026-09', crewId: 'crew', leaderWorkerId: 'worker', returnTo: '/subcontract/payroll/wage-a?origin=real' }) })
  const wrapper = mount(defineComponent({ setup: () => () => h(KeepAlive, () => visible.value ? h(Price) : h(Other)) }), { attachTo: document.body, global: { components: { PayrollAPriceEditor }, stubs: { NuxtLink: { template: '<a><slot /></a>' }, KitButton: { template: '<button><slot /></button>' } } } })
  const price = await screen.findByRole('spinbutton', { name: '工资单价金额' })
  await fireEvent.update(price, '123.45')
  visible.value = false
  await flushPromises()
  load.mockRejectedValue(new Error('无权读取工资配置'))
  visible.value = true
  await flushPromises()
  expect((await screen.findByRole('spinbutton', { name: '工资单价金额' }) as HTMLInputElement).value).toBe('123.45')
  expect((screen.getByRole('button', { name: '保存单价' }) as HTMLButtonElement).disabled).toBe(true)
  expect(save).not.toHaveBeenCalled()
  wrapper.unmount()
})
it('行级调价先显示实际个人例外，切统一价使用基准记录且锁定稳定分项范围', async () => {
  render(PayrollAPriceDialog, { props: { open: true, line: payrollUiLine(), projectId: 'project', month: '2026-09', crewId: 'crew', leaderWorkerId: 'worker', returnTo: '/subcontract/payroll/wage-a?origin=real' }, global: { components: { PayrollAPriceEditor }, stubs: { NuxtLink: { template: '<a><slot /></a>' }, KitButton: { template: '<button><slot /></button>' } } } })
  const mode = await screen.findByRole('combobox', { name: '单价调整方式' }) as HTMLSelectElement
  expect(mode.value).toBe('worker-exception')
  expect((screen.getByRole('spinbutton', { name: '工资单价金额' }) as HTMLInputElement).value).toBe('12')
  expect((screen.getByRole('combobox', { name: '单价分项及单位' }) as HTMLSelectElement).disabled).toBe(true)
  expect((screen.getByRole('combobox', { name: '工资单价范围' }) as HTMLSelectElement).disabled).toBe(true)
  await fireEvent.update(mode, 'baseline')
  expect((screen.getByRole('spinbutton', { name: '工资单价金额' }) as HTMLInputElement).value).toBe('10')
  await fireEvent.update(screen.getByRole('spinbutton', { name: '工资单价金额' }), '0')
  await fireEvent.click(screen.getByRole('button', { name: '保存单价' }))
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ context: expect.objectContaining({ sourceVersion: 'v1' }) }), [expect.objectContaining({ priceId: 'base', mode: 'baseline', unitPrice: 0, itemId: 'item' })])
})
it('行级调价成功后读失败仍保留原提交，核对可信配置后才关闭', async () => {
  const operation = { command: { commandId: 'price-original' }, state: 'awaiting-read' }
  const pending = shallowRef<typeof operation | null>(null)
  const recover = vi.fn().mockResolvedValue({ outcome: 'saved' })
  const acknowledge = vi.fn(() => pending.value = null)
  save.mockImplementation(async () => {
    pending.value = operation
    return { outcome: 'saved' }
  })
  vi.stubGlobal('usePayrollStore', () => ({ loadAConfig: load, getAPending: () => pending.value, saveAPrices: save, recoverA: recover, acknowledgeA: acknowledge }))
  const view = render(PayrollAPriceDialog, { props: { open: true, line: payrollUiLine(), projectId: 'project', month: '2026-09', crewId: 'crew', leaderWorkerId: 'worker', returnTo: '/subcontract/payroll/wage-a?origin=real' }, global: { components: { PayrollAPriceEditor }, stubs: { NuxtLink: { template: '<a><slot /></a>' }, KitButton: { template: '<button><slot /></button>' } } } })
  await fireEvent.update(await screen.findByRole('spinbutton', { name: '工资单价金额' }), '23')
  load.mockRejectedValueOnce(new Error('确认后的配置暂不可读'))
  await fireEvent.click(screen.getByRole('button', { name: '保存单价' }))
  await flushPromises()
  expect(view.emitted().saved).toBeUndefined()
  expect(pending.value).toEqual(operation)
  expect((screen.getByRole('spinbutton', { name: '工资单价金额' }) as HTMLInputElement).value).toBe('23')
  await fireEvent.click(screen.getByRole('button', { name: '核对原提交' }))
  await flushPromises()
  expect(save).toHaveBeenCalledTimes(1)
  expect(recover).toHaveBeenCalledWith(operation)
  expect(acknowledge).toHaveBeenCalledWith(operation, expect.objectContaining({ scope: payrollUiConfig().scope }))
  expect(view.emitted().saved).toEqual([[]])
})
