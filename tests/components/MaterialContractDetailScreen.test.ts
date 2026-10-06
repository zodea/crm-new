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
    ContractOriginalFilesPanel: defineComponent({ props: ['files', 'canRead'], template: '<section aria-label="合同原件附件"><span v-for="file in files" :key="file.id">{{ file.fileName }}</span></section>' }),
    NuxtLink: defineComponent({ props: ['to'], template: '<a :href="to"><slot/></a>' }),
    StatePanel: defineComponent({ props: ['title', 'description'], template: '<div role="alert">{{ title }} {{ description }}</div>' }),
  } },
}

vi.stubGlobal('useRoute', () => route)
vi.stubGlobal('useRouter', () => ({ replace }))
vi.stubGlobal('useTabTitle', () => {})
vi.stubGlobal('navigateTo', vi.fn())
vi.stubGlobal('useNuxtApp', () => ({ $repositories: { materialContractRead: { fileContent: vi.fn().mockRejectedValue(new Error('历史缺原件')) } } }))

describe('材料采购合同中央详情', () => {
  beforeEach(() => {
    route.query = {}
    route.fullPath = '/contract/c1?origin=demo&contractKind=material'
    replace.mockReset()
    store.loadDetail.mockClear()
    store.detailState = { kind: 'ready', data: detail }
  })

  it.each([
    { status: '履约中', tone: 'brand' },
    { status: '已结清', tone: 'ok' },
    { status: '待外部复核', tone: 'neutral' },
  ])('展示合同真实业务状态 $status，数据来源仍使用独立来源标识', ({ status: text, tone }) => {
    store.detailState = { kind: 'ready', data: { ...detail, contract: { ...detail.contract, status: text } } }
    render(MaterialContractDetailScreen, { props: { contractId: 'c1', origin: 'demo' }, ...common })
    const status = screen.getByText(text)
    expect(status.getAttribute('data-ui')).toBe('status-tag')
    expect(status.getAttribute('data-tone')).toBe(tone)
    expect(screen.getByText('演示只读').getAttribute('data-ui')).not.toBe('status-tag')
  })

  it('从合同按稳定分供方 ID 进入四类事实，并携带当前合同页签来源', () => {
    const listReturnTo = '/contract/material?projectId=p1&origin=demo&nav=origin_319_contract#material-contract-row-demo%3Ac1'
    route.query = { tab: 'invoices', returnTo: listReturnTo }
    route.fullPath = `/contract/c1?origin=demo&contractKind=material&tab=invoices&returnTo=${encodeURIComponent(listReturnTo)}`
    render(MaterialContractDetailScreen, { props: { contractId: 'c1', origin: 'demo' }, ...common })

    for (const [label, tab] of [
      ['查看分供方合同事实', 'contracts'],
      ['查看分供方结算事实', 'settlements'],
      ['查看分供方收票事实', 'invoices'],
      ['查看分供方付款事实', 'payments'],
    ] as const) {
      const href = screen.getByRole('link', { name: label }).getAttribute('href') ?? ''
      expect(href).toContain(`/base/supplier/s1?origin=demo&tab=${tab}`)
      expect(href).toContain(`returnTo=${encodeURIComponent(route.fullPath)}`)
    }
  })

  it('演示详情只读，稳定分区写入 URL，补充协议亦只读', async () => {
    render(MaterialContractDetailScreen, { props: { contractId: 'c1', origin: 'demo' }, ...common })
    expect(screen.queryByTestId('material-contract-edit')).toBeNull()
    // 旧数量断言保护完整分区；逐个核对名称而不是只增加固定数量。
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['详细信息', '采购明细 0', '补充协议 0', '材料管理', '发票登记 0', '付款信息 0', '支出结算 0', '项目扣罚 0'])
    await fireEvent.click(screen.getByRole('tab', { name: /发票登记/ }))
    expect(replace).toHaveBeenCalledWith({ query: { tab: 'invoices' } })
  })

  it('分别呈现未记录关系、目标消失与无权关系，且不提供链接', () => {
    const missing = (entity: 'project' | 'supplier', reason: 'not-recorded' | 'not-configured') => ({
      state: 'missing',
      entity,
      id: null,
      label: null,
      reason,
    })
    store.detailState = {
      kind: 'ready',
      data: {
        ...detail,
        contract: {
          ...detail.contract,
          project: missing('project', 'not-configured'),
          supplier: { state: 'forbidden', entity: 'supplier', id: null, label: null, reason: 'permission-denied' },
        },
        projectNavigation: { kind: 'unavailable', reason: 'unverified-target' },
        supplierNavigation: { kind: 'unavailable', reason: 'forbidden' },
      },
    }
    const first = render(MaterialContractDetailScreen, { props: { contractId: 'c1', origin: 'demo' }, ...common })
    expect(screen.getByText('目标已不存在')).not.toBeNull()
    expect(screen.getByText('无权查看')).not.toBeNull()
    expect(screen.queryByRole('link', { name: '目标已不存在' })).toBeNull()
    expect(screen.queryByRole('link', { name: '无权查看' })).toBeNull()
    expect(first.container.innerHTML).not.toContain('supplier/s1')
    first.unmount()

    store.detailState = {
      kind: 'ready',
      data: {
        ...detail,
        contract: { ...detail.contract, project: missing('project', 'not-recorded') },
        projectNavigation: { kind: 'unavailable', reason: 'missing-id' },
      },
    }
    render(MaterialContractDetailScreen, { props: { contractId: 'c1', origin: 'demo' }, ...common })
    expect(screen.getByText('未记录')).not.toBeNull()
  })

  it('刷新失败时保留上一版中央详情并提供重试', () => {
    store.detailState = {
      kind: 'unavailable',
      previous: detail,
      problem: { code: 'unavailable', message: '中央服务不可用', retryable: true, fieldErrors: {}, traceId: null },
    }
    render(MaterialContractDetailScreen, { props: { contractId: 'c1', origin: 'demo' }, ...common })
    expect(screen.getByText('瓷砖采购合同')).not.toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('保留上一次成功读取的详情')
  })
  it('401不保留详情事实，明确提示登录失效', () => {
    store.detailState = { kind: 'forbidden', problem: { code: 'unauthenticated', message: '请重新登录', retryable: false, fieldErrors: {}, traceId: null } }
    const rendered = render(MaterialContractDetailScreen, { props: { contractId: 'c1', origin: 'demo' }, ...common })
    expect(screen.queryByText('瓷砖采购合同')).toBeNull()
    expect(rendered.container.querySelector('[state-title]')?.getAttribute('state-title')).toBe('登录已失效，请重新登录')
    expect(screen.queryByRole('link', { name: '供应商一' })).toBeNull()
  })
})
