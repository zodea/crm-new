import type { ProjectListPageDTO, ProjectListQueryDTO, ProjectListSourceRow } from '~/lib/project/repository'
import type { ReadState } from '~/types/read-model'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, onMounted, reactive, shallowRef, useTemplateRef, watch } from 'vue'
import ProjectListScreen from '~/components/project/ProjectListScreen.vue'
import ListShell from '~/components/ui/ListShell.vue'
import { buildProjectListPage } from '~/lib/project/repository'

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
  return buildProjectListPage({
    rows: allSourceRows,
    query,
    asOf: '2026-08-15T00:00:00.000Z',
    sourceVersion: 'component-test-v1',
  })
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
  },
  emits: ['filter-change'],
  setup(props, { emit, expose, slots }) {
    expose({ clearFilter: vi.fn() })
    return () => h('section', {
      'aria-label': '项目宽表',
      'data-row-height': props.rowHeight,
      'data-row-key': props.rowKey,
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
          `${row.name} ${row.status}`,
          slots.origin?.({ row }),
          slots.developer?.({ row }),
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
  emits: ['update:search'],
  setup(props, { emit }) {
    return () => h('div', [
      h('input', {
        'aria-label': '列表搜索',
        'type': 'search',
        'value': props.search,
        'onInput': (event: Event) =>
          emit('update:search', (event.target as HTMLInputElement).value),
      }),
      `正式 ${props.realTotal} 个${props.includeDemo ? `，测试 ${props.demoTotal} 个` : ''}，当前 ${props.visible} 个`,
    ])
  },
})

const global = {
  components: {
    EntityLink: defineComponent({
      props: ['id', 'label'],
      template: '<span :data-entity-id="id">{{ label }}</span>',
    }),
    KitTable: KitTableStub,
    ListShell,
    NuxtLink: defineComponent({ props: ['to'], template: '<a :href="to"><slot /></a>' }),
    ProjectListToolbar: ProjectListToolbarStub,
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

describe('project list screen', () => {
  beforeEach(() => {
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('nextTick', nextTick)
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
    expect(summary.textContent).toMatch(/正式数据\s*2 个/)
    expect(summary.textContent).toMatch(/测试数据\s*1 个/)
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
    expect(summary.textContent).toMatch(/累计收入\s*—\s*收入缺失 1 个/)
    expect(summary.textContent).toMatch(/预算总额\s*—\s*预算缺失 1 个/)
    expect(summary.textContent).not.toContain('¥320,000.00')
    expect(summary.textContent).not.toContain('¥800,000.00')
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
})
