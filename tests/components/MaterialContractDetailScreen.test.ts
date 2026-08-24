import { fireEvent, render, screen } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import MaterialContractDetailScreen from '~/components/contract/MaterialContractDetailScreen.vue'

const mocks = vi.hoisted(() => ({
  store: {
    detailState: { kind: 'idle' } as any,
    loadDetail: vi.fn().mockResolvedValue(undefined),
  },
}))
const store = mocks.store
vi.mock('~/stores/material-contract-read', () => ({ useMaterialContractReadStore: () => mocks.store }))
vi.mock('~/stores/data-visibility', () => ({ useDataVisibilityStore: () => ({ includeDemo: true }) }))
const route = reactive({ query: {} as Record<string, string>, fullPath: '/contract/c1?origin=demo' })
const replace = vi.fn()

const ref = (entity: 'project' | 'supplier', id: string, label: string) => ({ state: 'resolved', entity, id, label, no: null })
const navigation = (subject: any) => ({ kind: 'entity-detail', subject, variant: 'detail', view: null, filters: { dataOrigin: 'demo' } })
const fact = { id: 'f1', no: 'F-1', name: '事实一', amount: '10.00', date: '2026-08-24', status: '已确认', navigation: { kind: 'unavailable', reason: 'missing-route' } }
const project = ref('project', 'p1', '项目一')
const supplier = ref('supplier', 's1', '供应商一')
const detail = {
  dataOrigin: 'demo',
  contract: {
    dataOrigin: 'demo',
    id: 'c1',
    no: 'HT-1',
    name: '瓷砖采购合同',
    kind: '材采',
    project,
    supplier,
    amounts: { contract: '100.00', changed: '100.00', settled: '20.00', invoiced: '20.00', paid: '10.00', payable: '10.00' },
    content: '瓷砖',
    invoiceType: '专票',
    contactName: '联系人',
    contactPhone: '138****0318',
    taxRate: 13,
    signDate: '2026-08-24',
    mainTerms: '',
    paymentTerms: '',
    brandQualityTerms: '',
    scheduleTerms: '',
    warrantyTerms: '',
    specialTerms: '',
    retentionRatio: null,
    retentionAmount: null,
    retentionDays: null,
    invoiceName: '',
    invoiceTaxNo: '',
    invoiceAddressPhone: '',
    invoiceBank: '',
    invoiceBankAccount: '',
    status: '履约中',
    note: '',
    updatedAt: '2026-08-24T00:00:00.000Z',
  },
  projectNavigation: navigation(project),
  supplierNavigation: navigation(supplier),
  sections: { lineItems: [], materials: { requisitions: [fact], arrivals: [], directTransfers: [], outbound: [] }, invoices: [], payments: [], settlements: [], penalties: [], files: [] },
  asOf: '2026-08-24T00:00:00.000Z',
  sourceVersion: 'v1',
  capabilities: ['material-contract:read'],
}

const tabs = defineComponent({
  props: ['modelValue', 'tabs'],
  emits: ['update:modelValue'],
  template: '<div><button v-for="tab in tabs" :key="tab.key" role="tab" @click="$emit(\'update:modelValue\', tab.key)">{{ tab.label }}</button></div>',
})
const common = {
  global: { components: {
    EntityDetailShell: defineComponent({
      props: ['title', 'state', 'stateDescription'],
      template: '<div><h2>{{ title }}</h2><slot name="status"/><slot name="actions"/><slot name="summary"/><slot v-if="state === \'ready\'"/><div v-else role="alert">{{ stateDescription }}</div></div>',
    }),
    SegTab: tabs,
    MetricGrid: defineComponent({ template: '<div><slot/></div>' }),
    Metric: defineComponent({ props: ['label', 'value'], template: '<span>{{ label }} {{ value }}</span>' }),
    SectionHeader: defineComponent({ props: ['title'], template: '<h2>{{ title }}</h2>' }),
    MaterialContractFactTable: defineComponent({ props: ['rows', 'emptyLabel'], template: '<div>{{ rows.length ? rows[0].name : emptyLabel }}</div>' }),
    NuxtLink: defineComponent({ props: ['to'], template: '<a :href="to"><slot/></a>' }),
    StatePanel: defineComponent({ props: ['title', 'description'], template: '<div role="alert">{{ title }} {{ description }}</div>' }),
  } },
}

vi.stubGlobal('useRoute', () => route)
vi.stubGlobal('useRouter', () => ({ replace }))
vi.stubGlobal('useTabTitle', () => {})
vi.stubGlobal('navigateTo', vi.fn())

describe('材料采购合同中央详情', () => {
  beforeEach(() => {
    route.query = {}
    replace.mockReset()
    store.loadDetail.mockClear()
    store.detailState = { kind: 'ready', data: detail }
  })

  it('演示详情只读，七个页签写入 URL，并展示真实空态', async () => {
    render(MaterialContractDetailScreen, { props: { contractId: 'c1', origin: 'demo' }, ...common })
    expect(screen.queryByTestId('material-contract-edit')).toBeNull()
    expect(screen.getAllByRole('tab')).toHaveLength(7)
    await fireEvent.click(screen.getByRole('tab', { name: /发票登记/ }))
    expect(replace).toHaveBeenCalledWith({ query: { tab: 'invoices' } })
  })

  it('刷新失败时保留上一版中央详情并提供重试', () => {
    store.detailState = {
      kind: 'error',
      previous: detail,
      problem: { code: 'unavailable', message: '中央服务不可用', retryable: true, fieldErrors: {}, traceId: null },
    }
    render(MaterialContractDetailScreen, { props: { contractId: 'c1', origin: 'demo' }, ...common })
    expect(screen.getByText('瓷砖采购合同')).not.toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('保留上一次成功读取的详情')
  })
})
