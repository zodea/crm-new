import { fireEvent, render, screen } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import OwnerAcceptanceDetailScreen from '~/components/owner-document/OwnerAcceptanceDetailScreen.vue'

const mocks = vi.hoisted(() => ({
  store: {
    detailState: { kind: 'idle' } as any,
    loadDetail: vi.fn().mockResolvedValue(undefined),
  },
}))
vi.mock('~/stores/owner-commercial-document-read', () => ({ useOwnerCommercialDocumentReadStore: () => mocks.store }))
vi.mock('~/stores/data-visibility', () => ({ useDataVisibilityStore: () => ({ includeDemo: false }) }))

const route = reactive({
  path: '/owner/acceptance/acceptance-real-324',
  query: { origin: 'real', variant: 'acceptance' } as Record<string, string>,
  fullPath: '/owner/acceptance/acceptance-real-324?origin=real&variant=acceptance',
})
const navigateTo = vi.fn()
const project = { state: 'resolved', entity: 'project', id: 'project-real-324', label: '瑞航商务中心项目', no: null }
const contract = { state: 'resolved', entity: 'contract', id: 'contract-real-324', label: '瑞航商务中心施工合同', no: 'SG-324' }
const navigation = (subject: any) => ({ kind: 'entity-detail', subject, variant: 'detail', view: null, filters: { dataOrigin: 'real' } })

const baseDetail = {
  dataOrigin: 'real',
  document: {
    id: 'acceptance-real-324',
    kind: 'acceptance',
    no: 'YS-2026-324',
    name: '瑞航商务中心项目竣工验收',
    documentType: 'acceptance_lifecycle',
    periodNo: '',
    applicationDate: '2026-07-17',
    approvalDate: null,
    status: 'warranty',
    source: { type: 'manual', id: 'acceptance-real-324', locked: true },
    approval: { status: 'warranty', label: '保修中', summary: '保修中' },
    quantityEvidence: null,
    amounts: { kind: 'acceptance', contractEstimate: '1200000.00' },
    project,
    customer: { state: 'missing', entity: 'customer', id: null, label: null, reason: 'not-recorded' },
    contract,
    note: '同一记录贯穿验收与保修',
    version: '3',
    updatedAt: '2026-07-19T09:00:00.000Z',
  },
  lines: [],
  projectNavigation: navigation(project),
  customerNavigation: { kind: 'unavailable', reason: 'missing-id' },
  contractNavigation: navigation(contract),
  sourceNavigation: { kind: 'entity-detail', subject: contract, variant: 'owner-document-source', view: 'acceptance-real-324', filters: { dataOrigin: 'real', contractKind: '施工', ownerTab: 'acceptance' } },
  documentNavigation: { kind: 'entity-detail', subject: { state: 'resolved', entity: 'owner-document', id: 'acceptance-real-324', label: '瑞航商务中心项目竣工验收', no: 'YS-2026-324' }, variant: 'acceptance', view: null, filters: { dataOrigin: 'real' } },
  lifecycleEvents: [{
    id: 'event-warranty-324',
    action: 'start-warranty',
    fromStatus: 'accepted',
    toStatus: 'warranty',
    actorId: 'actor-324',
    actorName: '周经办',
    occurredAt: '2026-07-19T09:00:00.000Z',
    note: '进入保修跟踪',
  }],
  asOf: '2026-08-25T00:00:00.000Z',
  sourceVersion: 'owner-document-command-3',
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
    KitButton: defineComponent({ template: '<button><slot/></button>' }),
  } },
}

vi.stubGlobal('useRoute', () => route)
vi.stubGlobal('useTabTitle', () => {})
vi.stubGlobal('navigateTo', navigateTo)

describe('验收—保修 canonical 双视图详情', () => {
  beforeEach(() => {
    navigateTo.mockReset()
    mocks.store.loadDetail.mockClear()
  })

  it('验收视图只展示验收事实和验收附件，并保留生命周期审计', async () => {
    mocks.store.detailState = {
      kind: 'ready',
      data: {
        ...structuredClone(baseDetail),
        acceptanceView: {
          variant: 'acceptance',
          organization: '建设、监理、施工联合验收组',
          person: '周验收',
          date: '2026-07-18',
          conclusion: '验收合格',
        },
        files: [{ id: 'file-acceptance-324', fileName: '竣工验收报告.pdf', fileSize: 324, mimeType: 'application/pdf', category: 'acceptance-report', uploader: '周经办', uploadedAt: '2026-07-18T10:00:00.000Z' }],
      },
    }
    render(OwnerAcceptanceDetailScreen, { props: { documentId: 'acceptance-real-324', origin: 'real', variant: 'acceptance' }, ...common })

    expect(screen.getByTestId('acceptance-variant-facts').textContent).toContain('建设、监理、施工联合验收组')
    expect(screen.queryByTestId('warranty-variant-facts')).toBeNull()
    expect(screen.getByText('竣工验收报告.pdf')).not.toBeNull()
    expect(screen.getByText('进入保修')).not.toBeNull()
    expect(screen.getByText('acceptance-real-324')).not.toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '保修到期确认' }))
    expect(navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      path: route.path,
      query: expect.objectContaining({ variant: 'warranty' }),
    }))
  })

  it('保修视图只展示保修事实和保修附件，并可进入同一记录的流转表单', async () => {
    mocks.store.detailState = {
      kind: 'ready',
      data: {
        ...structuredClone(baseDetail),
        documentNavigation: { ...baseDetail.documentNavigation, variant: 'warranty' },
        acceptanceView: {
          variant: 'warranty',
          owner: '瑞航建设工程有限公司',
          startDate: '2026-07-19',
          endDate: '2028-07-18',
          confirmationOrganization: null,
          confirmationDate: null,
          confirmationNote: '',
        },
        files: [{ id: 'file-warranty-324', fileName: '保修跟踪清单.pdf', fileSize: 2048, mimeType: 'application/pdf', category: 'warranty-confirmation', uploader: '周经办', uploadedAt: '2026-07-19T10:00:00.000Z' }],
      },
    }
    render(OwnerAcceptanceDetailScreen, { props: { documentId: 'acceptance-real-324', origin: 'real', variant: 'warranty' }, ...common })

    expect(screen.getByTestId('warranty-variant-facts').textContent).toContain('瑞航建设工程有限公司')
    expect(screen.queryByTestId('acceptance-variant-facts')).toBeNull()
    expect(screen.getByText('保修跟踪清单.pdf')).not.toBeNull()
    expect(screen.getByRole('link', { name: '查看合同验收行' })).not.toBeNull()
    await fireEvent.click(screen.getByTestId('owner-acceptance-process'))
    expect(navigateTo).toHaveBeenCalledWith({
      path: '/owner/acceptance/form/acceptance-real-324',
      query: { origin: 'real', returnTo: route.fullPath },
    })
  })
})
