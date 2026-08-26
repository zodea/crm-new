import type { OwnerDocumentListRecord } from '~/lib/owner-document/forms'
import { fireEvent, render, screen, within } from '@testing-library/vue'
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
import OwnerDocumentListScreen from '~/components/owner-document/OwnerDocumentListScreen.vue'

const runtime = vi.hoisted(() => ({ desktop: true }))
vi.mock('~/lib/platform/runtime', () => ({ isDesktopRuntime: () => runtime.desktop }))

const listRows: OwnerDocumentListRecord[] = [
  {
    id: 'change-1',
    no: 'BQ-001',
    name: '地下室签证',
    projectId: 'project-1',
    projectName: '合和新城',
    contractId: 'contract-1',
    contractName: '合和新城施工合同',
    contractNavigation: {
      kind: 'entity-detail',
      subject: { state: 'resolved', entity: 'contract', id: 'contract-1', label: '合和新城施工合同', no: 'SG-001' },
      variant: 'detail',
      view: null,
      filters: { dataOrigin: 'real', contractKind: '施工' },
    },
    supplierId: null,
    supplierName: '',
    crewId: null,
    crewName: '',
    type: 'site_visa',
    period: '',
    amount: 120,
    secondaryAmount: 110,
    tertiaryAmount: 108,
    quantity: null,
    date: '2026-07-30',
    status: 'approved',
  },
]

const ToolbarStub = defineComponent({
  props: ['title', 'project', 'type', 'view', 'projectOptions', 'typeOptions', 'views'],
  emits: ['update:project', 'update:type', 'update:view', 'create', 'refresh'],
  setup(props, { emit }) {
    const select = (label: string, value: unknown, options: any[], event: string) =>
      h('select', {
        'aria-label': label,
        'value': value,
        'onChange': (input: Event) =>
          emit(event, (input.target as HTMLSelectElement).value),
      }, options.map(option => h('option', { value: option.key }, option.label)))
    return () => h('section', {
      'data-ui': 'owner-document-list-toolbar',
      'data-views': JSON.stringify(props.views),
    }, [
      h('h1', props.title),
      select('项目', props.project, props.projectOptions, 'update:project'),
      select('类型', props.type, props.typeOptions, 'update:type'),
      select('状态', props.view, props.views, 'update:view'),
    ])
  },
})

const KitTableStub = defineComponent({
  inheritAttrs: false,
  props: ['columns', 'data', 'empty', 'page'],
  emits: ['emptyAction'],
  setup(props, { attrs, emit, slots }) {
    return () => h('section', {
      ...attrs,
      'aria-label': '业务单据宽表',
      'data-min-width': (props.columns as any[]).reduce(
        (sum, column) => sum + (column.width ?? column.minWidth ?? 0),
        0,
      ),
    }, [
      h('div', { role: 'row' }, (props.columns as any[]).map(column =>
        h('span', { role: 'columnheader' }, column.title))),
      ...(props.data as any[]).map(row => h('div', { role: 'row' }, [
        slots.document?.({ row }),
        ` ${row.name} `,
        slots.contract?.({ row }),
      ])),
      ...(props.data as any[]).length === 0
        ? [h('div', { 'role': 'status', 'aria-label': props.empty.title }, [
            props.empty.title,
            h('button', { onClick: () => emit('emptyAction') }, props.empty.actionLabel),
          ])]
        : [],
    ])
  },
})

const route = {
  path: '/owner/change',
  query: { project: 'project-1' } as Record<string, string>,
}
const navigateTo = vi.fn()
const loadKind = vi.fn(async () => listRows)
let activeRows = listRows
let centralEmptyReason: 'no-records' | 'no-filter-match' | 'missing-relation' | null = null
let centralSummary: any = null

const global = {
  components: {
    EntityLink: defineComponent({ props: ['label'], template: '<span>{{ label }}</span>' }),
    KitTable: KitTableStub,
    NuxtLink: defineComponent({ props: ['to'], template: '<a :href="to"><slot /></a>' }),
    OwnerDocumentListToolbar: ToolbarStub,
    RowActionMenu: true,
    StatePanel: defineComponent({
      props: ['title', 'actionLabel'],
      emits: ['action'],
      template: '<div role="alert">{{ title }}<button @click="$emit(\'action\')">{{ actionLabel }}</button></div>',
    }),
  },
}

describe('owner document list screen', () => {
  beforeEach(() => {
    runtime.desktop = true
    activeRows = listRows
    centralEmptyReason = null
    centralSummary = null
    navigateTo.mockReset()
    loadKind.mockClear()
    route.path = '/owner/change'
    route.query = { project: 'project-1' }
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('navigateTo', navigateTo)
    vi.stubGlobal('onActivated', onActivated)
    vi.stubGlobal('onMounted', onMounted)
    vi.stubGlobal('shallowRef', shallowRef)
    vi.stubGlobal('useKitUI', () => ({
      confirm: vi.fn(),
      undoToast: vi.fn(),
      error: vi.fn(),
    }))
    vi.stubGlobal('useOwnerDocumentStore', () => ({
      recordsFor: () => activeRows,
      listLoadingFor: () => false,
      listError: () => '',
      loadKind,
      centralPageFor: () => ({ page: 1, pageSize: 10, total: 25 }),
      centralSummaryFor: () => centralSummary,
      centralCapabilitiesFor: () => ['owner-document:write'],
      centralEmptyReasonFor: () => centralEmptyReason,
      removeForm: vi.fn(),
      restoreForm: vi.fn(),
    }))
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useRouter', () => ({ replace: vi.fn() }))
    vi.stubGlobal('watch', watch)
  })

  it('呈现类型化列、具名筛选、来源范围与可局部横滚的宽表', () => {
    render(OwnerDocumentListScreen, {
      props: { kind: 'owner_change' },
      global,
    })

    expect(document.querySelector('[data-ui="owner-document-list-toolbar"]')).not.toBeNull()
    expect(screen.getByRole('combobox', { name: '项目' })).not.toBeNull()
    expect(screen.getByRole('combobox', { name: '类型' })).not.toBeNull()
    expect(screen.getByRole('combobox', { name: '状态' })).not.toBeNull()
    expect(document.querySelector('[data-ui="owner-document-route-context"]')?.textContent)
      .toContain('项目：合和新城')

    const table = screen.getByRole('region', { name: '业务单据宽表' })
    const headings = within(table).getAllByRole('columnheader').map(item => item.textContent)
    expect(headings).toEqual(expect.arrayContaining([
      '变更编号',
      '施工合同',
      '含税审定金额',
      '无税审定金额',
      '无税申报金额',
    ]))
    expect(Number(table.getAttribute('data-min-width'))).toBeGreaterThan(1200)
  })

  it('筛选无结果显示业务空态并可清除筛选', async () => {
    render(OwnerDocumentListScreen, {
      props: { kind: 'owner_change' },
      global,
    })

    await fireEvent.update(screen.getByRole('combobox', { name: '状态' }), 'submitted')
    expect(screen.getByRole('status', { name: '没有符合条件的甲方变洽签' })).not.toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
    expect((screen.getByRole('combobox', { name: '状态' }) as HTMLSelectElement).value)
      .toBe('approved')
  })

  it('中央列表把默认状态作为真实查询条件，并以中央总数展示汇总', async () => {
    runtime.desktop = false
    route.query = {}
    render(OwnerDocumentListScreen, {
      props: { kind: 'owner_change' },
      global,
    })

    await vi.waitFor(() => expect(loadKind).toHaveBeenCalledWith('owner_change', expect.objectContaining({
      status: 'approved',
      page: 1,
      pageSize: 20,
    })))
    expect(screen.getByRole('status', { name: '甲方变洽签列表汇总' }).textContent).toContain('变更单数：25')
    expect(screen.getByRole('link', { name: '合和新城施工合同' }).getAttribute('href'))
      .toBe('/contract/contract-1?origin=real&contractKind=construction')
  })

  it('中央列表的全部状态计数来自状态分面总和，而非当前状态筛选结果数', () => {
    runtime.desktop = false
    route.query = {}
    centralSummary = {
      projects: [],
      contracts: [],
      statuses: [
        { value: 'approved', label: '已审定', count: 7 },
        { value: 'submitted', label: '待核价', count: 2 },
      ],
      documentTypes: [],
      origins: {
        real: {
          count: 7,
          reportedAmount: '0.00',
          auditedAmount: '0.00',
          taxInclusiveAmount: '0.00',
          taxExclusiveAmount: '0.00',
          appliedTaxExclusiveAmount: '0.00',
        },
        demo: {
          count: 0,
          reportedAmount: '0.00',
          auditedAmount: '0.00',
          taxInclusiveAmount: '0.00',
          taxExclusiveAmount: '0.00',
          appliedTaxExclusiveAmount: '0.00',
        },
      },
    }

    render(OwnerDocumentListScreen, {
      props: { kind: 'owner_change' },
      global,
    })

    const views = JSON.parse(document.querySelector('[data-ui="owner-document-list-toolbar"]')?.getAttribute('data-views') ?? '[]')
    expect(views.find((view: { key: string }) => view.key === 'all')?.count).toBe(9)
  })

  it('中央默认状态零命中时清除为全部状态，不重复查询同一默认状态', async () => {
    runtime.desktop = false
    activeRows = []
    centralEmptyReason = 'no-filter-match'
    route.query = {}
    render(OwnerDocumentListScreen, {
      props: { kind: 'owner_change' },
      global,
    })

    await fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
    await vi.waitFor(() => expect(loadKind).toHaveBeenLastCalledWith('owner_change', expect.objectContaining({
      status: null,
    })))
  })

  it('验收与保修列表从同一 canonical 查询切换专属列和 variant', async () => {
    runtime.desktop = false
    route.path = '/owner/acceptance'
    route.query = { variant: 'warranty' }
    activeRows = [{
      ...listRows[0]!,
      id: 'acceptance-real-324',
      no: 'YS-2026-324',
      name: '瑞航商务中心项目竣工验收',
      type: 'acceptance_lifecycle',
      viewVariant: 'warranty',
      warrantyOwner: '瑞航建设工程有限公司',
      warrantyStartDate: '2026-07-19',
      warrantyEndDate: '2028-07-18',
      warrantyConfirmationOrganization: '',
      warrantyConfirmationDate: '',
      status: 'warranty',
    }]
    centralSummary = {
      projects: [],
      contracts: [],
      statuses: [
        { value: 'accepted', label: '已验收', count: 2 },
        { value: 'warranty', label: '保修中', count: 3 },
        { value: 'expired', label: '已到期', count: 4 },
      ],
      documentTypes: [],
      origins: {
        real: { count: 9 },
        demo: { count: 0 },
      },
    }

    render(OwnerDocumentListScreen, { props: { kind: 'acceptance' }, global })

    expect(screen.getByRole('navigation', { name: '验收保修列表视图' })).not.toBeNull()
    const table = screen.getByRole('region', { name: '业务单据宽表' })
    const headings = within(table).getAllByRole('columnheader').map(item => item.textContent)
    expect(headings).toEqual(expect.arrayContaining([
      '验收编号',
      '保修责任单位',
      '保修开始',
      '保修结束',
      '到期验收单位',
      '确认日期',
    ]))
    expect(headings).not.toContain('验收单位')
    const views = JSON.parse(document.querySelector('[data-ui="owner-document-list-toolbar"]')?.getAttribute('data-views') ?? '[]')
    expect(views.find((view: { key: string }) => view.key === 'warranty')?.count).toBe(3)
    expect(views.find((view: { key: string }) => view.key === 'expired')?.count).toBe(4)
    await vi.waitFor(() => expect(loadKind).toHaveBeenCalledWith('acceptance', expect.objectContaining({
      variant: 'warranty',
      status: null,
    })))
  })

  it('甲方罚扣主编号链接进入专属只读详情并保留列表返回上下文', async () => {
    runtime.desktop = false
    route.path = '/owner/penalty'
    route.query = {}
    activeRows = [{
      ...listRows[0]!,
      id: 'owner-penalty-real-326',
      no: 'FK-2026-326',
      name: '施工进度延误',
      type: 'owner_penalty',
      noticeNo: 'LX-2026-326',
      amount: 36000,
      status: 'submitted',
    }]

    render(OwnerDocumentListScreen, { props: { kind: 'owner_penalty' }, global })

    await vi.waitFor(() => expect(loadKind).toHaveBeenCalledWith('owner_penalty', expect.objectContaining({
      status: null,
      variant: null,
    })))
    const link = screen.getByRole('link', { name: 'FK-2026-326' })
    expect(link.getAttribute('href')).toBe('/owner/penalty/owner-penalty-real-326?origin=real')
    await fireEvent.click(link)
    expect(navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      path: '/owner/penalty/owner-penalty-real-326',
      query: expect.objectContaining({
        origin: 'real',
        returnTo: expect.stringContaining('/owner/penalty'),
      }),
    }))
  })
})
