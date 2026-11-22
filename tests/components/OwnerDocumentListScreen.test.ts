import type { OwnerDocumentListRecord } from '~/lib/owner-document/forms'
import { fireEvent, render, screen, within } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  computed,
  defineComponent,
  h,
  nextTick,
  onActivated,
  onMounted,
  reactive,
  shallowRef,
  watch,
} from 'vue'
import OwnerDocumentListScreen from '~/components/owner-document/OwnerDocumentListScreen.vue'
import { createOwnerDocumentReturnOrigin, saveOwnerDocumentReturnOrigin } from '~/lib/owner-document/return-context'

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
  props: ['title', 'project', 'type', 'view', 'projectOptions', 'typeOptions', 'views', 'canCreate', 'createLabel'],
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
      props.canCreate ? h('button', { onClick: () => emit('create') }, props.createLabel) : null,
      select('项目', props.project, props.projectOptions, 'update:project'),
      select('类型', props.type, props.typeOptions, 'update:type'),
      select('状态', props.view, props.views, 'update:view'),
    ])
  },
})

const KitTableStub = defineComponent({
  inheritAttrs: false,
  props: ['columns', 'data', 'empty', 'page', 'loading'],
  emits: ['emptyAction', 'pageChange'],
  setup(props, { attrs, emit, slots }) {
    return () => h('section', {
      ...attrs,
      'aria-label': '业务单据宽表',
      'data-loading': String(Boolean(props.loading)),
      'data-min-width': (props.columns as any[]).reduce(
        (sum, column) => sum + (column.width ?? column.minWidth ?? 0),
        0,
      ),
    }, [
      h('button', { onClick: () => emit('pageChange', { page: props.page.page + 1, pageSize: props.page.pageSize }) }, '下一页'),
      h('div', { role: 'row' }, (props.columns as any[]).map(column =>
        h('span', { role: 'columnheader' }, column.title))),
      ...(props.data as any[]).map(row => h('div', { role: 'row' }, [
        slots.document?.({ row }),
        ` ${row.name} `,
        slots.contract?.({ row }),
        slots.supplier?.({ row }),
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
const loadKind = vi.fn(async (_kind?: unknown, _query?: { page: number, pageSize: number }) => listRows)
const centralPagination = shallowRef({ page: 1, pageSize: 10, total: 25 })
let activeRows = listRows
let centralEmptyReason: 'no-records' | 'no-filter-match' | 'missing-relation' | null = null
let centralSummary: any = null
let centralCapabilities: string[] = ['owner-document:write']

const global = {
  components: {
    EntityLink: defineComponent({ props: ['label', 'intent'], template: '<a href="#" :data-entity="intent?.subject?.entity">{{ label }}</a>' }),
    KitTable: KitTableStub,
    NuxtLink: defineComponent({ props: ['to'], template: '<a :href="to"><slot /></a>' }),
    OwnerDocumentListToolbar: ToolbarStub,
    RowActionMenu: true,
    TargetCostSourceReturn: true,
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
    centralCapabilities = ['owner-document:write']
    navigateTo.mockReset()
    loadKind.mockReset().mockResolvedValue(listRows)
    centralPagination.value = { page: 1, pageSize: 10, total: 25 }
    route.path = '/owner/change'
    route.query = { project: 'project-1' }
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('nextTick', nextTick)
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
      hasListSnapshot: () => true,
      recordsFor: () => activeRows,
      listLoadingFor: () => false,
      listError: () => '',
      loadKind,
      centralPageFor: () => centralPagination.value,
      centralSummaryFor: () => centralSummary,
      centralCapabilitiesFor: () => centralCapabilities,
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

  it('列表完整总额缺失时呈现已知小计和缺项，不把真实零与未知混为一谈', () => {
    runtime.desktop = false
    route.query = {}
    centralSummary = { projects: [], contracts: [], statuses: [], documentTypes: [], origins: { real: {
      count: 2,
      taxInclusiveAmount: null,
      taxExclusiveAmount: '0.00',
      appliedTaxExclusiveAmount: '0.00',
      amountCompleteness: {
        taxInclusiveAmount: { knownValue: '12.00', missingCount: 1 },
        taxExclusiveAmount: { knownValue: '0.00', missingCount: 0 },
        appliedTaxExclusiveAmount: { knownValue: '0.00', missingCount: 0 },
      },
    } } }
    render(OwnerDocumentListScreen, { props: { kind: 'owner_change' }, global })
    const summary = screen.getByRole('status', { name: '甲方变洽签列表汇总' })
    expect(summary.textContent).toMatch(/含税审定金额总和：\s*未记录/)
    expect(summary.textContent).toContain('已知小计 ¥12.00，缺 1 项')
    expect(summary.textContent).toMatch(/无税申报金额总和：\s*¥0.00/)
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

  it('中央第二页改筛选只请求一次，等待结果时保留旧页行且不显示加载遮罩', async () => {
    runtime.desktop = false
    route.query = {}
    const snapshot = shallowRef(listRows)
    const pending = shallowRef(false)
    const pagination = shallowRef({ page: 1, pageSize: 20, total: 40 })
    const fetchPage = vi.fn(async (_kind: string, query: { page: number, pageSize: number }) => {
      pagination.value = { ...pagination.value, page: query.page, pageSize: query.pageSize }
      return snapshot.value
    })
    vi.stubGlobal('useOwnerDocumentStore', () => ({
      hasListSnapshot: () => true,
      recordsFor: () => snapshot.value,
      listLoadingFor: () => pending.value,
      listError: () => '',
      loadKind: fetchPage,
      centralPageFor: () => pagination.value,
      centralSummaryFor: () => null,
      centralCapabilitiesFor: () => [],
      centralEmptyReasonFor: () => null,
    }))
    render(OwnerDocumentListScreen, { props: { kind: 'owner_change' }, global })
    await vi.waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(1))
    await fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await vi.waitFor(() => expect(fetchPage).toHaveBeenLastCalledWith('owner_change', expect.objectContaining({ page: 2 })))
    fetchPage.mockClear()
    let complete!: () => void
    fetchPage.mockImplementation(async (_kind, query) => {
      pending.value = true
      await new Promise<void>(resolve => complete = resolve)
      snapshot.value = [{ ...listRows[0]!, id: 'filtered', no: 'BQ-002', name: '筛选后签证', status: 'submitted' }]
      pagination.value = { page: query.page, pageSize: query.pageSize, total: 1 }
      pending.value = false
      return snapshot.value
    })
    await fireEvent.update(screen.getByRole('combobox', { name: '状态' }), 'submitted')
    await vi.waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(1))
    expect(fetchPage).toHaveBeenLastCalledWith('owner_change', expect.objectContaining({ page: 1, status: 'submitted' }))
    expect(document.querySelector('[data-ui="owner-document-table"]')?.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByRole('region', { name: '业务单据宽表' }).getAttribute('data-loading')).toBe('false')
    expect(screen.getByRole('link', { name: 'BQ-001' })).not.toBeNull()
    complete()
    await vi.waitFor(() => expect(screen.getByRole('link', { name: 'BQ-002' })).not.toBeNull())
    expect(screen.queryByRole('link', { name: 'BQ-001' })).toBeNull()
    expect(fetchPage).toHaveBeenCalledTimes(1)
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
          subcontractApprovedAmount: '0.00',
          subcontractActualApproved: { value: null, status: 'missing' },
        },
        demo: {
          count: 0,
          reportedAmount: '0.00',
          auditedAmount: '0.00',
          taxInclusiveAmount: '0.00',
          taxExclusiveAmount: '0.00',
          appliedTaxExclusiveAmount: '0.00',
          subcontractApprovedAmount: '0.00',
          subcontractActualApproved: { value: null, status: 'missing' },
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

  it.each([
    { label: '上一查询仍有旧行', previousRows: listRows },
    { label: '首次查询尚无行', previousRows: [] },
  ])('返回来源在$label时等待读取完成，再聚焦本实例中的行', async ({ previousRows }) => {
    runtime.desktop = false
    const now = Date.parse('2026-10-03T04:00:00Z')
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    const origin = createOwnerDocumentReturnOrigin({
      kind: 'owner_change',
      contextId: 'origin_0123456789abcdef0123456789abcdef',
      rowIdentity: 'real:owner_change:change-1',
      scrollTop: 0,
      now,
      state: { search: '', projectId: null, contractId: null, supplierId: null, status: 'approved', documentType: [], origin: 'real', page: 1, pageSize: 20 },
    })
    const target = new URL(origin.returnTo, 'https://ruihang.invalid')
    const currentRoute = reactive({ path: target.pathname, query: Object.fromEntries(target.searchParams), fullPath: origin.returnTo })
    const snapshot = shallowRef<OwnerDocumentListRecord[]>(previousRows)
    const pending = shallowRef(false)
    let complete!: () => void
    const fetchPage = vi.fn(async () => {
      pending.value = true
      await new Promise<void>((resolve) => {
        complete = resolve
      })
      snapshot.value = listRows
      pending.value = false
      return snapshot.value
    })
    const outside = document.createElement('a')
    outside.href = '#outside'
    outside.id = origin.anchorId
    outside.textContent = '其他页签中的同名单据'
    const previousFocus = document.createElement('button')
    previousFocus.textContent = '返回入口'
    document.body.append(outside, previousFocus)
    previousFocus.focus()
    saveOwnerDocumentReturnOrigin(origin)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      queueMicrotask(() => callback(0))
      return 0
    })
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    vi.stubGlobal('useRoute', () => currentRoute)
    vi.stubGlobal('useOwnerDocumentStore', () => ({
      hasListSnapshot: () => true,
      recordsFor: () => snapshot.value,
      listLoadingFor: () => pending.value,
      listError: () => '',
      loadKind: fetchPage,
      centralPageFor: () => ({ page: 1, pageSize: 20, total: 1 }),
      centralSummaryFor: () => null,
      centralCapabilitiesFor: () => [],
      centralEmptyReasonFor: () => null,
    }))
    try {
      render(OwnerDocumentListScreen, { props: { kind: 'owner_change' }, global })
      await flushPromises()
      expect(pending.value).toBe(true)
      expect(document.activeElement).toBe(previousFocus)
      complete()
      await flushPromises()
      const ownRow = screen.getByRole('link', { name: 'BQ-001' })
      await vi.waitFor(() => expect(document.activeElement).toBe(ownRow))
      expect(document.activeElement).not.toBe(outside)
    }
    finally {
      complete?.()
      outside.remove()
      previousFocus.remove()
      sessionStorage.removeItem(`ruihang:owner-document-return:${origin.id}`)
      clock.mockRestore()
    }
  })

  it.each([
    {
      label: '新项目及完整筛选',
      query: { projectId: 'project-next', contractId: 'contract-next', supplierId: 'supplier-next', search: '新来源搜索', status: 'submitted', documentType: 'site_visa', page: '3', pageSize: '50' },
      expected: { projectId: 'project-next', contractId: 'contract-next', supplierId: 'supplier-next', search: '新来源搜索', status: 'submitted', documentType: 'site_visa', page: 3, pageSize: 50 },
    },
    {
      label: '不带来源与筛选的新入口',
      query: {},
      expected: { projectId: null, contractId: null, supplierId: null, search: '', status: 'approved', documentType: null, page: 1, pageSize: 20 },
    },
  ])('中央同路径复用应用$label，不沿用旧来源条件', async ({ query, expected }) => {
    runtime.desktop = false
    const currentRoute = reactive({ path: '/owner/change', query: { projectId: 'project-old', search: '旧来源搜索', status: 'approved', page: '2', pageSize: '10' } as Record<string, string> })
    const replace = vi.fn(async (target: { query: Record<string, string> }) => {
      await nextTick()
      currentRoute.query = { ...target.query }
    })
    vi.stubGlobal('useRoute', () => currentRoute)
    vi.stubGlobal('useRouter', () => ({ replace }))
    render(OwnerDocumentListScreen, { props: { kind: 'owner_change' }, global })
    await nextTick()
    loadKind.mockClear()
    currentRoute.query = { ...query } as Record<string, string>
    await nextTick()
    await vi.waitFor(() => expect(loadKind).toHaveBeenLastCalledWith('owner_change', expect.objectContaining(expected)))
    expect(currentRoute.query).toEqual(query)
    expect(loadKind).toHaveBeenCalledTimes(1)
  })

  it.each([
    { source: 'projectId', previous: 'project-1', next: 'project-2', kind: 'owner_change', status: 'approved', expected: { projectId: 'project-2', contractId: null, supplierId: null, variant: null } },
    { source: 'contractId', previous: 'contract-1', next: 'contract-2', kind: 'owner_change', status: 'approved', expected: { projectId: null, contractId: 'contract-2', supplierId: null, variant: null } },
    { source: 'supplierId', previous: 'supplier-1', next: 'supplier-2', kind: 'owner_change', status: 'approved', expected: { projectId: null, contractId: null, supplierId: 'supplier-2', variant: null } },
    { source: 'variant', previous: 'acceptance', next: 'warranty', kind: 'acceptance', status: 'all', expected: { projectId: null, contractId: null, supplierId: null, variant: 'warranty' } },
  ] as const)('同路径只改变 $source 时仍保留明确来源页码', async ({ source, previous, next, kind, status, expected }) => {
    runtime.desktop = false
    const currentRoute = reactive({ path: kind === 'acceptance' ? '/owner/acceptance' : '/owner/change', query: { [source]: previous, page: '3', pageSize: '20', status } as Record<string, string> })
    const replace = vi.fn(async (target: { query: Record<string, string> }) => {
      await nextTick()
      currentRoute.query = { ...target.query }
    })
    vi.stubGlobal('useRoute', () => currentRoute)
    vi.stubGlobal('useRouter', () => ({ replace }))
    render(OwnerDocumentListScreen, { props: { kind }, global })
    await nextTick()
    loadKind.mockClear()
    const incoming = { [source]: next, page: '3', pageSize: '20', status }
    currentRoute.query = incoming
    await flushPromises()
    expect(loadKind).toHaveBeenLastCalledWith(kind, expect.objectContaining({ ...expected, page: 3, pageSize: 20 }))
    expect(currentRoute.query).toEqual(incoming)
    expect(loadKind).toHaveBeenCalledTimes(1)
  })

  it.each([
    { source: 'projectId', value: 'project-1', label: '项目' },
    { source: 'contractId', value: 'contract-1', label: '合同' },
    { source: 'supplierId', value: 'supplier-1', label: '分供方' },
  ])('主动清除单个$label来源从第一页开始并保留其他筛选', async ({ source, value }) => {
    runtime.desktop = false
    centralPagination.value = { page: 3, pageSize: 50, total: 150 }
    loadKind.mockImplementation(async (_kind, query) => {
      await nextTick()
      if (query)
        centralPagination.value = { page: query.page, pageSize: query.pageSize, total: 150 }
      return listRows
    })
    const filters = { pageSize: '50', status: 'submitted', search: '保留受控搜索', documentType: 'site_visa' }
    const currentRoute = reactive({ path: '/owner/change', query: { ...filters, [source]: value, page: '3' } as Record<string, string> })
    const replace = vi.fn(async (target: { query: Record<string, string> }) => {
      await nextTick()
      currentRoute.query = { ...target.query }
    })
    navigateTo.mockImplementation(async (target: { query: Record<string, string> }) => {
      await nextTick()
      currentRoute.query = { ...target.query }
    })
    vi.stubGlobal('useRoute', () => currentRoute)
    vi.stubGlobal('useRouter', () => ({ replace }))
    render(OwnerDocumentListScreen, { props: { kind: 'owner_change' }, global })
    await flushPromises()
    expect(centralPagination.value.page).toBe(3)
    loadKind.mockClear()
    await fireEvent.click(screen.getByRole('button', { name: /^清除.+筛选$/ }))
    await flushPromises()
    expect(currentRoute.query).toEqual(filters)
    expect(loadKind).toHaveBeenLastCalledWith('owner_change', expect.objectContaining({ page: 1, pageSize: 50, status: 'submitted', search: '保留受控搜索', documentType: 'site_visa' }))
    expect(loadKind).toHaveBeenCalledTimes(1)
  })

  it.each([
    { previous: 'acceptance', next: 'warranty', page: 3, pageSize: 50, status: 'expired' },
    { previous: 'warranty', next: 'acceptance', page: 4, pageSize: 10, status: 'accepted' },
  ] as const)('同路径返回从 $previous 到 $next 时保留来源分页和 $status 状态', async ({ previous, next, page, pageSize, status }) => {
    runtime.desktop = false
    const currentRoute = reactive({ path: '/owner/acceptance', query: { variant: previous, status: 'all', page: '2' } as Record<string, string> })
    vi.stubGlobal('useRoute', () => currentRoute)
    render(OwnerDocumentListScreen, { props: { kind: 'acceptance' }, global })
    await nextTick()
    loadKind.mockClear()
    const incoming = { variant: next, status, page: String(page), pageSize: String(pageSize) }
    currentRoute.query = incoming
    await nextTick()
    expect(loadKind).toHaveBeenLastCalledWith('acceptance', expect.objectContaining({ variant: next, page, pageSize, status }))
    expect(loadKind).toHaveBeenCalledTimes(1)
    expect(currentRoute.query).toEqual(incoming)
  })

  it.each([
    { label: '项目', source: { projectId: 'project-clear' } },
    { label: '合同', source: { contractId: 'contract-clear' } },
    { label: '分供方', source: { supplierId: 'supplier-clear' } },
    { label: '组合来源', source: { projectId: 'project-clear', contractId: 'contract-clear', supplierId: 'supplier-clear' } },
  ])('中央空态清除$label条件后，普通筛选同步不能写回旧来源', async ({ source }) => {
    runtime.desktop = false
    activeRows = []
    centralEmptyReason = 'no-filter-match'
    const currentRoute = reactive({ path: '/owner/change', query: { ...source, search: '无匹配受控搜索', status: 'approved' } as Record<string, string> })
    const replace = vi.fn(async (target: { query: Record<string, string> }) => {
      await nextTick()
      currentRoute.query = { ...target.query }
    })
    navigateTo.mockImplementation(async (target: { query: Record<string, string> }) => {
      await nextTick()
      currentRoute.query = { ...target.query }
    })
    vi.stubGlobal('useRoute', () => currentRoute)
    vi.stubGlobal('useRouter', () => ({ replace }))
    render(OwnerDocumentListScreen, { props: { kind: 'owner_change' }, global })
    await nextTick()
    loadKind.mockClear()

    await fireEvent.click(within(screen.getByRole('status', { name: '没有符合条件的甲方变洽签' })).getByRole('button', { name: '清除筛选' }))
    await vi.waitFor(() => expect(currentRoute.query).toEqual({ status: 'all' }))
    expect(document.querySelector('[data-ui="owner-document-route-context"]')).toBeNull()
    await vi.waitFor(() => expect(loadKind).toHaveBeenLastCalledWith('owner_change', expect.objectContaining({
      search: '',
      projectId: null,
      contractId: null,
      supplierId: null,
      status: null,
    })))
    expect(loadKind).toHaveBeenCalledTimes(1)
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

  it('分包变洽签全局列表使用中央只读链、专属权限与稳定关系', async () => {
    runtime.desktop = false
    route.path = '/subcontract/change'
    route.query = { supplier: 'supplier-327' }
    centralCapabilities = ['subcontract-document:read', 'subcontract-document:write']
    centralSummary = {
      projects: [],
      contracts: [],
      statuses: [{ value: 'submitted', label: '已提交', count: 1 }],
      documentTypes: [],
      origins: {
        real: {
          count: 1,
          reportedAmount: '0.00',
          auditedAmount: '0.00',
          taxInclusiveAmount: '0.00',
          taxExclusiveAmount: '0.00',
          appliedTaxExclusiveAmount: '0.00',
          subcontractApprovedAmount: '32000.00',
          subcontractActualApproved: { value: '0.00', status: 'partial' },
        },
        demo: {
          count: 0,
          reportedAmount: '0.00',
          auditedAmount: '0.00',
          taxInclusiveAmount: '0.00',
          taxExclusiveAmount: '0.00',
          appliedTaxExclusiveAmount: '0.00',
          subcontractApprovedAmount: '0.00',
          subcontractActualApproved: { value: null, status: 'missing' },
        },
      },
    }
    activeRows = [{
      ...listRows[0]!,
      id: 'sub-change-327',
      no: 'FB-BQ-327',
      name: '样板层范围调整',
      projectId: 'project-327',
      projectName: '瑞航商务中心项目',
      contractId: 'subcontract-327',
      contractName: '主体劳务分包合同',
      supplierId: 'supplier-327',
      supplierName: '联创建筑劳务',
      type: '增项',
      amount: 32000,
      secondaryAmount: 30000,
      quantity: 128.5,
      status: 'submitted',
      contractNavigation: {
        kind: 'entity-detail',
        subject: { state: 'resolved', entity: 'contract', id: 'subcontract-327', label: '主体劳务分包合同', no: 'FB-327' },
        variant: 'detail',
        view: null,
        filters: { dataOrigin: 'real', contractKind: '分包' },
      },
      supplierNavigation: {
        kind: 'entity-detail',
        subject: { state: 'resolved', entity: 'supplier', id: 'supplier-327', label: '联创建筑劳务', no: null },
        variant: 'detail',
        view: null,
        filters: { dataOrigin: 'real' },
      },
    }]

    render(OwnerDocumentListScreen, { props: { kind: 'sub_change' }, global })

    await vi.waitFor(() => expect(loadKind).toHaveBeenCalledWith('sub_change', expect.objectContaining({
      status: null,
      supplierId: 'supplier-327',
    })))
    expect(screen.getByLabelText('来源筛选').textContent).toContain('分供方：联创建筑劳务')
    expect(screen.getByRole('button', { name: '新建分包变洽签' })).not.toBeNull()
    expect(screen.getByRole('link', { name: 'FB-BQ-327' }).getAttribute('href')).toBe('/subcontract/change/sub-change-327?origin=real')
    expect(screen.getByRole('link', { name: '主体劳务分包合同' }).getAttribute('href')).toBe('/contract/subcontract-327?origin=real&contractKind=subcontract')
    expect(screen.getByRole('link', { name: '联创建筑劳务' }).getAttribute('data-entity')).toBe('supplier')
    const summary = screen.getByRole('status', { name: '分包变洽签列表汇总' }).textContent
    expect(summary).toMatch(/审批金额总和：\s*¥32,000\.00/)
    expect(summary).toMatch(/实际审定价总和（部分记录）：\s*¥0\.00/)
  })
})
