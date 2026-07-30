import { render, screen, within } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, onMounted, shallowRef } from 'vue'
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
  it('归档即显示已入库，并以可读说明区分待打印状态', async () => {
    render(DeliveryRecordDetailScreen, { global })

    const storedMetric = screen.getByRole('group', { name: '入库状态' })
    expect(within(storedMetric).getByText('已入库')).not.toBeNull()

    const printMetric = screen.getByRole('group', { name: '打印状态' })
    expect(within(printMetric).getByText('待打印')).not.toBeNull()

    const explanation = screen.getByRole('status', { name: '送货单状态说明' })
    expect(explanation.textContent).toContain('归档即视为已入库')
    expect(explanation.textContent).toContain('尚未收到打印成功回执')

    expect(screen.queryByTitle('有效材料明细行')).toBeNull()
    expect(screen.queryByTitle('入库供单价对比，留第二趟')).toBeNull()
  })
})
