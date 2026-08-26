import { fireEvent, render, screen } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import OwnerFinalSettlementDetailScreen from '~/components/owner-document/OwnerFinalSettlementDetailScreen.vue'

const mocks = vi.hoisted(() => ({
  store: {
    detailState: { kind: 'idle' } as any,
    loadDetail: vi.fn().mockResolvedValue(undefined),
  },
}))
vi.mock('~/stores/owner-commercial-document-read', () => ({ useOwnerCommercialDocumentReadStore: () => mocks.store }))
vi.mock('~/stores/data-visibility', () => ({ useDataVisibilityStore: () => ({ includeDemo: false }) }))

const route = reactive({
  path: '/owner/final-settlement/final-settlement-real-325',
  query: { origin: 'real' } as Record<string, string>,
  fullPath: '/owner/final-settlement/final-settlement-real-325?origin=real',
})
const navigateTo = vi.fn()
const project = { state: 'resolved', entity: 'project', id: 'project-real-325', label: '瑞航商务中心项目', no: null }
const customer = { state: 'resolved', entity: 'customer', id: 'customer-real-325', label: '瑞航置业', no: null }
const contract = { state: 'resolved', entity: 'contract', id: 'contract-real-325', label: '瑞航商务中心施工合同', no: 'SG-325' }
const navigation = (subject: any, variant = 'detail', view: string | null = null) => ({ kind: 'entity-detail', subject, variant, view, filters: { dataOrigin: 'real' } })

const detail = {
  dataOrigin: 'real',
  document: {
    id: 'final-settlement-real-325',
    kind: 'final_settlement',
    no: 'JS-2026-325',
    name: '瑞航商务中心项目甲方最终结算',
    documentType: 'final_settlement',
    periodNo: '',
    applicationDate: '2026-08-23',
    approvalDate: null,
    status: 'submitted',
    source: { type: 'owner_final_settlement', id: 'final-settlement-real-325', locked: true },
    approval: { status: 'submitted', label: '已提交', summary: '已提交甲方结算资料' },
    quantityEvidence: null,
    amounts: {
      kind: 'final_settlement',
      declared: '1020000.00',
      audited: null,
      changedContract: '1040000.00',
      cumulativeReceipts: '900000.00',
      receiptDifference: '120000.00',
    },
    project,
    customer,
    contract,
    note: '等待甲方审定',
    version: '1',
    updatedAt: '2026-08-23T00:00:00.000Z',
  },
  lines: [],
  files: [{ id: 'file-final-325', fileName: '最终结算书.pdf', fileSize: 325, mimeType: 'application/pdf', category: 'settlement-book', uploader: '周经办', uploadedAt: '2026-08-23T10:00:00.000Z' }],
  projectNavigation: navigation(project),
  customerNavigation: navigation(customer),
  contractNavigation: navigation(contract),
  sourceNavigation: navigation(contract, 'owner-document-source', 'final-settlement-real-325'),
  documentNavigation: navigation({ state: 'resolved', entity: 'owner-document', id: 'final-settlement-real-325', label: '瑞航商务中心项目甲方最终结算', no: 'JS-2026-325' }, 'final-settlement'),
  acceptanceView: null,
  lifecycleEvents: [],
  finalSettlementEvidence: {
    basis: '施工合同、补充协议与最终结算书',
    differenceNote: '审定金额尚未回传',
    sources: [
      { kind: 'contract-supplement', id: 'supplement-325', no: 'BC-325', name: '正式补充协议', status: 'approved', statusLabel: '已生效', amount: '80000.00', date: '2026-08-12', navigation: navigation(contract, 'supplement', 'supplement-325') },
      { kind: 'receipt', id: 'receipt-325', no: 'SK-325', name: '一期工程款', status: 'submitted', statusLabel: '已提交', amount: '900000.00', date: '2026-08-15', navigation: navigation({ state: 'resolved', entity: 'receipt', id: 'receipt-325', label: '一期工程款', no: 'SK-325' }) },
    ],
  },
  asOf: '2026-08-25T00:00:00.000Z',
  sourceVersion: 'owner-document-command-4',
  capabilities: ['owner-document:read', 'owner-document:write'],
}

const common = {
  global: { components: {
    EntityDetailShell: defineComponent({
      props: ['title', 'backLabel', 'state', 'stateTitle', 'stateDescription'],
      template: '<div><h1>{{ title }}</h1><span>{{ backLabel }}</span><slot name="status"/><slot name="actions"/><slot name="summary"/><slot v-if="state === \'ready\'"/><div v-else role="alert">{{ stateTitle }} {{ stateDescription }}</div></div>',
    }),
    MetricGrid: defineComponent({ template: '<div><slot/></div>' }),
    Metric: defineComponent({ props: ['label', 'value'], template: '<span>{{ label }} {{ value }}</span>' }),
    SectionHeader: defineComponent({ props: ['title', 'subtitle'], template: '<h2>{{ title }} {{ subtitle }}</h2>' }),
    EntityLink: defineComponent({ props: ['label'], template: '<a href="#">{{ label }}</a>' }),
    StatePanel: defineComponent({
      props: ['title', 'description', 'actionLabel'],
      emits: ['action'],
      template: '<div role="status">{{ title }} {{ description }}<button v-if="actionLabel" @click="$emit(\'action\')">{{ actionLabel }}</button></div>',
    }),
    KitButton: defineComponent({ template: '<button><slot/></button>' }),
  } },
}

vi.stubGlobal('useRoute', () => route)
vi.stubGlobal('useTabTitle', () => {})
vi.stubGlobal('navigateTo', navigateTo)

describe('甲方最终结算专属只读详情', () => {
  beforeEach(() => {
    route.query = { origin: 'real' }
  })

  beforeEach(() => {
    navigateTo.mockReset()
    mocks.store.loadDetail.mockClear()
    mocks.store.detailState = { kind: 'ready', data: structuredClone(detail) }
  })

  it('展示真实聚合、未知审定额、依据、差异、附件和两类来源单据', () => {
    render(OwnerFinalSettlementDetailScreen, {
      props: { documentId: 'final-settlement-real-325', origin: 'real' },
      ...common,
    })

    expect(screen.getByText(/报审金额.*1,020,000\.00/).textContent).not.toContain('NaN')
    expect(screen.getByText(/审定金额.*未记录/)).not.toBeNull()
    expect(screen.getByText(/变更后合同额.*1,040,000\.00/)).not.toBeNull()
    expect(screen.getByText(/累计收款.*900,000\.00/)).not.toBeNull()
    expect(screen.getByText('施工合同、补充协议与最终结算书')).not.toBeNull()
    expect(screen.getByText('审定金额尚未回传')).not.toBeNull()
    expect(screen.getByText('正式补充协议')).not.toBeNull()
    expect(screen.getByText('一期工程款')).not.toBeNull()
    const sourceRegion = screen.getByRole('region', { name: '最终结算来源单据，可横向滚动查看完整列' })
    expect(sourceRegion.textContent).toContain('已生效')
    expect(sourceRegion.textContent).toContain('已提交')
    expect(screen.getByText('最终结算书.pdf')).not.toBeNull()
    expect(sourceRegion.getAttribute('tabindex')).toBe('0')
    expect(screen.queryByRole('button', { name: '编辑结算' })).toBeNull()
  })

  it('只有可编辑的正式草稿显示显式编辑动作并进入独立表单路由', async () => {
    mocks.store.detailState = {
      kind: 'ready',
      data: { ...structuredClone(detail), document: { ...structuredClone(detail.document), status: 'draft' } },
    }
    render(OwnerFinalSettlementDetailScreen, {
      props: { documentId: 'final-settlement-real-325', origin: 'real' },
      ...common,
    })

    await fireEvent.click(screen.getByRole('button', { name: '编辑结算' }))
    expect(navigateTo).toHaveBeenCalledWith({
      path: '/owner/final-settlement/form/final-settlement-real-325',
      query: { origin: 'real', returnTo: route.fullPath },
    })
  })

  it('未知来源不伪装为空集合，可重新读取，并区分关系不匹配与普通读取失败', async () => {
    mocks.store.detailState = {
      kind: 'ready',
      data: {
        ...structuredClone(detail),
        finalSettlementEvidence: {
          ...structuredClone(detail.finalSettlementEvidence),
          sources: null,
        },
      },
    }
    const rendered = render(OwnerFinalSettlementDetailScreen, {
      props: { documentId: 'final-settlement-real-325', origin: 'real' },
      ...common,
    })

    expect(screen.getByText(/来源事实未读取/)).not.toBeNull()
    mocks.store.loadDetail.mockClear()
    await fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(mocks.store.loadDetail).toHaveBeenCalledTimes(1)
    rendered.unmount()
    mocks.store.detailState = {
      kind: 'mismatch',
      problem: { code: 'relationship-mismatch', message: '单据类型与地址不匹配', retryable: false },
    }
    render(OwnerFinalSettlementDetailScreen, {
      props: { documentId: 'acceptance-real-324', origin: 'real' },
      ...common,
    })
    expect(screen.getByRole('alert').textContent).toContain('单据来源或类型不匹配')
  })

  it('从施工合同进入时返回动作使用来源语义', () => {
    route.query = {
      origin: 'real',
      returnTo: '/contract/construction-contract-existing-320?origin=real&contractKind=construction&tab=settlements',
    }
    render(OwnerFinalSettlementDetailScreen, {
      props: { documentId: 'final-settlement-real-325', origin: 'real' },
      ...common,
    })

    expect(screen.getByText('返回来源详情')).not.toBeNull()
    route.query = { origin: 'real' }
  })
})
