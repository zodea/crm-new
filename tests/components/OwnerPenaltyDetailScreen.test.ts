import { fireEvent, render, screen } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import OwnerPenaltyDetailScreen from '~/pages/owner/[kind]/_components/OwnerPenaltyDetailScreen.vue'

const mocks = vi.hoisted(() => ({
  store: {
    detailState: { kind: 'idle' } as any,
    loadDetail: vi.fn().mockResolvedValue(undefined),
  },
}))
vi.mock('~/stores/owner-commercial-document-read', () => ({ useOwnerCommercialDocumentReadStore: () => mocks.store }))
vi.mock('~/stores/data-visibility', () => ({ useDataVisibilityStore: () => ({ includeDemo: false }) }))

const route = reactive({
  path: '/owner/penalty/owner-penalty-real-326',
  query: { origin: 'real' } as Record<string, string>,
  fullPath: '/owner/penalty/owner-penalty-real-326?origin=real',
})
const navigateTo = vi.fn()
const project = { state: 'resolved', entity: 'project', id: 'project-real-326', label: '瑞航商务中心项目', no: null }
const customer = { state: 'resolved', entity: 'customer', id: 'customer-real-326', label: '瑞航置业', no: null }
const contract = { state: 'resolved', entity: 'contract', id: 'contract-real-326', label: '瑞航商务中心施工合同', no: 'SG-326' }
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
    id: 'owner-penalty-real-326',
    kind: 'owner_penalty',
    no: 'FK-2026-326',
    name: '施工进度延误',
    documentType: 'owner_penalty',
    periodNo: '',
    applicationDate: '2026-08-24',
    approvalDate: null,
    status: 'submitted',
    source: { type: 'owner_penalty', id: 'owner-penalty-real-326', locked: true },
    approval: { status: 'submitted', label: '已提交', summary: '已提交甲方罚扣事实' },
    quantityEvidence: null,
    amounts: { kind: 'owner_penalty', amount: '36000.00' },
    project,
    customer,
    contract,
    note: '项目部已核对',
    version: '1',
    updatedAt: '2026-08-24T10:00:00.000Z',
  },
  lines: [],
  files: [{
    id: 'file-owner-penalty-real-326',
    fileName: '甲方联系单.pdf',
    fileSize: 3260,
    mimeType: 'application/pdf',
    category: 'contact-letter',
    uploader: '周经办',
    uploadedAt: '2026-08-24T10:00:00.000Z',
  }],
  projectNavigation: navigation(project),
  customerNavigation: navigation(customer),
  contractNavigation: navigation(contract),
  sourceNavigation: navigation(contract, 'owner-document-source', 'owner-penalty-real-326'),
  documentNavigation: navigation({
    state: 'resolved',
    entity: 'owner-document',
    id: 'owner-penalty-real-326',
    label: '施工进度延误',
    no: 'FK-2026-326',
  }, 'penalty'),
  acceptanceView: null,
  lifecycleEvents: [],
  finalSettlementEvidence: null,
  ownerPenaltyFacts: {
    noticeNo: 'LX-2026-326',
    penaltyDate: '2026-08-24',
    reason: '施工进度延误',
    appealNote: '已提交工期顺延说明',
  },
  asOf: '2026-08-25T00:00:00.000Z',
  sourceVersion: 'owner-document-command-5',
  capabilities: ['owner-document:read', 'owner-document:write'],
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

describe('甲方罚扣专属只读详情', () => {
  beforeEach(() => {
    route.query = { origin: 'real' }
    navigateTo.mockReset()
    mocks.store.loadDetail.mockClear()
    mocks.store.detailState = { kind: 'ready', data: structuredClone(detail) }
  })

  it('独立展示罚扣金额、事由、联系单、申诉、关系下钻和附件', () => {
    render(OwnerPenaltyDetailScreen, {
      props: { documentId: 'owner-penalty-real-326', origin: 'real' },
      ...common,
    })

    expect(screen.getByText(/-¥36,000\.00/)).not.toBeNull()
    expect(screen.getByText('LX-2026-326')).not.toBeNull()
    expect(screen.getAllByText('施工进度延误').length).toBeGreaterThan(0)
    expect(screen.getByText('已提交工期顺延说明')).not.toBeNull()
    expect(screen.getByText('瑞航商务中心项目')).not.toBeNull()
    expect(screen.getByText('瑞航置业')).not.toBeNull()
    expect(screen.getAllByText('瑞航商务中心施工合同')).toHaveLength(2)
    expect(screen.getByText('甲方联系单.pdf')).not.toBeNull()
    expect(screen.queryByText('项目扣罚')).toBeNull()
    expect(screen.queryByRole('button', { name: '编辑罚扣' })).toBeNull()
  })

  it('只有正式草稿显示编辑动作，详情本身仍保持只读', async () => {
    mocks.store.detailState = {
      kind: 'ready',
      data: { ...structuredClone(detail), document: { ...structuredClone(detail.document), status: 'draft' } },
    }
    render(OwnerPenaltyDetailScreen, {
      props: { documentId: 'owner-penalty-real-326', origin: 'real' },
      ...common,
    })

    await fireEvent.click(screen.getByRole('button', { name: '编辑罚扣' }))
    expect(navigateTo).toHaveBeenCalledWith({
      path: '/owner/penalty/form/owner-penalty-real-326',
      query: { origin: 'real', returnTo: route.fullPath },
    })
  })

  it('关系错配与普通读取失败可区分，可重试错误保留重读入口', async () => {
    mocks.store.detailState = {
      kind: 'mismatch',
      problem: { code: 'relationship-mismatch', message: '单据类型与地址不匹配', retryable: false },
    }
    const rendered = render(OwnerPenaltyDetailScreen, {
      props: { documentId: 'project-penalty-326', origin: 'real' },
      ...common,
    })
    expect(screen.getByRole('alert').textContent).toContain('单据来源或类型不匹配')
    rendered.unmount()

    mocks.store.detailState = {
      kind: 'error',
      problem: { code: 'unavailable', message: '中央读取暂时不可用', retryable: true },
    }
    render(OwnerPenaltyDetailScreen, {
      props: { documentId: 'owner-penalty-real-326', origin: 'real' },
      ...common,
    })
    await fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(mocks.store.loadDetail).toHaveBeenCalled()
  })

  it('从施工合同进入时使用来源返回语义', () => {
    route.query = {
      origin: 'real',
      returnTo: '/contract/construction-contract-existing-320?origin=real&contractKind=construction&tab=settlements',
    }
    render(OwnerPenaltyDetailScreen, {
      props: { documentId: 'owner-penalty-real-326', origin: 'real' },
      ...common,
    })
    expect(screen.getByText('返回来源详情')).not.toBeNull()
  })
})
