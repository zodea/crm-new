import { fireEvent, render, screen, within } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, onMounted, shallowRef, useTemplateRef, watch } from 'vue'
import ProjectListScreen from '~/components/project/ProjectListScreen.vue'
import ListShell from '~/components/ui/ListShell.vue'

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
  },
  setup(props, { expose, slots }) {
    expose({ clearFilter: vi.fn() })
    return () => h('section', { 'aria-label': '项目宽表', 'data-row-height': props.rowHeight }, [
      h('div', { role: 'row' }, (props.columns as any[]).map(column =>
        h('span', { role: 'columnheader' }, column.title))),
      ...(props.data as any[]).map(row =>
        h('div', { role: 'row' }, [
          `${row.name} ${row.status}`,
          slots.developer?.({ row }),
        ])),
    ])
  },
})

const ProjectListToolbarStub = defineComponent({
  props: {
    search: String,
    total: Number,
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
      `共 ${props.total} 个，当前 ${props.visible} 个`,
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

describe('project list screen', () => {
  beforeEach(() => {
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('nextTick', nextTick)
    vi.stubGlobal('onMounted', onMounted)
    vi.stubGlobal('shallowRef', shallowRef)
    vi.stubGlobal('useTemplateRef', useTemplateRef)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('useProjectStore', () => ({
      list: projects,
      loading: false,
      loaded: true,
      error: '',
      load: vi.fn(),
      downstreamImpact: vi.fn(async () => []),
    }))
    vi.stubGlobal('useProjectDetailStore', () => ({
      operationSummaries: {
        'project-1': { projectReceipt: 320000, mainContractAmount: 1000000 },
      },
      targetCosts: [
        {
          projectId: 'project-1',
          status: '当前基线',
          targetAmount: 800000,
        },
      ],
      load: vi.fn(async () => {}),
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
    expect(screen.getByText('合和地产').getAttribute('data-entity-id')).toBe('customer-1')

    await fireEvent.click(screen.getByRole('button', { name: /施工中/ }))

    expect(within(table).getAllByRole('row')).toHaveLength(2)
    expect(within(table).getByText(/合和新城/)).not.toBeNull()
    expect(screen.getByText(/当前 1 个/)).not.toBeNull()
    expect(screen.getByLabelText('项目列表汇总').textContent).toMatch(/累计收入\s*¥320,000\.00/)
  })

  it('搜索覆盖项目、客户和本地已有的项目经理、执行经理、施工员', async () => {
    render(ProjectListScreen, { global })

    await fireEvent.update(screen.getByRole('searchbox', { name: '列表搜索' }), '李经理')

    const table = screen.getByRole('region', { name: '项目宽表' })
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    expect(within(table).getByText(/合和新城/)).not.toBeNull()
    expect(screen.getByText(/当前 1 个/)).not.toBeNull()
  })

  it('全量汇总缺少任一项目事实时显示未知与缺失数，不把已知子集冒充总额', () => {
    render(ProjectListScreen, { global })

    const summary = screen.getByLabelText('项目列表汇总')
    expect(summary.textContent).toMatch(/累计收入\s*—\s*缺失 1 个/)
    expect(summary.textContent).toMatch(/预算总额\s*—\s*缺失 1 个/)
    expect(summary.textContent).not.toContain('¥320,000.00')
    expect(summary.textContent).not.toContain('¥800,000.00')
  })
})
