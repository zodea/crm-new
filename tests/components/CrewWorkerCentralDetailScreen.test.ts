import { render, screen, waitFor } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import CrewWorkerCentralDetailScreen from '~/components/crew-worker/CrewWorkerCentralDetailScreen.vue'

const store = vi.hoisted(() => ({
  crewDetailState: { kind: 'idle' } as any,
  workerDetailState: { kind: 'idle' } as any,
  loadCrewDetail: vi.fn().mockResolvedValue(undefined),
  loadWorkerDetail: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('~/stores/crew-worker-read', () => ({ useCrewWorkerReadStore: () => store }))
vi.stubGlobal('useTabTitle', () => {})
vi.stubGlobal('useRoute', () => ({ fullPath: '/base/worker/worker-1?origin=real', query: {} }))

const resolved = (entity: string, id: string, label: string) => ({ state: 'resolved' as const, entity, id, label, no: null })
const nav = (subject: ReturnType<typeof resolved>, variant = 'detail') => ({ kind: 'entity-detail' as const, subject, variant, view: null, filters: { dataOrigin: 'real' } })
const workerDetail = {
  dataOrigin: 'real' as const,
  worker: {
    dataOrigin: 'real' as const,
    id: 'worker-1',
    crewId: 'crew-1',
    currentProjectId: 'project-1',
    linkedWorkerId: null,
    name: '张师傅',
    gender: '男',
    trade: '泥工',
    tradeCapabilities: ['泥工'],
    itemCapabilities: ['墙砖'],
    phone: '138****5678',
    idCard: '4401**********1234',
    hometown: '广东',
    emergencyContact: '家属',
    emergencyPhone: '139****1234',
    skillLevel: '熟练',
    dailyWage: 360,
    familyGroupId: null,
    projectStatus: '在场',
    entryDate: '2026-08-01',
    exitDate: null,
    safetyEducation: true,
    bankName: '示例银行',
    bankAccount: '6222 **** 5678',
    bankCode: '',
    note: '',
    status: 'submitted',
    updatedAt: '2026-08-23T00:00:00.000Z',
  },
  crew: { crew: resolved('crew', 'crew-1', '中央泥水班组'), navigation: nav(resolved('crew', 'crew-1', '中央泥水班组')), trade: '泥工', contactName: '陈师傅', contactPhone: '138****0000' },
  capabilitiesDetail: { trades: ['泥工'], itemNames: ['墙砖'] },
  relatedWorkers: [],
  projects: [],
  assignments: [{ id: 'assignment-1', project: resolved('project', 'project-1', '中央项目'), projectNavigation: nav(resolved('project', 'project-1', '中央项目')), unit: resolved('quantity-unit', 'unit-1', '201户'), navigation: { ...nav(resolved('quantity-unit', 'unit-1', '201户')), filters: { dataOrigin: 'real', projectId: 'project-1' } }, buildingName: '1栋', floorName: '2层', trade: '泥工', note: '', completedStageCount: 2, scopes: [{ roomName: '客厅', itemName: '墙砖' }] }],
  attendance: [],
  daywork: [],
  wageStatements: [{ statement: resolved('wage-statement', 'wage-1', '2026-07工资单'), navigation: nav(resolved('wage-statement', 'wage-1', '2026-07工资单')), project: resolved('project', 'project-1', '中央项目'), projectNavigation: nav(resolved('project', 'project-1', '中央项目')), month: '2026-07', status: 'released', statementGrossAmount: '12600.00', statementActualAmount: '10080.00', workerLineAmount: '2800.00', allocatedAmount: null, allocationRecorded: false }],
  penalties: [{ penalty: resolved('subcontract-document', 'penalty-1', 'FK-001'), navigation: nav(resolved('subcontract-document', 'penalty-1', 'FK-001'), 'penalty-detail'), project: resolved('project', 'project-1', '中央项目'), projectNavigation: nav(resolved('project', 'project-1', '中央项目')), source: 'project', location: '1栋/201', reason: '成品保护', amount: '200.00', penaltyDate: '2026-08-20', status: 'deducted' }],
  summary: { projectCount: 1, assignedUnitCount: 1, completedStageCount: 2, attendanceDays: 0, attendanceHours: 0, overtimeHours: 0, confirmedDayworkUnits: 0, releasedStatementCount: 1, knownAllocatedAmount: '0.00', missingAllocationCount: 1, penaltyAmount: '200.00' },
  asOf: '2026-08-23T00:00:00.000Z',
  sourceVersion: 'v1',
  capabilities: ['worker:list:read', 'worker:write'],
}

const shell = defineComponent({ props: ['title'], template: '<main><h1 data-entity-detail-title tabindex="-1">{{ title }}</h1><slot name="actions"/><slot name="summary"/><slot/></main>' })
const entityLink = defineComponent({ props: ['label'], template: '<a>{{ label }}</a>' })

describe('班组—工人中央详情', () => {
  beforeEach(() => {
    store.workerDetailState = { kind: 'ready', data: workerDetail }
    store.crewDetailState = { kind: 'idle' }
    store.loadWorkerDetail.mockClear()
  })

  it('按稳定身份展示班组、责任单元、工资与扣罚，并保留未知工资分配', async () => {
    render(CrewWorkerCentralDetailScreen, {
      props: { kind: 'worker', id: 'worker-1', origin: 'real', includeDemo: false },
      global: { components: {
        EntityDetailShell: shell,
        EntityLink: entityLink,
        SectionHeader: defineComponent({ props: ['title'], template: '<h2>{{ title }}</h2>' }),
        MetricGrid: defineComponent({ template: '<div><slot/></div>' }),
        Metric: defineComponent({ props: ['label', 'value'], template: '<span>{{ label }}：{{ value }}</span>' }),
        NuxtLink: defineComponent({ props: ['to'], template: '<a :href="to"><slot/></a>' }),
      } },
    })

    await waitFor(() => expect(store.loadWorkerDetail).toHaveBeenCalledWith({ id: 'worker-1', origin: 'real', includeDemo: false }))
    expect(screen.getByText('138****5678')).not.toBeNull()
    expect(screen.getByText('4401**********1234')).not.toBeNull()
    expect(screen.getByText('中央泥水班组')).not.toBeNull()
    expect(screen.getByText('201户')).not.toBeNull()
    expect(screen.getByText('2026-07工资单')).not.toBeNull()
    expect(screen.getByText('FK-001')).not.toBeNull()
    expect(screen.getByText('历史未记录')).not.toBeNull()
    expect(screen.getByRole('link', { name: '编辑' }).getAttribute('href')).toBe('/base/worker/form/worker-1?origin=real')
  })

  it('身份切换的新请求完成前不展示全局 store 中的上一个工人', async () => {
    store.loadWorkerDetail.mockImplementationOnce(() => new Promise(() => {}))
    render(CrewWorkerCentralDetailScreen, {
      props: { kind: 'worker', id: 'worker-2', origin: 'real', includeDemo: false },
      global: { components: {
        EntityDetailShell: shell,
        EntityLink: entityLink,
        SectionHeader: defineComponent({ props: ['title'], template: '<h2>{{ title }}</h2>' }),
        MetricGrid: defineComponent({ template: '<div><slot/></div>' }),
        Metric: defineComponent({ props: ['label', 'value'], template: '<span>{{ label }}：{{ value }}</span>' }),
        NuxtLink: defineComponent({ props: ['to'], template: '<a :href="to"><slot/></a>' }),
      } },
    })

    await waitFor(() => expect(store.loadWorkerDetail).toHaveBeenCalledWith({ id: 'worker-2', origin: 'real', includeDemo: false }))
    expect(screen.queryByText('张师傅')).toBeNull()
    expect(screen.queryByText('138****5678')).toBeNull()
  })
})
