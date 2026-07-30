import type { ShallowRef } from 'vue'
import { fireEvent, render, screen, within } from '@testing-library/vue'
import { storeToRefs } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  computed,
  defineComponent,
  h,
  onActivated,
  onMounted,
  shallowRef,
  watch,
} from 'vue'
import MasterDataRegistryList from '~/components/master-data/MasterDataRegistryList.vue'
import ListShell from '~/components/ui/ListShell.vue'

const workerRows = [
  {
    id: 'worker-1',
    name: '张师傅',
    trade: '泥水工',
    crewName: '泥水A班',
    projectName: '合和新城',
    projectStatus: '在场',
    phone: '13800138000',
    idCard: '440101199001011234',
    entryDate: '2026-01-02',
    safetyEducation: true,
    safetyEducationLabel: '已完成',
    status: 'submitted',
    updatedAt: '2026-07-30',
  },
  {
    id: 'worker-2',
    name: '李师傅',
    trade: '油漆工',
    crewName: '油漆班',
    projectName: '锦绣华庭',
    projectStatus: '已退场',
    phone: '13900139000',
    idCard: '440101198802025678',
    entryDate: '2025-12-01',
    safetyEducation: false,
    safetyEducationLabel: '未完成',
    status: 'draft',
    updatedAt: '2026-07-29',
  },
]

let workerStoreMock: {
  revision: ShallowRef<number>
  assessDeletion: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  restore: ReturnType<typeof vi.fn>
}

let kitUiMock: {
  confirm: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
  success: ReturnType<typeof vi.fn>
  undoToast: ReturnType<typeof vi.fn>
  warning: ReturnType<typeof vi.fn>
}

const MasterDataListToolbarStub = defineComponent({
  props: {
    search: String,
    filters: {
      type: Object,
      default: () => ({}),
    },
    total: Number,
    visible: Number,
  },
  emits: ['update:search', 'update:filters'],
  setup(props, { emit }) {
    return () => h('div', [
      h('input', {
        'aria-label': '主数据搜索',
        'type': 'search',
        'value': props.search,
        'onInput': (event: Event) =>
          emit('update:search', (event.target as HTMLInputElement).value),
      }),
      h('button', {
        type: 'button',
        onClick: () => emit('update:filters', {
          ...props.filters,
          crewName: '泥水A班',
        }),
      }, '只看泥水A班'),
      h('span', `共 ${props.total} 条，当前 ${props.visible} 条`),
    ])
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
  },
  setup(props, { slots }) {
    return () => h('section', { 'aria-label': '工人主数据表格' }, [
      h('div', { role: 'row' }, (props.columns as any[]).map(column =>
        h('span', { role: 'columnheader' }, column.title))),
      ...(props.data as any[]).map(row =>
        h('div', { role: 'row' }, [
          slots.name?.({ row }),
          slots.phone?.({ row }),
          slots.workerIdentifier?.({ row }),
          slots.projectStatus?.({ row }),
          slots.safetyEducation?.({ row }),
          slots.action?.({ row }),
        ])),
    ])
  },
})

const global = {
  components: {
    KitTable: KitTableStub,
    ListShell,
    MasterDataListToolbar: MasterDataListToolbarStub,
    NuxtLink: defineComponent({
      props: ['to'],
      template: '<a :href="typeof to === \'string\' ? to : to.path"><slot /></a>',
    }),
    StatePanel: true,
  },
}

describe('master data registry list', () => {
  beforeEach(() => {
    const rowsByKind = shallowRef({
      customer: [],
      crew: [],
      worker: workerRows,
      target_cost: [],
    })
    const loadingByKind = shallowRef({
      customer: false,
      crew: false,
      worker: false,
      target_cost: false,
    })
    const workerRevision = shallowRef(0)
    workerStoreMock = {
      revision: workerRevision,
      assessDeletion: vi.fn(async () => ({ blockedReason: '', impact: [] })),
      remove: vi.fn(async () => 'delete-log'),
      restore: vi.fn(),
    }
    kitUiMock = {
      confirm: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
      undoToast: vi.fn(),
      warning: vi.fn(),
    }

    vi.stubGlobal('computed', computed)
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('onActivated', onActivated)
    vi.stubGlobal('onMounted', onMounted)
    vi.stubGlobal('shallowRef', shallowRef)
    vi.stubGlobal('storeToRefs', storeToRefs)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('useMasterDataReadStore', () => ({
      rowsByKind,
      loadingByKind,
      load: vi.fn(async () => workerRows),
    }))
    vi.stubGlobal('useCustomerStore', () => ({
      revision: shallowRef(0),
      assessDeletion: vi.fn(async () => ({ blockedReason: '', impact: [] })),
    }))
    vi.stubGlobal('useCrewStore', () => ({
      revision: shallowRef(0),
      assessDeletion: vi.fn(async () => ({ blockedReason: '', impact: [] })),
    }))
    vi.stubGlobal('useWorkerStore', () => workerStoreMock)
    vi.stubGlobal('useKitUI', () => kitUiMock)
  })

  it('展示完整领域列，同时只把电话和身份证的脱敏值写入 DOM', () => {
    render(MasterDataRegistryList, {
      props: { kind: 'worker' },
      global,
    })

    const table = screen.getByRole('region', { name: '工人主数据表格' })
    expect(within(table).getAllByRole('columnheader').map(item => item.textContent)).toEqual([
      '姓名',
      '工种',
      '所属班组',
      '当前项目',
      '档案状态',
      '在场状态',
      '联系电话',
      '身份证号',
      '进场日期',
      '退场日期',
      '安全教育',
      '操作',
    ])
    expect(table.textContent).toContain('138 **** 8000')
    expect(table.textContent).toContain('440101 **** 1234')
    expect(table.textContent).not.toContain('13800138000')
    expect(table.textContent).not.toContain('440101199001011234')
  })

  it('搜索与领域筛选叠加后同步表格和当前记录数', async () => {
    render(MasterDataRegistryList, {
      props: { kind: 'worker' },
      global,
    })

    await fireEvent.update(screen.getByRole('searchbox', { name: '主数据搜索' }), '张师傅')
    await fireEvent.click(screen.getByRole('button', { name: '只看泥水A班' }))

    const table = screen.getByRole('region', { name: '工人主数据表格' })
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    expect(within(table).getByText('张师傅')).not.toBeNull()
    expect(within(table).queryByText('李师傅')).toBeNull()
    expect(screen.getByText(/当前 1 条/)).not.toBeNull()
  })

  it('存在下游记录时使用级联确认且不提供事后撤回', async () => {
    workerStoreMock.assessDeletion.mockResolvedValue({
      blockedReason: '',
      impact: [{ label: '扣罚记录', n: 2 }],
    })
    kitUiMock.confirm.mockResolvedValue(true)

    render(MasterDataRegistryList, {
      props: { kind: 'worker' },
      global,
    })
    await fireEvent.click(screen.getByRole('button', { name: '删除张师傅工人' }))

    expect(kitUiMock.confirm).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'cascade',
      requireTyping: '张师傅',
      impact: [{ label: '扣罚记录', n: 2 }],
    }))
    expect(workerStoreMock.remove).toHaveBeenCalledWith('worker-1')
    await vi.waitFor(() => expect(kitUiMock.success).toHaveBeenCalled())
    expect(kitUiMock.undoToast).not.toHaveBeenCalled()
  })
})
