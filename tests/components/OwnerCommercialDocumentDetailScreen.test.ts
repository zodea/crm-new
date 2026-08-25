import { fireEvent, render, screen } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import OwnerCommercialDocumentDetailScreen from '~/components/owner-document/OwnerCommercialDocumentDetailScreen.vue'

const mocks = vi.hoisted(() => ({
  store: {
    detailState: { kind: 'idle' } as any,
    loadDetail: vi.fn().mockResolvedValue(undefined),
  },
}))
vi.mock('~/stores/owner-commercial-document-read', () => ({ useOwnerCommercialDocumentReadStore: () => mocks.store }))
vi.mock('~/stores/data-visibility', () => ({ useDataVisibilityStore: () => ({ includeDemo: true }) }))

const route = reactive({ query: {} as Record<string, string>, fullPath: '/owner/report/report-323?origin=real' })
const navigateTo = vi.fn()
const resolved = (entity: 'project' | 'customer' | 'contract', id: string, label: string) => ({ state: 'resolved', entity, id, label, no: null })
const navigation = (subject: any) => ({ kind: 'entity-detail', subject, variant: 'detail', view: null, filters: { dataOrigin: 'real' } })
const project = resolved('project', 'project-323', '项目一')
const customer = resolved('customer', 'customer-323', '甲方一')
const contract = resolved('contract', 'contract-323', '施工合同一')
const detail = {
  dataOrigin: 'real',
  document: {
    id: 'report-323',
    kind: 'owner_report',
    no: 'BL-2026-08',
    name: '2026 年 8 月月度报量',
    documentType: 'monthly_statement',
    periodNo: '2026-08',
    applicationDate: '2026-08-20',
    status: 'audited',
    source: { type: 'monthly_statement', id: 'report-323', locked: true },
    approval: { status: 'audited', label: '已审定', summary: '甲方已审定' },
    quantityEvidence: {
      basis: 'field',
      sourceVersion: 'monthly-323-v1',
      sourceUpdatedAt: '2026-08-19T08:00:00.000Z',
      operatorName: '周经办',
      submittedAt: '2026-08-20T09:00:00.000Z',
    },
    amounts: { kind: 'owner_report', reported: '5200.00', audited: '4680.00', difference: '-520.00' },
    project,
    customer,
    contract,
    note: '',
    version: '2',
    updatedAt: '2026-08-22T00:00:00.000Z',
  },
  lines: [{
    id: 'line-323',
    boqLineId: 'boq-line-323',
    operation: null,
    itemName: '桥架安装',
    unit: 'm',
    contractQty: '100',
    contractUnitPrice: '52.00',
    autoQty: '100',
    reportedQty: '100',
    auditedQty: '90',
    deltaQty: null,
    newUnitPrice: null,
    amount: '5200.00',
    auditedAmount: '4680.00',
    note: '甲方核减 10m',
  }],
  files: [],
  projectNavigation: navigation(project),
  customerNavigation: navigation(customer),
  contractNavigation: navigation(contract),
  sourceNavigation: { kind: 'entity-detail', subject: { state: 'resolved', entity: 'owner-document', id: 'report-323', label: '月度报量', no: 'BL-2026-08' }, variant: 'report', view: null, filters: { dataOrigin: 'real' } },
  asOf: '2026-08-25T00:00:00.000Z',
  sourceVersion: 'v1',
  capabilities: ['owner-document:read', 'owner-document:write'],
}

const common = {
  global: { components: {
    EntityDetailShell: defineComponent({
      props: ['title', 'state', 'stateDescription'],
      template: '<div><h1>{{ title }}</h1><slot name="status"/><slot name="actions"/><slot name="summary"/><slot v-if="state === \'ready\'"/><div v-else role="alert">{{ stateDescription }}</div></div>',
    }),
    MetricGrid: defineComponent({ template: '<div><slot/></div>' }),
    Metric: defineComponent({ props: ['label', 'value'], template: '<span>{{ label }} {{ value }}</span>' }),
    SectionHeader: defineComponent({ props: ['title', 'subtitle'], template: '<h2>{{ title }} {{ subtitle }}</h2>' }),
    EntityLink: defineComponent({ props: ['label'], template: '<a href="#">{{ label }}</a>' }),
    StatePanel: defineComponent({ props: ['title', 'description'], template: '<div role="status">{{ title }} {{ description }}</div>' }),
  } },
}

vi.stubGlobal('useRoute', () => route)
vi.stubGlobal('useTabTitle', () => {})
vi.stubGlobal('navigateTo', navigateTo)

describe('甲方商务单据中央只读详情', () => {
  beforeEach(() => {
    route.query = {}
    route.fullPath = '/owner/report/report-323?origin=real'
    navigateTo.mockReset()
    mocks.store.loadDetail.mockClear()
    mocks.store.detailState = { kind: 'ready', data: structuredClone(detail) }
  })

  it('月度报量同时展示自动量、申报量、审定量、核减差额与真实空附件', () => {
    render(OwnerCommercialDocumentDetailScreen, { props: { kind: 'owner_report', documentId: 'report-323', origin: 'real' }, ...common })

    expect(screen.getByText('2026 年 8 月月度报量')).not.toBeNull()
    expect(screen.getByText('现场复核量')).not.toBeNull()
    expect(screen.queryByText('field')).toBeNull()
    expect(screen.getByText(/审定差额/).textContent).toContain('¥-520.00')
    expect(screen.getByText('甲方核减 10m')).not.toBeNull()
    expect(screen.getByText(/^暂无附件/)).not.toBeNull()
    expect(screen.getByText('report-323')).not.toBeNull()
    expect(screen.getByText('2026-08-19T08:00:00.000Z')).not.toBeNull()
    expect(screen.queryByTestId('owner-document-edit')).toBeNull()
  })

  it('月度报量无明细时呈现报量专属真实空态，不误称纯金额签证', () => {
    mocks.store.detailState = {
      kind: 'ready',
      data: { ...structuredClone(detail), lines: [] },
    }

    render(OwnerCommercialDocumentDetailScreen, { props: { kind: 'owner_report', documentId: 'report-323', origin: 'real' }, ...common })

    const linesEmpty = screen.getByText(/^暂无量价明细/)
    expect(linesEmpty.textContent).toContain('该月度报量尚未形成有效 BOQ 申报明细')
    expect(linesEmpty.textContent).not.toContain('纯金额签证')
  })

  it('仅正式草稿提供显式整页编辑入口', async () => {
    mocks.store.detailState = {
      kind: 'ready',
      data: { ...structuredClone(detail), document: { ...structuredClone(detail.document), kind: 'owner_change', id: 'change-323', status: 'draft', name: '草稿变更' } },
    }
    render(OwnerCommercialDocumentDetailScreen, { props: { kind: 'owner_change', documentId: 'change-323', origin: 'real' }, ...common })

    await fireEvent.click(screen.getByTestId('owner-document-edit'))
    expect(navigateTo).toHaveBeenCalledWith({
      path: '/owner/change/form/change-323',
      query: { origin: 'real', returnTo: route.fullPath },
    })
  })

  it('已上报变洽签仍可进入整页表单处理签证流转', async () => {
    mocks.store.detailState = {
      kind: 'ready',
      data: {
        ...structuredClone(detail),
        document: {
          ...structuredClone(detail.document),
          kind: 'owner_change',
          id: 'change-submitted-323',
          status: 'submitted',
          name: '已上报变洽签',
        },
      },
    }
    render(OwnerCommercialDocumentDetailScreen, { props: { kind: 'owner_change', documentId: 'change-submitted-323', origin: 'real' }, ...common })

    expect(screen.getByTestId('owner-document-edit').textContent).toContain('处理流转')
    await fireEvent.click(screen.getByTestId('owner-document-edit'))
    expect(navigateTo).toHaveBeenCalledWith(expect.objectContaining({ path: '/owner/change/form/change-submitted-323' }))
  })

  it('来源错配保持独立错误态，不回退为另一类同 ID 详情', () => {
    mocks.store.detailState = {
      kind: 'mismatch',
      problem: { code: 'relationship-mismatch', message: '来源与地址不匹配', retryable: false, fieldErrors: {}, traceId: null },
    }
    render(OwnerCommercialDocumentDetailScreen, { props: { kind: 'owner_report', documentId: 'report-323', origin: 'demo' }, ...common })
    expect(screen.getByRole('alert').textContent).toContain('来源与地址不匹配')
  })
})
