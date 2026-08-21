import type { ProjectDetailReadDTO } from '~/lib/project/repository'
import { render, screen, within } from '@testing-library/vue'
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
  asOf: '2026-08-15T00:00:00.000Z',
  sourceVersion: 'detail-v1',
  capabilities: ['project:list:read', 'demo:read'],
}

const get = vi.fn()

const NuxtLinkStub = defineComponent({
  props: { to: { type: [String, Object], required: true } },
  setup(props, { slots }) {
    return () => h('a', {
      href: typeof props.to === 'string' ? props.to : JSON.stringify(props.to),
    }, slots.default?.())
  },
})

const StatePanelStub = defineComponent({
  props: ['kind', 'title', 'description'],
  template: '<section role="status" :aria-label="title"><h2>{{ title }}</h2><p>{{ description }}</p><slot name="action" /></section>',
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
        StatePanel: StatePanelStub,
      },
    },
  })
}

vi.stubGlobal('useNuxtApp', () => ({
  $repositories: { projectList: { get, list: vi.fn() } },
}))
vi.stubGlobal('useProjectCommandStore', () => ({ latestWrite: null }))
vi.stubGlobal('useTabTitle', () => {})

describe('项目详情中央来源边界', () => {
  beforeEach(() => get.mockReset())

  it('由 Repository 返回权威来源，并只呈现演示只读详情', async () => {
    get.mockResolvedValue(detail)
    renderDetail({ originHint: 'demo', includeDemo: true })

    const heading = await screen.findByRole('heading', { name: '合和新城' })
    expect(document.activeElement).toBe(heading)
    expect(get).toHaveBeenCalledWith({ id: 'project-1', origin: 'demo', includeDemo: true })
    expect(screen.getByRole('status', { name: '测试数据只读详情' }).textContent).toContain('测试数据仅供查看')
    expect(screen.queryByRole('link', { name: '编辑项目' })).toBeNull()
    expect(screen.queryByRole('button', { name: '导出项目档案包' })).toBeNull()
    expect(document.querySelector('[data-project-module]')).toBeNull()
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
    const failed = await screen.findByRole('status', { name: '项目详情加载失败' })
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
