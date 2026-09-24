import { fireEvent, render, screen, within } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, KeepAlive, onMounted, reactive, ref, shallowRef } from 'vue'
import DeliveryRecordDetailScreen from '~/components/delivery/DeliveryRecordDetailScreen.vue'
import DeliveryRecordSummary from '~/components/delivery/DeliveryRecordSummary.vue'

const record = {
  id: 'delivery-1',
  projectId: 'project-1',
  supplierId: 'supplier-1',
  rawSiteText: '',
  orderNo: 'XS202605100008',
  deliveryDate: '2026-05-10',
  fileName: 'delivery.pdf',
  filePath: '',
  ocrStatus: 'reviewed',
  archived: true,
  stored: true,
  printDisposition: 'pending',
  printedAt: '',
  printExcludedAt: '',
  reviewFlag: '',
  note: '',
  createdAt: '2026-05-10',
  updatedAt: '2026-05-10',
  hasSourceFile: true,
  totalAmount: 3552,
  lines: [
    {
      id: 'line-1',
      deliveryRecordId: 'delivery-1',
      materialName: '材料甲',
      spec: '',
      unit: '把',
      qty: 8,
      unitPrice: 145,
      amount: 1160,
      amountSource: 'ocr',
      note: '',
      sortOrder: 0,
    },
  ],
}

const NuxtLinkStub = defineComponent({
  props: {
    to: {
      type: [String, Object],
      required: true,
    },
  },
  setup(props, { slots }) {
    return () => h('a', {
      href: typeof props.to === 'string' ? props.to : JSON.stringify(props.to),
    }, slots.default?.())
  },
})

const MetricStub = defineComponent({
  props: {
    label: { type: String, required: true },
    value: { type: [String, Number], required: true },
    formula: { type: String, default: '' },
  },
  setup(props) {
    return () => h('div', { 'role': 'group', 'aria-label': props.label }, [
      h('span', props.label),
      h('span', String(props.value)),
      props.formula ? h('span', { title: props.formula }, '说明') : null,
    ])
  },
})

const MetricGridStub = defineComponent({
  setup(_, { slots }) {
    return () => h('div', slots.default?.())
  },
})

const global = {
  components: {
    KitButton: defineComponent({ props: ['disabled', 'loading'], template: '<button :disabled="disabled || loading"><slot /></button>' }),
    DeliveryRecordHistory: defineComponent({ template: '<div>只读修订历史</div>' }),
    DeliveryRecordSourcePanel: defineComponent({ template: '<div>原件</div>' }),
    DeliveryRecordSummary,
    KitTable: defineComponent({ template: '<div>材料表</div>' }),
    Metric: MetricStub,
    MetricGrid: MetricGridStub,
    NuxtLink: NuxtLinkStub,
    SectionHeader: defineComponent({
      props: ['title', 'subtitle'],
      template: '<header><b>{{ title }}</b><span>{{ subtitle }}</span></header>',
    }),
  },
}

vi.stubGlobal('computed', computed)
vi.stubGlobal('onMounted', onMounted)
vi.stubGlobal('shallowRef', shallowRef)
vi.stubGlobal('useRoute', () => ({ params: { id: record.id } }))
vi.stubGlobal('useTabTitle', () => {})
vi.stubGlobal('useKitUI', () => ({
  confirm: vi.fn(),
  undoToast: vi.fn(),
  error: vi.fn(),
}))
vi.stubGlobal('useDeliveryRecordStore', () => ({
  loading: false,
  byId: (id: string) => id === record.id ? record : undefined,
  load: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn(),
  undo: vi.fn(),
}))
vi.stubGlobal('useProjectStore', () => ({
  byId: () => ({ id: 'project-1', name: '合和新城' }),
  load: vi.fn().mockResolvedValue(undefined),
}))
vi.stubGlobal('useSupplierStore', () => ({
  byId: () => ({ id: 'supplier-1', name: '广州建材有限公司' }),
  load: vi.fn().mockResolvedValue(undefined),
}))

describe('deliveryRecordDetailScreen', () => {
  it('显示真实已归档和独立打印状态，不把归档冒充入库资格', async () => {
    render(DeliveryRecordDetailScreen, { global })
    await flushPromises()

    const storedMetric = screen.getByRole('group', { name: '归档状态' })
    expect(within(storedMetric).getByText('已归档')).not.toBeNull()

    const printMetric = screen.getByRole('group', { name: '打印状态' })
    expect(within(printMetric).getByText('待打印')).not.toBeNull()

    const explanation = screen.getByRole('status', { name: '送货单状态说明' })
    expect(explanation.textContent).not.toContain('归档即视为已入库')
    expect(explanation.textContent).toContain('到货闭合与库存')
    expect(explanation.textContent).toContain('尚未收到打印成功回执')

    expect(screen.queryByTitle('有效材料明细行')).toBeNull()
    expect(screen.queryByTitle('入库供单价对比，留第二趟')).toBeNull()
  })

  function central() {
    const load = vi.fn().mockResolvedValue(undefined)
    const store = reactive({ mode: 'central', origin: 'real', canWrite: true, loading: false, load, byId: () => ({ ...record, version: '2', dataOrigin: 'real', projectName: '中央项目', supplierName: '中央分供方' }), remove: vi.fn(), undo: vi.fn() })
    const project = vi.fn(() => ({ byId: () => ({ name: '同名本地项目' }), load: vi.fn() }))
    const supplier = vi.fn(() => ({ byId: () => ({ name: '同名本地分供方' }), load: vi.fn() }))
    vi.stubGlobal('useDeliveryRecordStore', () => store)
    vi.stubGlobal('useProjectStore', project)
    vi.stubGlobal('useSupplierStore', supplier)
    vi.stubGlobal('useRoute', () => ({ params: { id: record.id }, query: {} }))
    return { store, load, project, supplier }
  }

  it('中央详情读取当前名称和权限，不调用本地主档，读失败撤旧事实并可重试', async () => {
    const { load, project, supplier } = central()
    load.mockRejectedValueOnce(new Error('无当前关联分供方读取权限'))
    render(DeliveryRecordDetailScreen, { global })
    await flushPromises()
    expect(screen.getByRole('alert').textContent).toContain('无当前关联分供方读取权限')
    expect(screen.queryByText(record.orderNo)).toBeNull()
    expect(screen.queryByRole('link', { name: /编辑/ })).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
    await flushPromises()
    expect(screen.getByRole('link', { name: '中央项目' }).getAttribute('href')).toContain('origin=real')
    expect(screen.getByRole('link', { name: '中央分供方' })).toBeTruthy()
    expect(project).not.toHaveBeenCalled()
    expect(supplier).not.toHaveBeenCalled()
  })

  it('缓存详情返回同一记录重验权限，挂起和失败时没有旧金额或编辑动作', async () => {
    const { load } = central()
    const visible = ref(true)
    const Host = defineComponent({ setup: () => () => h(KeepAlive, () => visible.value ? h(DeliveryRecordDetailScreen) : h('div', '其他页面')) })
    render(Host, { global })
    await flushPromises()
    expect(screen.getByRole('link', { name: /编辑/ })).toBeTruthy()
    visible.value = false
    await flushPromises()
    let reject!: (cause: Error) => void
    load.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => {
      reject = fail
    }))
    visible.value = true
    await flushPromises()
    expect(screen.queryByRole('link', { name: /编辑/ })).toBeNull()
    expect(screen.queryByText(record.orderNo)).toBeNull()
    reject(new Error('当前关系已失效'))
    await flushPromises()
    expect(screen.getByRole('alert').textContent).toContain('当前关系已失效')
  })

  it('显式来源与当前模式不同不能借同 ID 显示或修改另一来源记录', async () => {
    const { load } = central()
    vi.stubGlobal('useRoute', () => ({ params: { id: record.id }, query: { origin: 'demo' } }))
    render(DeliveryRecordDetailScreen, { global })
    await flushPromises()
    expect(screen.getByRole('alert').textContent).toContain('来源')
    expect(screen.queryByText(record.orderNo)).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })
})
