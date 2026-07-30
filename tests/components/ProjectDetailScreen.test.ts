import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import ProjectDetailScreen from '~/components/project/ProjectDetailScreen.vue'

const project = {
  id: 'project-1',
  name: '合和新城',
  contractName: '合和新城精装修工程',
  code: 'HHXC-01',
  address: '广州市天河区',
  region: '华南',
  type: '精装修项目',
  area: 12000,
  contractAmount: 32000000,
  overview: '',
  operationType: '自营',
  startDate: '2026-01-01',
  plannedEnd: '2026-12-31',
  actualEnd: '',
  plannedDuration: 365,
  status: '施工中',
  customerId: 'customer-1',
  secondaryCustomerId: null,
  developer: '广州合和置业',
  developer2: '',
  developerSupervisor: '',
  supervisor: '华南监理',
  designer: '瑞航设计',
  contractor: '广州睿瑛装饰',
  manager: '陈志强',
  managerPhone: '13800000000',
  execManager: '李执行',
  builder: '王施工',
  siteLeader: '赵现场',
  siteLeaderPhone: '13900000000',
  riskLevel: '低',
  approvalStatus: '已通过',
  acceptanceDate: '',
  filingDate: '',
  note: '',
  description: '',
  source: 'manual',
  createdBy: '',
  createdAt: '2026-01-01T00:00:00',
  updatedBy: '',
  updatedAt: '2026-07-30T00:00:00',
}

const NuxtLinkStub = defineComponent({
  props: {
    to: {
      type: [String, Object],
      required: true,
    },
  },
  setup(props, { slots }) {
    return () => h('a', {
      href: typeof props.to === 'string' ? props.to : JSON.stringify(props.to),
    }, slots.default?.())
  },
})

const SegTabStub = defineComponent({
  props: ['modelValue', 'tabs'],
  emits: ['update:modelValue'],
  template: `
    <div role="tablist" aria-label="项目详情业务页签">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        role="tab"
        :aria-selected="modelValue === tab.key"
        @click="$emit('update:modelValue', tab.key)"
      >
        {{ tab.label }}
      </button>
    </div>
  `,
})

function labeledStub(label: string) {
  return defineComponent({
    template: `<section aria-label="${label}">${label}</section>`,
  })
}

const routerReplace = vi.fn()
vi.stubGlobal('useRoute', () => ({
  params: { id: project.id },
  query: {},
}))
vi.stubGlobal('useRouter', () => ({ replace: routerReplace }))
vi.stubGlobal('useTabTitle', () => {})
vi.stubGlobal('useProjectStore', () => ({
  loaded: true,
  loading: false,
  error: '',
  byId: (id: string) => id === project.id ? project : undefined,
  load: vi.fn().mockResolvedValue(undefined),
}))

describe('项目详情运行态信息流', () => {
  it('按参考顺序展示紧凑实体头、三段经营摘要、两栏业务内容与十个只读页签', async () => {
    render(ProjectDetailScreen, {
      props: { projectId: project.id },
      global: {
        components: {
          NuxtLink: NuxtLinkStub,
          SegTab: SegTabStub,
          ProjectMetrics: labeledStub('项目经营数据、往来款、票据信息'),
          ProjectWorkflowPanel: labeledStub('审批与业务流'),
          ProjectScheduleCard: labeledStub('施工进度排程'),
          ProjectTimeline: labeledStub('阶段时间线与阶段任务'),
          ProjectTeamPanel: labeledStub('项目组成员'),
          ProjectFileCabinet: labeledStub('项目文件'),
          ProjectDetailTab: labeledStub('详细资料内容'),
          ProjectSubTables: labeledStub('业务子表内容'),
          StatePanel: labeledStub('页面状态'),
        },
      },
    })

    expect(screen.getByRole('heading', { name: '合和新城' })).not.toBeNull()
    expect(screen.getByText('项目信息')).not.toBeNull()
    expect(screen.getAllByText('施工中')).toHaveLength(2)
    expect(screen.queryByText(/状态锁定/)).toBeNull()
    expect(screen.getByRole('link', { name: '关闭项目详情' }).getAttribute('href')).toBe('/project')

    for (const value of ['施工中', '自营', '陈志强', '广州合和置业', '广州睿瑛装饰'])
      expect(screen.getAllByText(value).length).toBeGreaterThan(0)

    const modules = [...document.querySelectorAll('[data-project-module]')]
      .map(element => element.getAttribute('data-project-module'))
    expect(modules).toEqual([
      'metrics',
      'workflow',
      'schedule',
      'timeline',
      'tabs',
      'team',
      'files',
    ])

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(10)
    expect(tabs.map(tab => tab.textContent)).toEqual([
      '详细资料',
      '成本预算',
      '施工合同管理',
      '支出合同管理',
      '票税管理',
      '资金管理',
      '往来款',
      '支付明细',
      '物资管理',
      '竣工验收及保修',
    ])

    await fireEvent.click(screen.getByRole('tab', { name: '往来款' }))
    expect(routerReplace).toHaveBeenCalledWith({
      query: { tab: 'current' },
    })
  })
})
