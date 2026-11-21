import type { ConstructionContractListPageDTO } from '~/lib/construction-contract/repository'
import type { ReadState } from '~/types/read-model'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, onActivated, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import StatePanel from '~/components/ui/StatePanel.vue'
import { constructionContractProblem } from '~/lib/construction-contract/repository'
import ConstructionContractListScreen from '~/pages/contract/construction/_components/ConstructionContractListScreen.vue'

const listState = shallowRef<ReadState<ConstructionContractListPageDTO>>({ kind: 'idle' })
const store = {
  get listState() { return listState.value },
  loadList: vi.fn().mockResolvedValue(undefined),
}
vi.mock('~/stores/construction-contract-read', () => ({ useConstructionContractReadStore: () => store }))
vi.mock('~/stores/data-visibility', () => ({ useDataVisibilityStore: () => ({ includeDemo: false }) }))

const route = reactive({ path: '/contract/construction', fullPath: '/contract/construction', query: {} as Record<string, string> })
const replace = vi.fn()

function listPage(): ConstructionContractListPageDTO {
  return {
    items: [{
      rowKey: 'real:contract-1',
      dataOrigin: 'real',
      id: 'contract-1',
      no: 'SG-001',
      name: '示例施工合同',
      navigation: {
        kind: 'entity-detail',
        subject: { state: 'resolved', entity: 'contract', id: 'contract-1', label: '示例施工合同', no: 'SG-001' },
        variant: 'detail',
        view: null,
        filters: { dataOrigin: 'real', contractKind: '施工' },
      },
      project: { state: 'resolved', entity: 'project', id: 'project-1', label: '项目甲', no: null },
      projectNavigation: { kind: 'unavailable', reason: 'not-connected' },
      customer: { state: 'resolved', entity: 'customer', id: 'customer-1', label: '客户甲', no: null },
      customerNavigation: { kind: 'unavailable', reason: 'not-connected' },
      amounts: { contract: '100.00', changed: '100.00', settled: '50.00', invoiced: '40.00', received: '30.00', bySettlementReceivable: '20.00', invoicedUnreceived: '10.00' },
      actualCompletionDate: null,
      signDate: '2026-09-01',
      status: '履约中',
      updatedAt: '2026-09-01T00:00:00.000Z',
    }],
    pagination: { requestedPage: 1, page: 1, pageSize: 10, total: 1 },
    summary: {
      projects: [{ id: 'project-1', label: '项目甲' }],
      customers: [{ id: 'customer-1', label: '客户甲' }],
      statuses: [{ value: '履约中', count: 1 }],
      origins: {
        real: { contractCount: 1, changedAmount: '100.00', invoicedAmount: '40.00', receivedAmount: '30.00' },
        demo: { contractCount: 0, changedAmount: '0.00', invoicedAmount: '0.00', receivedAmount: '0.00' },
      },
    },
    empty: null,
    asOf: '2026-09-01T00:00:00.000Z',
    sourceVersion: 'component-test',
    capabilities: ['construction-contract:read', 'construction-contract:write'],
  }
}

const KitTableStub = defineComponent({
  props: ['data', 'page'],
  emits: ['page-change'],
  setup(props, { slots, emit }) {
    return () => h('section', { 'aria-label': '施工合同表格' }, [
      ...props.data.map((row: unknown) => [slots.name?.({ row }), slots.origin?.({ row }), h('span', slots.actualCompletionDate?.({ row })), h('span', slots.received?.({ row })), h('span', slots.receivable?.({ row })), h('span', slots.unreceived?.({ row }))]),
      h('button', { onClick: () => emit('page-change', { page: 2, pageSize: 20 }) }, '下一页'),
    ])
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  route.query = {}
  listState.value = { kind: 'ready', data: listPage() }
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('nextTick', nextTick)
  vi.stubGlobal('onMounted', onMounted)
  vi.stubGlobal('onActivated', onActivated)
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useRouter', () => ({ replace }))
  vi.stubGlobal('useTabTitle', vi.fn())
})

function renderList() {
  return render(ConstructionContractListScreen, {
    global: {
      stubs: { TreeNav: true, SelectFilter: true },
      components: {
        StatePanel,
        KitTable: KitTableStub,
        NuxtLink: defineComponent({ props: ['to'], template: '<a :href="to"><slot /></a>' }),
      },
    },
  })
}

describe('施工合同列表连续工作面', () => {
  it('收款源不可用时合同继续显示，收款及余额为未知并提供独立原因和重试', async () => {
    const page = listPage()
    page.receiptsProblem = constructionContractProblem('unavailable', '收款服务暂时不可用', true)
    Object.assign(page.items[0]!.amounts, { received: null, bySettlementReceivable: null, invoicedUnreceived: null })
    listState.value = { kind: 'ready', data: page }
    renderList()
    expect(screen.getByRole('link', { name: '示例施工合同' })).toBeTruthy()
    expect(screen.queryByText('¥0.00')).toBeNull()
    expect(screen.getByRole('alert', { name: '收款金额暂不可用' })).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: '重新读取收款' }))
    expect(store.loadList).toHaveBeenCalled()
  })

  it('搜索、次行筛选和表尾分页仍修改原查询，保留新建入口', async () => {
    route.query = { page: '3', origin: 'real' }
    const { container } = renderList()
    const toolbar = container.querySelector('[data-list-shell-toolbar]')!
    expect(toolbar.contains(screen.getByRole('heading', { name: '施工合同' }))).toBe(true)
    expect(toolbar.contains(screen.getByRole('searchbox', { name: '搜索施工合同' }))).toBe(true)
    expect(screen.getByRole('link', { name: '新建施工合同' }).getAttribute('href')).toBe('/contract/construction/form')

    await fireEvent.update(screen.getByRole('searchbox'), ' 合同一 ')
    await waitFor(() => expect(replace).toHaveBeenCalledWith({ query: { origin: 'real', search: '合同一' } }))
    await fireEvent.update(screen.getByRole('combobox', { name: '筛选项目' }), 'project-1')
    expect(replace).toHaveBeenLastCalledWith({ query: { origin: 'real', projectId: 'project-1' } })
    await fireEvent.update(screen.getByRole('combobox', { name: '每页数量' }), '50')
    expect(replace).toHaveBeenLastCalledWith({ query: { origin: 'real', pageSize: '50' } })
    await fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(replace).toHaveBeenLastCalledWith({ query: { origin: 'real', page: '2', pageSize: '20' } })
  })

  it('合同名称保留稳定行锚点、来源身份及当前筛选返回路径', async () => {
    route.query = { search: '示例', projectId: 'project-1' }
    renderList()
    const link = screen.getByRole('link', { name: '示例施工合同' })
    const target = new URL(link.getAttribute('href')!, 'https://crm.test')
    expect(link.id).toBe('construction-contract-row-real:contract-1')
    expect(target.pathname).toBe('/contract/contract-1')
    expect(target.searchParams.get('origin')).toBe('real')
    expect(target.searchParams.get('contractKind')).toBe('construction')
    const returnTo = new URL(target.searchParams.get('returnTo')!, 'https://crm.test')
    expect(returnTo.pathname).toBe('/contract/construction')
    expect(returnTo.searchParams.get('search')).toBe('示例')
    expect(returnTo.searchParams.get('projectId')).toBe('project-1')
    expect(screen.getByText('未记录')).toBeTruthy()
  })

  it('无效条件可清除，后台刷新失败保留上一批数据及重试动作', async () => {
    route.query = { pageSize: '7' }
    const first = renderList()
    expect(screen.getByRole('alert', { name: '施工合同查询条件无效' })).toBeTruthy()
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(store.loadList).not.toHaveBeenCalled()
    await fireEvent.click(screen.getByRole('button', { name: '清除无效条件' }))
    expect(replace).toHaveBeenCalledWith({ query: {} })
    first.unmount()

    route.query = {}
    const previous = listPage()
    previous.capabilities = ['construction-contract:read']
    listState.value = { kind: 'error', previous, problem: constructionContractProblem('unavailable', '连接暂不可用', true) }
    renderList()
    expect(screen.getByRole('alert', { name: '刷新施工合同失败' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '示例施工合同' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: '新建施工合同' })).toBeNull()
    store.loadList.mockClear()
    await fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(store.loadList).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 10, includeDemo: false }))
  })

  it('来源暂不可用保留原授权事实，登录失效立即清屏并显示重新登录提示', async () => {
    const previous = listPage()
    previous.capabilities = ['construction-contract:read']
    listState.value = { kind: 'unavailable', previous, problem: constructionContractProblem('unavailable', '合同来源暂不可用', true) }
    renderList()
    expect(screen.getByRole('alert', { name: '刷新施工合同失败' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '示例施工合同' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: '新建施工合同' })).toBeNull()

    listState.value = { kind: 'forbidden', problem: constructionContractProblem('unauthenticated', '登录已失效', false) }
    await nextTick()
    expect(screen.getByText('登录已失效，请重新登录')).toBeTruthy()
    expect(screen.queryByRole('link', { name: '示例施工合同' })).toBeNull()
    expect(screen.queryByRole('link', { name: '新建施工合同' })).toBeNull()
  })

  it('确认越界页已收敛后回写实际页码，保持筛选条件', async () => {
    route.query = { page: '99', search: '施工', projectId: 'project-1' }
    const page = listPage()
    page.pagination.requestedPage = 99
    listState.value = { kind: 'ready', data: page }
    renderList()
    await waitFor(() => expect(replace).toHaveBeenCalledWith({ query: { search: '施工', projectId: 'project-1' } }))
  })

  it('旧越界读取迟到时不能回写新查询的页码或筛选', async () => {
    route.query = { page: '99', search: '旧条件' }
    let finishOld!: () => void
    store.loadList.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishOld = resolve
    }))
    renderList()
    route.query = { page: '3', search: '新条件', projectId: 'project-2' }
    await nextTick()
    const old = listPage()
    old.pagination.requestedPage = 99
    listState.value = { kind: 'ready', data: old }
    finishOld()
    await nextTick()
    await nextTick()
    expect(replace).not.toHaveBeenCalled()
    expect(route.query).toEqual({ page: '3', search: '新条件', projectId: 'project-2' })
  })
})
