import type { ProjectDetailReadDTO } from '~/lib/project/repository'
import { fireEvent, render, screen, within } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import ProjectDetailScreen from '~/components/project/ProjectDetailScreen.vue'
import { projectProblem, ProjectRepositoryProblem } from '~/lib/project/repository'

const detail: ProjectDetailReadDTO = {
  item: {
    dataOrigin: 'demo',
    project: { state: 'resolved', entity: 'project', id: 'project-1', label: '合和新城', no: 'HHXC-01' },
    navigation: {
      kind: 'entity-detail',
      subject: { state: 'resolved', entity: 'project', id: 'project-1', label: '合和新城', no: 'HHXC-01' },
      variant: 'detail',
      view: null,
      filters: { dataOrigin: 'demo' },
    },
    code: 'HHXC-01',
    status: '施工中',
    contractAmount: '32000000.00',
    operationType: '自营',
    startDate: '2026-01-01',
    plannedEnd: '2026-12-31',
    actualEnd: null,
    plannedDuration: 365,
    manager: '陈志强',
    execManager: '李执行',
    builder: '王施工',
    customer: { state: 'resolved', entity: 'customer', id: 'customer-1', label: '广州合和置业', no: null },
    secondaryCustomer: { state: 'missing', entity: 'customer', id: null, label: null, reason: 'not-configured' },
    contractName: '合和新城精装修工程',
    contractor: '广州睿瑛装饰',
    region: '华南',
    riskLevel: '低',
    address: '广州市天河区',
    income: {
      value: '25367027.00',
      unit: 'CNY',
      status: 'complete',
      missingSources: [],
      asOf: '2026-08-15T00:00:00.000Z',
      drilldown: null,
    },
    budget: {
      value: '800000.00',
      unit: 'CNY',
      status: 'complete',
      missingSources: [],
      asOf: '2026-08-15T00:00:00.000Z',
      drilldown: null,
    },
    updatedAt: '2026-07-30T00:00:00.000Z',
  },
  materialContracts: {
    count: {
      value: 1,
      unit: 'count',
      status: 'complete',
      missingSources: [],
      asOf: '2026-08-15T00:00:00.000Z',
      drilldown: { entity: 'contract', filters: { projectId: 'project-1', dataOrigin: 'demo', contractKind: '材采' } },
    },
    navigation: {
      kind: 'entity-list',
      entity: 'contract',
      variant: 'material',
      view: null,
      filters: { projectId: 'project-1', dataOrigin: 'demo' },
    },
  },
  projectSuppliers: {
    access: 'allowed',
    items: [{
      relationId: 'ps-1',
      supplier: { state: 'resolved', entity: 'supplier', id: 'supplier-1', label: '华东建材', no: null },
      navigation: {
        kind: 'entity-subview',
        subject: { state: 'resolved', entity: 'project', id: 'project-1', label: '合和新城', no: 'HHXC-01' },
        variant: 'supplier-workbench',
        view: 'overview',
        filters: { supplierId: 'supplier-1', dataOrigin: 'demo' },
      },
    }],
    empty: null,
  },
  asOf: '2026-08-15T00:00:00.000Z',
  sourceVersion: 'detail-v1',
  capabilities: ['project:list:read', 'demo:read'],
}

const get = vi.fn()
const ownerList = vi.fn()

function ownerPage(total = 0) {
  return {
    items: [],
    pagination: { page: 1, pageSize: 10, total },
    summary: {
      origins: {
        real: {
          reportedAmount: `${total}.00`,
          subcontractApprovedAmount: `${total}.00`,
          subcontractActualApproved: { value: `${total * 10}.00`, status: 'complete' },
        },
      },
    },
  }
}

const NuxtLinkStub = defineComponent({
  props: { to: { type: [String, Object], required: true } },
  setup(props, { slots }) {
    return () => h('a', {
      href: typeof props.to === 'string' ? props.to : JSON.stringify(props.to),
    }, slots.default?.())
  },
})

const StatePanelStub = defineComponent({
  props: ['kind', 'title', 'description', 'actionLabel'],
  emits: ['action'],
  template: '<section :role="kind === \'error\' ? \'alert\' : \'status\'" :aria-label="title"><h2>{{ title }}</h2><p>{{ description }}</p><button v-if="actionLabel" type="button" @click="$emit(\'action\')">{{ actionLabel }}</button><slot name="action" /></section>',
})

function renderDetail(props: Record<string, unknown>) {
  return render(ProjectDetailScreen, {
    props: { projectId: 'project-1', ...props },
    global: {
      components: {
        NuxtLink: NuxtLinkStub,
        ProjectDetailTab: defineComponent({
          props: ['project'],
          template: '<section aria-label="中央详情字段">{{ project.name }}</section>',
        }),
        ProjectSupplierLinksPanel: defineComponent({
          props: ['relationships'],
          template: '<aside aria-label="中央项目分供方">{{ relationships.length }} 家</aside>',
        }),
        StatePanel: StatePanelStub,
      },
    },
  })
}

vi.stubGlobal('useNuxtApp', () => ({
  $repositories: {
    projectList: { get, list: vi.fn() },
    ownerCommercialDocumentRead: { list: ownerList },
  },
}))
vi.stubGlobal('useProjectCommandStore', () => ({ latestWrite: null }))
vi.stubGlobal('useProjectSupplierCommandStore', () => ({ latestWrite: null }))
vi.stubGlobal('useTabTitle', () => {})

describe('项目详情中央来源边界', () => {
  beforeEach(() => {
    get.mockReset()
    ownerList.mockReset()
    ownerList.mockResolvedValue(ownerPage())
  })

  it('由 Repository 返回权威来源，并只呈现演示只读详情', async () => {
    get.mockResolvedValue(detail)
    renderDetail({ originHint: 'demo', includeDemo: true })

    const heading = await screen.findByRole('heading', { name: '合和新城' })
    await vi.waitFor(() => expect(document.activeElement).toBe(heading))
    expect(get).toHaveBeenCalledWith({ id: 'project-1', origin: 'demo', includeDemo: true })
    expect(screen.getByRole('status', { name: '测试数据只读详情' }).textContent).toContain('测试数据仅供查看')
    expect(screen.getByRole('complementary', { name: '中央项目分供方' }).textContent).toContain('1 家')
    expect(screen.queryByRole('link', { name: '编辑项目' })).toBeNull()
    expect(screen.queryByRole('button', { name: '导出项目档案包' })).toBeNull()
    expect(document.querySelector('[data-project-module]')).toBeNull()
    const materialJourney = screen.getByRole('link', { name: '查看材料采购合同（1）' }).getAttribute('href')
    expect(screen.getByRole('link', { name: '查看材料采购合同（1）' }).getAttribute('id')).toBe('project-material-contract-link')
    expect(materialJourney).toContain('/contract/material?projectId=project-1&origin=demo')
    expect(materialJourney).toContain('materialJourney%3Dorigin_')
    expect(materialJourney).toContain('%23project-material-contract-link')
    expect(screen.getByRole('status', { name: '演示项目不提供正式项目商务单据' })).not.toBeNull()
    expect(screen.queryByRole('status', { name: '正在读取项目商务单据' })).toBeNull()
  })

  it('客户返回链必须同时匹配中央项目的父客户 ID', async () => {
    get.mockResolvedValue(detail)
    const validReturnTo = '/base/customer/customer-1?origin=demo&tab=receipts'
    const valid = renderDetail({
      originHint: 'demo',
      includeDemo: true,
      returnTo: '/project',
      customerReturnTo: validReturnTo,
    })
    expect((await screen.findByRole('link', { name: '返回客户详情' })).getAttribute('href')).toBe(validReturnTo)
    valid.unmount()

    get.mockResolvedValue(detail)
    renderDetail({
      originHint: 'demo',
      includeDemo: true,
      returnTo: '/project',
      customerReturnTo: '/base/customer/customer-2?origin=demo&tab=receipts',
    })
    expect((await screen.findByRole('link', { name: '返回项目列表' })).getAttribute('href')).toBe('/project')
    expect(screen.queryByRole('link', { name: '返回客户详情' })).toBeNull()
  })

  it('材采真实零值仍提供入口，未知与禁止状态不生成蓝链', async () => {
    get.mockResolvedValue({
      ...detail,
      materialContracts: {
        ...detail.materialContracts,
        count: { ...detail.materialContracts.count, value: 0 },
      },
    })
    const { unmount } = renderDetail({ originHint: 'demo', includeDemo: true })
    expect(await screen.findByRole('link', { name: '查看材料采购合同（0）' })).not.toBeNull()
    unmount()

    get.mockResolvedValue({
      ...detail,
      materialContracts: {
        count: { ...detail.materialContracts.count, value: null, status: 'pending', drilldown: null },
        navigation: { kind: 'unavailable', reason: 'forbidden' },
      },
    })
    renderDetail({ originHint: 'demo', includeDemo: true })
    expect(await screen.findByText('无材料采购合同查看权限')).not.toBeNull()
    expect(screen.queryByRole('link', { name: /材料采购合同/ })).toBeNull()
  })

  it('材采聚合读取错误保持可重试，重试成功后恢复真实入口', async () => {
    get
      .mockResolvedValueOnce({
        ...detail,
        materialContracts: {
          count: { ...detail.materialContracts.count, value: null, status: 'pending', drilldown: null },
          navigation: { kind: 'unavailable', reason: 'error' },
        },
      })
      .mockResolvedValueOnce(detail)
    renderDetail({ originHint: 'demo', includeDemo: true })

    const failure = await screen.findByRole('alert', { name: '材料采购合同读取失败' })
    await fireEvent.click(within(failure).getByRole('button', { name: '重试' }))

    expect(await screen.findByRole('link', { name: '查看材料采购合同（1）' })).not.toBeNull()
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('正式项目且有写权限时提供显式来源的编辑入口', async () => {
    get.mockResolvedValue({
      ...detail,
      item: { ...detail.item, dataOrigin: 'real' },
      capabilities: ['project:list:read', 'project:write'],
    })
    renderDetail({ originHint: 'real', includeDemo: false })

    const link = await screen.findByRole('link', { name: '编辑项目' })
    expect(link.getAttribute('href')).toBe('/project/form/project-1?origin=real')
  })

  it('快速切换项目时忽略较晚返回的旧项目甲方商务聚合', async () => {
    const detailFor = (id: string): ProjectDetailReadDTO => ({
      ...detail,
      item: {
        ...detail.item,
        dataOrigin: 'real',
        project: { ...detail.item.project, id, label: id },
      },
    })
    get.mockImplementation(({ id }: { id: string }) => Promise.resolve(detailFor(id)))
    const pending: Array<{ projectId: string, resolve: (value: ReturnType<typeof ownerPage>) => void }> = []
    ownerList.mockImplementation(({ projectId }: { projectId: string }) => new Promise((resolve) => {
      pending.push({ projectId, resolve })
    }))
    const rendered = renderDetail({ originHint: 'real', includeDemo: false })
    await screen.findByRole('heading', { name: 'project-1' })
    await rendered.rerender({ projectId: 'project-2', originHint: 'real', includeDemo: false })
    await screen.findByRole('heading', { name: 'project-2' })

    for (const request of pending.filter(entry => entry.projectId === 'project-2'))
      request.resolve(ownerPage(2))
    await screen.findAllByText('2')
    for (const request of pending.filter(entry => entry.projectId === 'project-1'))
      request.resolve(ownerPage(9))
    await Promise.resolve()

    expect(screen.queryByText('9')).toBeNull()
    expect(screen.getAllByText('2')).toHaveLength(9)
  })

  it('正式项目按同一 canonical 来源提供甲方六类单据及分包变洽签、结算入口', async () => {
    get.mockResolvedValue({
      ...detail,
      item: { ...detail.item, dataOrigin: 'real' },
    })
    ownerList.mockResolvedValue(ownerPage(1))
    renderDetail({
      originHint: 'real',
      includeDemo: false,
      currentRoute: '/project/project-1?origin=real',
    })

    const acceptance = await screen.findByRole('link', { name: /竣工验收/ })
    const warranty = screen.getByRole('link', { name: /保修管理/ })
    const finalSettlement = screen.getByRole('link', { name: /最终结算/ })
    const penalty = screen.getByRole('link', { name: /甲方罚扣/ })
    const subcontractChange = screen.getByRole('link', { name: /分包变洽签/ })
    const projectPenalty = screen.getByRole('link', { name: /项目罚扣/ })
    expect(projectPenalty.getAttribute('href')).toContain('/project/penalty?')
    expect(projectPenalty.getAttribute('href')).toContain('projectId=project-1')
    const subcontractSettlement = screen.getByRole('link', { name: /分包结算/ })
    expect(subcontractSettlement.getAttribute('href')).toContain('/subcontract/settlement?')
    expect(subcontractSettlement.getAttribute('href')).toContain('projectId=project-1')
    expect(subcontractSettlement.id).toBe('project-owner-document-card-sub-settlement')
    expect(acceptance.getAttribute('href')).toContain('/owner/acceptance?')
    expect(acceptance.getAttribute('href')).toContain('variant=acceptance')
    expect(warranty.getAttribute('href')).toContain('/owner/acceptance?')
    expect(warranty.getAttribute('href')).toContain('variant=warranty')
    const acceptanceReturnTo = new URL(acceptance.getAttribute('href')!, 'https://ruihang.invalid').searchParams.get('returnTo')
    const warrantyReturnTo = new URL(warranty.getAttribute('href')!, 'https://ruihang.invalid').searchParams.get('returnTo')
    expect(acceptanceReturnTo).toContain('/project/project-1?origin=real&ownerJourney=origin_')
    expect(acceptanceReturnTo).toMatch(/#project-owner-document-card-acceptance$/)
    expect(warrantyReturnTo).toContain('/project/project-1?origin=real&ownerJourney=origin_')
    expect(warrantyReturnTo).toMatch(/#project-owner-document-card-warranty$/)
    expect(acceptance.getAttribute('id')).toBe('project-owner-document-card-acceptance')
    expect(warranty.getAttribute('id')).toBe('project-owner-document-card-warranty')
    expect(finalSettlement.getAttribute('href')).toContain('/owner/final-settlement?')
    expect(finalSettlement.getAttribute('href')).toContain('projectId=project-1')
    const finalSettlementReturnTo = new URL(finalSettlement.getAttribute('href')!, 'https://ruihang.invalid').searchParams.get('returnTo')
    expect(finalSettlementReturnTo).toContain('/project/project-1?origin=real&ownerJourney=origin_')
    expect(finalSettlementReturnTo).toMatch(/#project-owner-document-card-final-settlement$/)
    expect(finalSettlement.getAttribute('id')).toBe('project-owner-document-card-final-settlement')
    expect(penalty.getAttribute('href')).toContain('/owner/penalty?')
    expect(penalty.getAttribute('href')).toContain('projectId=project-1')
    const penaltyReturnTo = new URL(penalty.getAttribute('href')!, 'https://ruihang.invalid').searchParams.get('returnTo')
    expect(penaltyReturnTo).toContain('/project/project-1?origin=real&ownerJourney=origin_')
    expect(penaltyReturnTo).toMatch(/#project-owner-document-card-penalty$/)
    expect(penalty.getAttribute('id')).toBe('project-owner-document-card-penalty')
    expect(subcontractChange.getAttribute('href')).toContain('/subcontract/change?')
    expect(subcontractChange.getAttribute('href')).toContain('projectId=project-1')
    const subcontractReturnTo = new URL(subcontractChange.getAttribute('href')!, 'https://ruihang.invalid').searchParams.get('returnTo')
    expect(subcontractReturnTo).toContain('/project/project-1?origin=real&ownerJourney=origin_')
    expect(subcontractReturnTo).toMatch(/#project-owner-document-card-sub-change$/)
    expect(subcontractChange.getAttribute('id')).toBe('project-owner-document-card-sub-change')
    expect(subcontractChange.textContent).toContain('实际审定价 ¥10.00')
    expect(ownerList).toHaveBeenCalledWith(expect.objectContaining({ kind: 'sub_change', projectId: 'project-1' }))
  })

  it('缺少分包单据权限时仍保留已授权的六张甲方单据卡片', async () => {
    get.mockResolvedValue({
      ...detail,
      item: { ...detail.item, dataOrigin: 'real' },
    })
    ownerList.mockImplementation(({ kind }: { kind: string }) => kind === 'sub_change'
      ? Promise.reject(new Error('无分包变洽签读取权限'))
      : Promise.resolve(ownerPage(1)))

    renderDetail({ originHint: 'real', includeDemo: false })

    expect(await screen.findByRole('link', { name: /甲方变洽签/ })).not.toBeNull()
    expect(screen.getByRole('link', { name: /甲方罚扣/ })).not.toBeNull()
    expect(screen.queryByRole('link', { name: /分包变洽签/ })).toBeNull()
    expect(screen.getByRole('heading', { name: '部分项目商务单据暂不可用' })).not.toBeNull()
  })

  it('稳定区分来源错配，不按项目名称回退到其他来源', async () => {
    get.mockResolvedValue(detail)
    renderDetail({ originHint: 'real', includeDemo: true })

    await vi.waitFor(() => {
      expect(screen.getByRole('status', { name: '项目身份与来源不匹配' })).not.toBeNull()
    })
    expect(screen.getByText('项目存在，但 URL 来源与中央身份不一致')).not.toBeNull()
    expect(screen.queryByRole('heading', { name: '合和新城' })).toBeNull()
  })

  it('加载与错误期间始终保留同一合法来源入口', async () => {
    let finishLoad!: (value: ProjectDetailReadDTO) => void
    const pending = new Promise<ProjectDetailReadDTO>((resolve) => {
      finishLoad = resolve
    })
    get.mockReturnValue(pending)
    const returnTo = '/project?search=%E5%90%88%E5%92%8C&nav=origin_313#project-row-demo%3Aproject-1'
    renderDetail({ originHint: 'demo', includeDemo: true, returnTo })

    const loading = screen.getByRole('status', { name: '正在从中央后台加载项目详情' })
    expect(within(loading).getByRole('link', { name: '返回项目列表' }).getAttribute('href')).toBe(returnTo)

    finishLoad(null as unknown as ProjectDetailReadDTO)
    const failed = await screen.findByRole('alert', { name: '项目详情加载失败' })
    expect(within(failed).getByRole('link', { name: '返回项目列表' }).getAttribute('href')).toBe(returnTo)
  })

  it.each([
    ['forbidden', '无项目查看权限'],
    ['not-found', '项目不存在或当前来源不可见'],
    ['relationship-mismatch', '项目身份与来源不匹配'],
  ] as const)('%s 状态保留合法来源入口', async (code, title) => {
    const failure = new ProjectRepositoryProblem(projectProblem(code, title))
    get.mockResolvedValue({
      get item() {
        throw failure
      },
    } as unknown as ProjectDetailReadDTO)
    const returnTo = '/project?nav=origin_313#project-row-real%3Aproject-1'
    renderDetail({ originHint: 'real', returnTo })

    const state = await screen.findByRole('status', { name: title })
    expect(within(state).getByRole('link', { name: '返回项目列表' }).getAttribute('href')).toBe(returnTo)
  })
})
