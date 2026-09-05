import { fireEvent, render, screen } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import SubcontractSettlementDetailScreen from '~/components/owner-document/SubcontractSettlementDetailScreen.vue'

const mocks = vi.hoisted(() => ({
  store: {
    detailState: { kind: 'idle' } as any,
    loadDetail: vi.fn().mockResolvedValue(undefined),
  },
}))
vi.mock('~/stores/owner-commercial-document-read', () => ({ useOwnerCommercialDocumentReadStore: () => mocks.store }))
vi.mock('~/stores/data-visibility', () => ({ useDataVisibilityStore: () => ({ includeDemo: false }) }))

const route = reactive({
  path: '/subcontract/settlement/sub-settlement-328',
  query: { origin: 'real' } as Record<string, string>,
  fullPath: '/subcontract/settlement/sub-settlement-328?origin=real',
})
const navigateTo = vi.fn()
const project = { state: 'resolved', entity: 'project', id: 'project-328', label: '瑞航商务中心项目', no: null }
const supplier = { state: 'resolved', entity: 'supplier', id: 'supplier-328', label: '联创建筑劳务', no: null }
const contract = { state: 'resolved', entity: 'contract', id: 'subcontract-328', label: '主体劳务分包合同', no: 'FB-328' }
function navigation(subject: any, variant = 'detail', view: string | null = null) {
  return {
    kind: 'entity-detail',
    subject,
    variant,
    view,
    filters: { dataOrigin: 'real' },
  }
}
const detail = {
  dataOrigin: 'real',
  document: {
    id: 'sub-settlement-328',
    kind: 'sub_settlement',
    no: 'FBJS-328',
    name: '八月劳务结算',
    documentType: '过程结算',
    periodNo: '',
    applicationDate: '2026-08-26',
    approvalDate: null,
    status: 'confirmed',
    source: { type: 'expenditure_settlement', id: 'sub-settlement-328', locked: true },
    approval: { status: 'confirmed', label: '已确认', summary: '已确认分包结算事实' },
    quantityEvidence: null,
    amounts: { kind: 'sub_settlement', total: '32000.00', cumulativeSettled: '62000.00', priorSettled: '30000.00', contractAmount: '100000.00', deductions: null, netSettlement: null, cumulativeApplied: null, remainingApplicable: null, cumulativePaid: null, remainingUnpaid: null },
    project,
    customer: { state: 'missing', entity: 'customer', id: null, label: null, reason: 'not-recorded' },
    supplier,
    contract,
    note: '结算已确认',
    version: '2',
    updatedAt: '2026-08-27T09:00:00.000Z',
  },
  lines: [],
  files: [{ id: 'file-328', fileName: '结算单.pdf', fileSize: 3280, mimeType: 'application/pdf', category: 'change-evidence', uploader: '周经办', uploadedAt: '2026-08-26T10:00:00.000Z' }],
  projectNavigation: navigation(project),
  customerNavigation: { kind: 'unavailable', reason: 'missing-id' },
  supplierNavigation: navigation(supplier),
  contractNavigation: navigation(contract),
  sourceNavigation: navigation(contract, 'subcontract-document-source', 'sub-settlement-328'),
  documentNavigation: navigation({ state: 'resolved', entity: 'subcontract-document', id: 'sub-settlement-328', label: '八月劳务结算', no: 'FBJS-328' }, 'settlement'),
  acceptanceView: null,
  lifecycleEvents: [],
  finalSettlementEvidence: null,
  ownerPenaltyFacts: null,
  asOf: '2026-08-27T09:00:00.000Z',
  sourceVersion: 'owner-document-command-7',
  capabilities: ['subcontract-document:read', 'subcontract-document:write'],
}

const common = {
  global: { components: {
    EntityDetailShell: defineComponent({
      props: ['title', 'backLabel', 'state', 'stateTitle', 'stateDescription', 'stateActionLabel'],
      emits: ['stateAction'],
      template: '<div><h1>{{ title }}</h1><span>{{ backLabel }}</span><slot name="status"/><slot name="actions"/><slot name="summary"/><slot v-if="state === \'ready\'"/><div v-else role="alert">{{ stateTitle }} {{ stateDescription }}<button v-if="stateActionLabel" @click="$emit(\'stateAction\')">{{ stateActionLabel }}</button></div></div>',
    }),
    MetricGrid: defineComponent({ template: '<div><slot/></div>' }),
    Metric: defineComponent({ props: ['label', 'value'], template: '<span>{{ label }} {{ value }}</span>' }),
    SectionHeader: defineComponent({ props: ['title', 'subtitle'], template: '<h2>{{ title }} {{ subtitle }}</h2>' }),
    EntityLink: defineComponent({ props: ['label', 'intent'], template: '<a href="#">{{ intent?.subject?.label ?? label }}</a>' }),
    StatePanel: defineComponent({ props: ['title', 'description'], template: '<div role="status">{{ title }} {{ description }}</div>' }),
  } },
}

vi.stubGlobal('useRoute', () => route)
vi.stubGlobal('useTabTitle', () => {})
vi.stubGlobal('navigateTo', navigateTo)

describe('分包结算专属只读详情', () => {
  beforeEach(() => {
    route.query = { origin: 'real' }
    route.fullPath = '/subcontract/settlement/sub-settlement-328?origin=real'
    navigateTo.mockReset()
    mocks.store.loadDetail.mockClear()
    mocks.store.detailState = { kind: 'ready', data: structuredClone(detail) }
  })

  it('展示稳定关系、结算累计、未知付款、附件与来源', () => {
    render(SubcontractSettlementDetailScreen, { props: { documentId: 'sub-settlement-328', origin: 'real' }, ...common })

    expect(screen.getAllByText('八月劳务结算')).toHaveLength(2)
    expect(screen.getByText(/含税结算额/).textContent).toContain('¥32,000.00')
    expect(screen.getByText(/累计已确认结算/).textContent).toContain('¥62,000.00')
    expect(screen.getByRole('group', { name: '累计已付' }).textContent).toContain('未记录')
    expect(screen.getByText('瑞航商务中心项目')).not.toBeNull()
    expect(screen.getByText('联创建筑劳务')).not.toBeNull()
    expect(screen.getAllByText('主体劳务分包合同')).toHaveLength(2)
    expect(screen.getByText('结算单.pdf')).not.toBeNull()
    expect(screen.getByText('过程结算')).not.toBeNull()
    expect(screen.getByText('结算已确认')).not.toBeNull()
    expect(screen.queryByRole('button', { name: '编辑结算' })).toBeNull()
  })

  it('仅正式可编辑状态提供显式整页编辑入口', async () => {
    mocks.store.detailState = { kind: 'ready', data: { ...structuredClone(detail), document: { ...structuredClone(detail.document), status: 'draft' } } }
    render(SubcontractSettlementDetailScreen, { props: { documentId: 'sub-settlement-328', origin: 'real' }, ...common })

    await fireEvent.click(screen.getByRole('button', { name: '编辑结算' }))
    expect(navigateTo).toHaveBeenCalledWith({
      path: '/subcontract/settlement/form/sub-settlement-328',
      query: { origin: 'real', returnTo: route.fullPath },
    })
  })

  it('区分关系错配与可重试读取失败', async () => {
    mocks.store.detailState = { kind: 'mismatch', problem: { code: 'relationship-mismatch', message: '分包关系不匹配', retryable: false } }
    const rendered = render(SubcontractSettlementDetailScreen, { props: { documentId: 'sub-settlement-other', origin: 'real' }, ...common })
    expect(screen.getByRole('alert').textContent).toContain('单据来源或关系不匹配')
    rendered.unmount()

    mocks.store.detailState = { kind: 'error', problem: { code: 'unavailable', message: '中央读取暂时不可用', retryable: true } }
    render(SubcontractSettlementDetailScreen, { props: { documentId: 'sub-settlement-328', origin: 'real' }, ...common })
    await fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(mocks.store.loadDetail).toHaveBeenCalled()
  })

  it('没有附件时显示真实空态，并采用来源返回语义', () => {
    route.query = { origin: 'real', returnTo: '/contract/subcontract-328?origin=real&contractKind=subcontract&tab=settlements&focus=sub-settlement-328' }
    mocks.store.detailState = { kind: 'ready', data: { ...structuredClone(detail), files: [] } }
    render(SubcontractSettlementDetailScreen, { props: { documentId: 'sub-settlement-328', origin: 'real' }, ...common })
    expect(screen.getByText(/^暂无附件/)).not.toBeNull()
    expect(screen.getByText('返回来源详情')).not.toBeNull()
  })
})
