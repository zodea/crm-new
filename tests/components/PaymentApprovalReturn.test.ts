import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, KeepAlive, onActivated, onDeactivated, reactive, shallowRef, watch } from 'vue'
import PaymentApplicationDetailScreen from '~/components/finance/PaymentApplicationDetailScreen.vue'

const load = vi.hoisted(() => vi.fn())
vi.mock('~/stores/finance', () => ({ useFinanceStore: () => ({ paymentApplicationDetail: load }) }))
vi.mock('~/lib/read-model/authority', () => ({ bindReadAuthority: () => undefined }))
vi.mock('~/composables/useProjectSupplierReturnContext', () => ({ useProjectSupplierReturnContext: () => null }))

beforeEach(() => {
  const route = reactive({ params: { id: 'approval' }, query: {} })
  for (const [name, value] of Object.entries({ computed, shallowRef, watch, onActivated, onDeactivated, useRoute: () => route, useTabTitle: vi.fn() }))
    vi.stubGlobal(name, value)
  load.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

function detail(approvedAmount: number | null) {
  return {
    id: 'approval',
    name: '批复往返',
    status: 'draft',
    applyAmount: 100,
    approvedAmount,
    approvedAmountState: approvedAmount === null ? 'not-entered' : 'known',
    unpaidAmount: approvedAmount === null ? 100 : 0,
    registrationAmount: approvedAmount === null ? 100 : 0,
    paidAmount: 0,
    invoiceAllocated: 0,
    invoiceState: '先款后票',
    pendingInvoiceAmount: 100,
    insight: { attentionCount: 0 },
  }
}

it.each([
  ['先款后票', 100, '100'],
  ['先款后票', 0, '0'],
  ['先款后票', null, '— 尚未核实'],
  ['先票后款', 0, null],
  ['无需发票', 0, null],
] as const)('%s 的详情只显示对应待回票义务，真实零和未知状态不互换', async (invoiceState, pendingInvoiceAmount, expected) => {
  load.mockResolvedValue({ ...detail(null), invoiceState, pendingInvoiceAmount })
  const { wrapper } = mountCachedDetail()
  await flushPromises()
  if (expected === null)
    expect(wrapper.text()).not.toContain('待回票：')
  else
    expect(wrapper.text()).toContain(`待回票：${expected}`)
  expect(wrapper.text()).toContain('待支付：100')
  expect(wrapper.text()).toContain('本期批复金额：— 未填写')
  wrapper.unmount()
})

function mountCachedDetail() {
  const visible = shallowRef(true)
  const Other = defineComponent({ render: () => h('p', '编辑表单') })
  const Host = defineComponent({ setup: () => () => h(KeepAlive, () => visible.value ? h(PaymentApplicationDetailScreen) : h(Other)) })
  const wrapper = mount(Host, {
    global: {
      stubs: { SectionHeader: true, NuxtLink: true, PaymentApplicationInsightPanel: true },
      components: {
        KitButton: defineComponent({ template: '<button><slot /></button>' }),
        EntityDetailShell: defineComponent({
          props: ['state', 'stateDescription'],
          emits: ['stateAction'],
          setup: (props, { slots, emit }) => () => h('main', props.state === 'ready'
            ? [slots.summary?.(), slots.actions?.()]
            : [props.stateDescription, props.state === 'error' ? h('button', { onClick: () => emit('stateAction') }, '重新加载') : null]),
        }),
        MetricGrid: defineComponent({ template: '<section><slot /></section>' }),
        Metric: defineComponent({ props: ['label', 'value', 'status'], template: '<p>{{ label }}：{{ value }} {{ status }}</p>' }),
      },
    },
  })
  return { wrapper, visible }
}

it('编辑保存后返回同 ID 缓存详情，批复和余额读取最新值', async () => {
  let approvedAmount: number | null = null
  load.mockImplementation(async () => detail(approvedAmount))
  const { wrapper, visible } = mountCachedDetail()
  await flushPromises()
  expect(wrapper.text()).toContain('本期批复金额：— 未填写')
  visible.value = false
  await flushPromises()
  approvedAmount = 0
  visible.value = true
  await flushPromises()
  expect(wrapper.text()).toContain('本期批复金额：0 已填写')
  expect(wrapper.text()).toContain('待支付：0')
  wrapper.unmount()
})

it('同 ID 返回期间撤旧金额与支付动作，读取失败可重试且不冒充旧余额', async () => {
  load.mockResolvedValue(detail(null))
  const { wrapper, visible } = mountCachedDetail()
  await flushPromises()
  expect(wrapper.text()).toContain('待支付：100')
  visible.value = false
  await flushPromises()
  let reject!: (error: Error) => void
  load.mockImplementation(() => new Promise((_, fail) => reject = fail))
  visible.value = true
  await flushPromises()
  expect(wrapper.text()).not.toContain('待支付：100')
  expect(wrapper.find('[data-testid="payment-application-create-payment"]').exists()).toBe(false)
  reject(new Error('读取暂时失败'))
  await flushPromises()
  expect(wrapper.text()).toContain('读取暂时失败')
  load.mockResolvedValue(detail(0))
  await wrapper.get('button').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('本期批复金额：0 已填写')
  expect(wrapper.find('[data-testid="payment-application-create-payment"]').exists()).toBe(false)
  wrapper.unmount()
})
