import type { ProjectListPageDTO, ProjectListQueryDTO, ProjectListSourceRow } from '~/lib/project/repository'
import type { ReadState } from '~/types/read-model'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  computed,
  defineComponent,
  h,
  nextTick,
  onActivated,
  onDeactivated,
  onMounted,
  reactive,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue'
import ProjectListScreen from '~/components/project/ProjectListScreen.vue'
import ListShell from '~/components/ui/ListShell.vue'
import { buildProjectListPage } from '~/lib/project/repository'
import { withOriginReadMeta } from '../../server/utils/read-meta'
import { projectSnapshotEvidence } from '../helpers/project-read-meta'

const deletedProjects = vi.hoisted(() => vi.fn())
vi.mock('~/stores/project-production', () => ({ useProjectProductionStore: () => ({ deleted: deletedProjects }) }))

const projects = [
  {
    id: 'project-1',
    name: '合和新城',
    status: '施工中',
    updatedAt: '2026-07-29',
    contractAmount: 100,
    plannedEnd: '2026-12-31',
    actualEnd: '',
    manager: '张经理',
    execManager: '李经理',
    contractName: '合和新城施工合同',
    customerId: 'customer-1',
    developer: '合和地产',
    builder: '陈施工',
    code: 'HHXC',
    address: '广州',
  },
  {
    id: 'project-2',
    name: '科学城公寓',
    status: '筹备中',
    updatedAt: '2026-07-28',
    contractAmount: 80,
    plannedEnd: '2027-03-01',
    actualEnd: '',
    manager: '王经理',
    execManager: '',
    contractName: '科学城公寓施工合同',
    customerId: 'customer-2',
    developer: '科学城集团',
    builder: '',
    code: 'KXC',
    address: '广州',
  },
]

const sourceRows: ProjectListSourceRow[] = projects.map((project, index) => ({
  dataOrigin: 'real',
  id: project.id,
  name: project.name,
  code: project.code,
  status: project.status,
  contractAmount: project.contractAmount,
  operationType: '自营',
  startDate: null,
  plannedEnd: project.plannedEnd,
  actualEnd: project.actualEnd || null,
  plannedDuration: null,
  manager: project.manager,
  execManager: project.execManager,
  builder: project.builder,
  customerId: project.customerId,
  customerName: project.developer,
  customerPermission: 'allowed',
  secondaryCustomerId: null,
  secondaryCustomerName: null,
  secondaryCustomerPermission: 'allowed',
  contractName: project.contractName,
  contractor: '',
  region: '广州',
  riskLevel: '',
  address: project.address,
  income: index === 0 ? 320000 : null,
  budget: index === 0 ? 800000 : null,
  updatedAt: `${project.updatedAt}T00:00:00.000Z`,
}))

const allSourceRows: ProjectListSourceRow[] = [
  ...sourceRows,
  {
    ...sourceRows[0]!,
    dataOrigin: 'demo',
    id: 'project-demo-1',
  },
]

const defaultQuery: ProjectListQueryDTO = {
  includeDemo: false,
  search: '',
  status: null,
  filters: {
    statuses: [],
    plannedEnds: [],
    managers: [],
    customerIds: [],
  },
  sort: 'updated-desc',
  page: 1,
  pageSize: 10,
}

function projectPage(query: ProjectListQueryDTO = defaultQuery) {
  const input = {
    rows: allSourceRows,
    query,
    asOf: '2026-08-15T00:00:00.000Z',
    sourceVersion: 'component-test-v1',
    capabilities: ['project:list:read', 'project:write'],
  }
  return withOriginReadMeta(buildProjectListPage(input), projectSnapshotEvidence(input))
}

const TreeNavStub = defineComponent({
  props: {
    items: {
      type: Array,
      default: () => [],
    },
    title: String,
    modelValue: String,
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const renderNodes = (items: any[]): any[] =>
      items.flatMap(item => [
        h('button', {
          'type': 'button',
          'aria-pressed': item.key === props.modelValue,
          'onClick': () => emit('update:modelValue', item.key),
        }, `${item.label} ${item.count ?? ''}`),
        ...(item.children ? renderNodes(item.children) : []),
      ])
    return () => h('nav', { 'aria-label': props.title }, renderNodes(props.items as any[]))
  },
})

const KitTableStub = defineComponent({
  props: {
    columns: {
      type: Array,
      default: () => [],
    },
    data: {
      type: Array,
      default: () => [],
    },
    rowHeight: Number,
    rowKey: String,
    loading: Boolean,
  },
  emits: ['filter-change'],
  setup(props, { emit, expose, slots }) {
    expose({ clearFilter: vi.fn() })
    return () => h('section', {
      'aria-label': '项目宽表',
      'data-row-height': props.rowHeight,
      'data-row-key': props.rowKey,
      'data-loading': String(props.loading),
    }, [
      h('div', { role: 'row' }, (props.columns as any[]).map(column =>
        h('span', {
          'role': 'columnheader',
          'data-checked-values': Array.isArray(column.filterable)
            ? column.filterable.filter((option: any) => option.checked).map((option: any) => option.value).join(',')
            : '',
        }, column.title))),
      h('button', {
        'type': 'button',
        'aria-label': '应用无交集组合筛选',
        'onClick': () => emit('filter-change', {
          field: 'manager',
          values: ['王经理'],
          filters: [
            { field: 'developer', values: ['customer-1'] },
            { field: 'manager', values: ['王经理'] },
          ],
        }),
      }),
      ...(props.data as any[]).map(row =>
        h('div', { role: 'row' }, [
          slots.name?.({ row }),
          slots.status?.({ row }),
          slots.origin?.({ row }),
          slots.developer?.({ row }),
          slots.action?.({ row }),
        ])),
    ])
  },
})

const ProjectListToolbarStub = defineComponent({
  props: {
    search: String,
    realTotal: Number,
    demoTotal: Number,
    includeDemo: Boolean,
    visible: Number,
  },
  emits: ['update:search', 'create'],
  setup(props, { emit }) {
    return () => h('div', [
      h('h2', {
        'data-project-list-return-fallback': '',
        'tabindex': -1,
      }, '施工项目'),
      h('input', {
        'aria-label': '列表搜索',
        'type': 'search',
        'value': props.search,
        'onInput': (event: Event) =>
          emit('update:search', (event.target as HTMLInputElement).value),
      }),
      h('button', { type: 'button', onClick: () => emit('create') }, '新增项目'),
      `正式 ${props.realTotal} 个${props.includeDemo ? `，测试 ${props.demoTotal} 个` : ''}，当前 ${props.visible} 个`,
    ])
  },
})

const global = {
  stubs: { ProjectListToolbar: ProjectListToolbarStub },
  components: {
    EntityLink: defineComponent({
      props: ['id', 'label', 'returnTo', 'returnContextId'],
      emits: ['navigate'],
      template: `
        <a
          :href="'/project/' + id"
          :data-entity-id="id"
          :data-return-to="returnTo"
          :data-return-context="returnContextId"
          @click="$emit('navigate')"
        >{{ label }}</a>
      `,
    }),
    KitTable: KitTableStub,
    ListShell,
    NuxtLink: defineComponent({ props: ['to'], template: '<a :href="to"><slot /></a>' }),
    SelectFilter: defineComponent({
      props: ['modelValue', 'options'],
      emits: ['update:modelValue'],
      template: `
        <select
          aria-label="列表视图"
          :value="modelValue"
          @change="$emit('update:modelValue', $event.target.value)"
        >
          <option v-for="option in options" :key="option.key" :value="option.key">
            {{ option.label }}
          </option>
        </select>
      `,
    }),
    StatePanel: true,
    TreeNav: TreeNavStub,
  },
}

let projectReadStore: {
  state: ReadState<ProjectListPageDTO>
  load: ReturnType<typeof vi.fn>
  listAll: ReturnType<typeof vi.fn>
  retry: ReturnType<typeof vi.fn>
}
let dataVisibilityStore: {
  includeDemo: boolean
  setIncludeDemo: ReturnType<typeof vi.fn>
}
let projectCommandStore: {
  latestWrite: { id: string, version: string } | null
}
const navigateTo = vi.fn()
const routerReplace = vi.fn()
const route = reactive({
  path: '/project',
  fullPath: '/project',
  hash: '',
  query: {} as Record<string, string | string[]>,
})

describe('project list screen', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-24T08:00:00Z'))
    vi.stubGlobal('computed', computed)
    sessionStorage.clear()
    route.fullPath = '/project'
    route.hash = ''
    route.query = {}
    routerReplace.mockReset()
    deletedProjects.mockReset().mockResolvedValue([])
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useRouter', () => ({ replace: routerReplace }))
    navigateTo.mockReset()
    vi.stubGlobal('navigateTo', navigateTo)
    vi.stubGlobal('nextTick', nextTick)
    vi.stubGlobal('onActivated', onActivated)
    vi.stubGlobal('onDeactivated', onDeactivated)
    vi.stubGlobal('onMounted', onMounted)
    vi.stubGlobal('shallowRef', shallowRef)
    vi.stubGlobal('useTemplateRef', useTemplateRef)
    vi.stubGlobal('watch', watch)
    projectReadStore = reactive({
      state: { kind: 'ready', data: projectPage() },
      load: vi.fn(async (query: ProjectListQueryDTO) => {
        const page = projectPage(query)
        projectReadStore.state = page.empty
          ? { kind: 'empty', data: page, empty: page.empty }
          : { kind: 'ready', data: page }
      }),
      listAll: vi.fn(async (query: ProjectListQueryDTO) => projectPage({
        ...query,
        page: 1,
        pageSize: 100,
      }).items),
      retry: vi.fn(),
    })
    vi.stubGlobal('useProjectListStore', () => projectReadStore)
    projectCommandStore = reactive({ latestWrite: null })
    vi.stubGlobal('useProjectCommandStore', () => projectCommandStore)
    dataVisibilityStore = reactive({
      includeDemo: false,
      setIncludeDemo: vi.fn((next: boolean) => {
        dataVisibilityStore.includeDemo = next
      }),
    })
    vi.stubGlobal('useDataVisibilityStore', () => dataVisibilityStore)
    vi.stubGlobal('useProjectStore', () => ({
      downstreamImpact: vi.fn(async () => []),
      remove: vi.fn(),
      undo: vi.fn(),
    }))
    vi.stubGlobal('useKitUI', () => ({
      confirm: vi.fn(),
      error: vi.fn(),
      exportFile: vi.fn(),
      openImportTab: vi.fn(),
      success: vi.fn(),
      undoToast: vi.fn(),
    }))
  })

  it('已删除项目入口随权限开放，并保留项目详情的正式来源', async () => {
    deletedProjects.mockResolvedValue([{ id: '项目/id', name: '已删除的原项目', version: 'v2', deletedAt: '2026-09-24' }])
    render(ProjectListScreen, { global })
    await nextTick()
    expect(deletedProjects).not.toHaveBeenCalled()
    expect(screen.queryByText(/已删除项目/)).toBeNull()

    const data = projectPage()
    projectReadStore.state = { kind: 'ready', data: { ...data, capabilities: [...data.capabilities, 'project:lifecycle:write'] } }
    await fireEvent.click(await screen.findByText('已删除项目（1）'))
    expect((await screen.findByRole('link', { name: '已删除的原项目' })).getAttribute('href')).toBe(`/project/${encodeURIComponent('项目/id')}?origin=real`)
  })

  it('采用参考的左侧阶段树结构，但筛选值只使用本地项目状态机', () => {
    render(ProjectListScreen, { global })

    const tree = screen.getByRole('navigation', { name: '列表分类' })
    for (const label of [
      '筹备中',
      '施工中',
      '停工',
      '已竣工',
      '已结算',
    ])
      expect(within(tree).getByRole('button', { name: new RegExp(`^${label}\\s`) })).not.toBeNull()

    expect(within(tree).queryByRole('button', { name: /项目立项/ })).toBeNull()
    expect(within(tree).queryByRole('button', { name: /保修结束/ })).toBeNull()
  })

  it('列表使用紧凑业务状态标签，并保留未知阶段的原文与中性呈现', async () => {
    const data = projectPage()
    data.items[1]!.status = '历史待核实阶段'
    projectReadStore.state = { kind: 'ready', data }
    projectReadStore.load.mockResolvedValue(undefined)
    render(ProjectListScreen, { global })

    const table = screen.getByRole('region', { name: '项目宽表' })
    const current = within(table).getByText('施工中')
    expect(current.getAttribute('data-ui')).toBe('status-tag')
    expect(current.getAttribute('data-tone')).toBe('brand')
    const historical = within(table).getByText('历史待核实阶段')
    expect(historical.getAttribute('data-ui')).toBe('status-tag')
    expect(historical.getAttribute('data-tone')).toBe('neutral')
  })

  it('同范围刷新保留已有表格，首次或新范围等待仍显示加载态', async () => {
    render(ProjectListScreen, { global })
    await nextTick()
    const previous = projectPage()
    projectReadStore.state = { kind: 'loading', previous }
    await nextTick()
    expect(screen.getByRole('region', { name: '项目宽表' }).getAttribute('data-loading')).toBe('false')
    expect(screen.getByRole('link', { name: '合和新城' })).not.toBeNull()
    projectReadStore.state = { kind: 'loading', previous: null }
    await nextTick()
    expect(screen.queryByRole('region', { name: '项目宽表' })).toBeNull()
  })

  it('从列表新增正式项目，并为正式行提供来源明确的编辑入口', async () => {
    render(ProjectListScreen, { global })

    await fireEvent.click(screen.getByRole('button', { name: '新增项目' }))
    expect(navigateTo).toHaveBeenCalledWith('/project/form')
    expect(screen.getByRole('link', { name: '编辑合和新城项目' }).getAttribute('href'))
      .toBe('/project/form/project-1?origin=real')
  })

  it('中央项目写入完成后重新读取列表投影', async () => {
    render(ProjectListScreen, { global })
    await waitFor(() => expect(projectReadStore.load).toHaveBeenCalledTimes(1))

    projectCommandStore.latestWrite = { id: 'project-1', version: '2' }

    await waitFor(() => expect(projectReadStore.load).toHaveBeenCalledTimes(2))
    expect(projectReadStore.load).toHaveBeenLastCalledWith(defaultQuery)
  })

  it('从路由恢复列表查询，并为项目主链接生成带行锚点的本地来源上下文', async () => {
    route.query = {
      search: '合和',
      phase: '施工中',
      sort: 'name-asc',
      page: '1',
      pageSize: '20',
      status: ['施工中'],
      manager: ['张经理'],
    }
    route.fullPath = '/project?search=%E5%90%88%E5%92%8C&phase=%E6%96%BD%E5%B7%A5%E4%B8%AD&sort=name-asc&page=1&pageSize=20&status=%E6%96%BD%E5%B7%A5%E4%B8%AD&manager=%E5%BC%A0%E7%BB%8F%E7%90%86'
    const workspace = document.createElement('div')
    workspace.dataset.shellWorkspace = ''
    workspace.scrollTop = 684
    document.body.append(workspace)

    render(ProjectListScreen, { global })

    await waitFor(() => expect(projectReadStore.load).toHaveBeenLastCalledWith({
      includeDemo: false,
      search: '合和',
      status: '施工中',
      filters: {
        statuses: ['施工中'],
        plannedEnds: [],
        managers: ['张经理'],
        customerIds: [],
      },
      sort: 'name-asc',
      page: 1,
      pageSize: 20,
    }))

    const link = screen.getByRole('link', { name: '合和新城' })
    expect(link.dataset.returnTo).toContain('/project?search=%E5%90%88%E5%92%8C')
    expect(link.dataset.returnTo).toContain('phase=%E6%96%BD%E5%B7%A5%E4%B8%AD')
    expect(link.dataset.returnTo).toContain('pageSize=20')
    expect(link.dataset.returnTo).toContain('#project-row-real%3Aproject-1')
    expect(link.dataset.returnContext).toMatch(/^[\w-]{8,64}$/)

    await fireEvent.click(link)

    const stored = sessionStorage.getItem(`ruihang:project-return:${link.dataset.returnContext}`)
    expect(stored).not.toBeNull()
    expect(JSON.parse(stored!).scrollTop).toBe(684)
  })

  it('原行消失时把焦点降级到项目列表标题', async () => {
    const contextId = 'origin_missing_row'
    const returnTo = `/project?nav=${contextId}#project-row-real%3Amissing`
    route.query = { nav: contextId }
    route.fullPath = returnTo
    sessionStorage.setItem(`ruihang:project-return:${contextId}`, JSON.stringify({
      id: contextId,
      returnTo,
      tabKey: '/project',
      anchorId: 'project-row-real:missing',
      scrollTop: 320,
      expiresAt: Date.now() + 60_000,
    }))

    render(ProjectListScreen, { global })

    const heading = screen.getByRole('heading', { name: '施工项目' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })

  it('只展示本地有事实来源的目标列，阶段筛选会更新紧凑宽表和汇总', async () => {
    render(ProjectListScreen, { global })

    const table = screen.getByRole('region', { name: '项目宽表' })
    const headings = within(table).getAllByRole('columnheader').map(item => item.textContent)
    expect(headings).toEqual([
      '项目名称',
      '数据来源',
      '业务阶段',
      '累计收入合同金额',
      '预算总额',
      '计划竣工',
      '实际竣工',
      '项目经理',
      '执行经理',
      '项目合同名称',
      '客户',
      '施工员',
      '操作',
    ])
    expect(headings).not.toContain('采购经理')
    expect(table.getAttribute('data-row-height')).toBe('36')
    expect(table.getAttribute('data-row-key')).toBe('rowIdentity')
    expect(screen.getByText('合和地产').getAttribute('data-entity-id')).toBe('customer-1')

    await fireEvent.click(screen.getByRole('button', { name: /施工中/ }))

    expect(within(table).getAllByRole('row')).toHaveLength(2)
    expect(within(table).getByText(/合和新城/)).not.toBeNull()
    expect(screen.getByText(/当前 1 个/)).not.toBeNull()
    expect(screen.getByLabelText('项目列表汇总').textContent).toMatch(/累计收入\s*¥320,000\.00/)
  })

  it('全局开关进入 Repository 查询，并把正式与测试行和汇总分组呈现', async () => {
    render(ProjectListScreen, { global })

    dataVisibilityStore.setIncludeDemo(true)

    await waitFor(() => {
      expect(projectReadStore.load).toHaveBeenLastCalledWith(expect.objectContaining({
        includeDemo: true,
      }))
    })
    expect(screen.getAllByText('测试数据').length).toBeGreaterThanOrEqual(2)
    const summary = screen.getByLabelText('项目列表汇总')
    expect(summary.textContent).toMatch(/正式数据当前筛选范围\s*2 个/)
    expect(summary.textContent).toMatch(/测试数据当前筛选范围\s*1 个/)
  })

  it('搜索覆盖项目、客户和本地已有的项目经理、执行经理、施工员', async () => {
    render(ProjectListScreen, { global })

    await fireEvent.update(screen.getByRole('searchbox', { name: '列表搜索' }), '李经理')

    const table = screen.getByRole('region', { name: '项目宽表' })
    await waitFor(() => {
      expect(within(table).getAllByRole('row')).toHaveLength(2)
      expect(within(table).getByText(/合和新城/)).not.toBeNull()
      expect(screen.getByText(/当前 1 个/)).not.toBeNull()
    })
    expect(projectReadStore.load).toHaveBeenLastCalledWith(expect.objectContaining({ search: '李经理' }))
  })

  it('全量汇总缺少任一项目事实时显示未知与缺失数，不把已知子集冒充总额', () => {
    render(ProjectListScreen, { global })

    const summary = screen.getByLabelText('项目列表汇总')
    expect(summary.textContent).toMatch(/累计收入\s*未知（已知小计 ¥320,000.00）\s*收入缺失 1 个/)
    expect(summary.textContent).toMatch(/预算总额\s*未知（已知小计 ¥800,000.00）\s*预算缺失 1 个/)
    expect(summary.textContent).toContain('当前筛选范围')
    expect(summary.textContent).not.toMatch(/累计收入\s*¥320,000.00/)
    expect(summary.textContent).not.toMatch(/预算总额\s*¥800,000.00/)
  })

  it('交叉筛选无命中后仍在动态 facet 中保留全部已选条件', async () => {
    render(ProjectListScreen, { global })

    await fireEvent.click(screen.getByRole('button', { name: '应用无交集组合筛选' }))

    await waitFor(() => {
      expect(projectReadStore.load).toHaveBeenLastCalledWith(expect.objectContaining({
        filters: expect.objectContaining({
          managers: ['王经理'],
          customerIds: ['customer-1'],
        }),
      }))
    })

    const table = screen.getByRole('region', { name: '项目宽表' })
    expect(within(table).getByRole('columnheader', { name: '项目经理' }).dataset.checkedValues)
      .toBe('王经理')
    expect(within(table).getByRole('columnheader', { name: '客户' }).dataset.checkedValues)
      .toBe('customer-1')
  })
  it('超出末页只采用本次读取的实际页，URL保留100条及原筛选上下文', async () => {
    route.fullPath = '/project?page=9&pageSize=100&nav=project_context_001'
    route.query = { page: '9', pageSize: '100', nav: 'project_context_001' }
    render(ProjectListScreen, { global })
    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith({ query: { page: '1', pageSize: '100', nav: 'project_context_001' } }))
    expect(projectReadStore.load).toHaveBeenCalledWith(expect.objectContaining({ page: 9, pageSize: 100 }))
    await waitFor(() => expect(projectReadStore.load).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, pageSize: 100 })))
  })

  it('目标已经切换时迟到分页结果不能改写新路径URL', async () => {
    route.fullPath = '/project?page=9'
    route.query = { page: '9' }
    let release!: () => void
    projectReadStore.load.mockImplementationOnce((query: ProjectListQueryDTO) => new Promise<void>((resolve) => {
      release = () => {
        projectReadStore.state = { kind: 'ready', data: projectPage(query) }
        resolve()
      }
    }))
    const view = render(ProjectListScreen, { global })
    route.fullPath = '/base/customer?page=4'
    route.path = '/base/customer'
    route.query = { page: '4' }
    release()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(routerReplace).not.toHaveBeenCalled()
    view.unmount()
    route.path = '/project'
  })
})
