import type { MaterialContractListPageDTO } from '~/lib/material-contract/repository'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, onActivated, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import MaterialContractListScreen from '~/components/contract/MaterialContractListScreen.vue'
import { materialOriginMeta } from '../helpers/material-read-meta'

const mocks = vi.hoisted(() => ({
  store: {
    listState: { kind: 'idle' } as any,
    listQuery: null as any,
    loadList: vi.fn().mockResolvedValue(undefined),
  },
  visibility: { includeDemo: false },
}))

vi.mock('~/stores/material-contract-read', () => ({ useMaterialContractReadStore: () => mocks.store }))
vi.mock('~/stores/data-visibility', () => ({ useDataVisibilityStore: () => mocks.visibility }))

const route = reactive({
  path: '/contract/material',
  fullPath: '/contract/material',
  query: {} as Record<string, string>,
})
const replace = vi.fn()

const contract = {
  rowKey: 'real:contract-material-1',
  dataOrigin: 'real',
  id: 'contract-material-1',
  no: 'CG-001',
  name: '瓷砖采购合同',
  navigation: {
    kind: 'entity-detail',
    subject: { state: 'resolved', entity: 'contract', id: 'contract-material-1', label: '瓷砖采购合同', no: 'CG-001' },
    variant: 'detail',
    view: null,
    filters: { dataOrigin: 'real', contractKind: '材采' },
  },
  project: { state: 'resolved', entity: 'project', id: 'project-1', label: '中央项目', no: 'XM-001' },
  projectNavigation: { kind: 'unavailable', reason: 'missing-route' },
  supplier: { state: 'resolved', entity: 'supplier', id: 'supplier-1', label: '中央分供方', no: 'FGF-001' },
  supplierNavigation: { kind: 'unavailable', reason: 'missing-route' },
  amounts: { contract: '100.00', changed: '110.00', settled: '20.00', invoiced: '20.00', paid: '10.00', payable: '10.00' },
  signDate: '2026-08-01',
  status: '履约中',
  updatedAt: '2026-08-24T00:00:00.000Z',
} as const

function page(items: MaterialContractListPageDTO['items'] = [contract as any]): MaterialContractListPageDTO {
  const originMeta = materialOriginMeta(['material-contract:read'], 'component-test-v1')
  return {
    meta: originMeta.real,
    originMeta,
    items,
    pagination: { page: 2, pageSize: 20, total: items.length ? 21 : 0 },
    summary: {
      projects: [{ id: 'project-1', label: '中央项目' }],
      suppliers: [{ id: 'supplier-1', label: '中央分供方' }],
      statuses: [{ value: '履约中', count: items.length }],
      origins: {
        real: { contractCount: items.length, changedAmount: '110.00', invoicedAmount: '20.00', paidAmount: '10.00' },
        demo: { contractCount: 0, changedAmount: '0.00', invoicedAmount: '0.00', paidAmount: '0.00' },
      },
    },
    empty: items.length ? null : { reason: 'no-filter-match', missingRelations: [] },
    asOf: '2026-08-24T00:00:00.000Z',
    sourceVersion: originMeta.real.sourceVersion,
    capabilities: ['material-contract:read'],
  }
}

const KitTableStub = defineComponent({
  props: { data: { type: Array, default: () => [] } },
  setup(props, { slots }) {
    return () => h('section', { 'aria-label': '材料采购合同表格' }, (props.data as any[]).map(row => h('div', { role: 'row' }, [
      slots.name?.({ row }),
      slots.origin?.({ row }),
      slots.project?.({ row }),
      slots.supplier?.({ row }),
      slots.changed?.({ row }),
      slots.invoiced?.({ row }),
      slots.paid?.({ row }),
    ])))
  },
})

const global = {
  stubs: { TargetCostSourceReturn: true },
  components: {
    KitTable: KitTableStub,
    NuxtLink: defineComponent({
      props: ['to'],
      template: '<a :href="to"><slot /></a>',
    }),
    StatePanel: defineComponent({
      props: ['title', 'description'],
      template: '<div role="status">{{ title }} {{ description }}</div>',
    }),
  },
}

function setRoute(input: string) {
  const url = new URL(input, 'https://ruihang.invalid')
  route.path = url.pathname
  route.fullPath = `${url.pathname}${url.search}${url.hash}`
  route.query = Object.fromEntries(url.searchParams)
}

describe('材料采购合同列表返回上下文', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-24T08:00:00Z'))
    sessionStorage.clear()
    document.querySelectorAll('[data-shell-workspace]').forEach(item => item.remove())
    mocks.store.loadList.mockReset().mockResolvedValue(undefined)
    mocks.store.listQuery = null
    mocks.store.listState = { kind: 'ready', data: page() }
    mocks.store = reactive(mocks.store)
    mocks.visibility.includeDemo = false
    replace.mockReset()
    setRoute('/contract/material?search=%E7%93%B7%E7%A0%96&projectId=project-1&origin=real&page=2&pageSize=20&returnTo=%2Fproject%2Fproject-1%3Forigin%3Dreal')
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('nextTick', nextTick)
    vi.stubGlobal('onActivated', onActivated)
    vi.stubGlobal('onMounted', onMounted)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('shallowRef', shallowRef)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useRouter', () => ({ replace }))
    vi.stubGlobal('useTabTitle', () => {})
  })

  it('从第二页进入合同后恢复筛选、页码、滚动位置与原行焦点', async () => {
    const workspace = document.createElement('div')
    workspace.dataset.shellWorkspace = ''
    workspace.scrollTop = 684
    document.body.append(workspace)

    const first = render(MaterialContractListScreen, { global })
    const link = await screen.findByRole('link', { name: '瓷砖采购合同' })
    expect(link.getAttribute('href')).toContain('returnTo=')
    await fireEvent.click(link)

    const contextId = new URL(link.getAttribute('href')!, 'https://ruihang.invalid')
      .searchParams
      .get('returnTo')!
      .match(/[?&]nav=([^&#]+)/)?.[1]
    expect(contextId).toMatch(/^[\w-]{8,64}$/)
    const stored = JSON.parse(sessionStorage.getItem(`ruihang:material-contract-return:${contextId}`)!)
    expect(stored.scrollTop).toBe(684)
    expect(stored.returnTo).toContain('search=%E7%93%B7%E7%A0%96')
    expect(stored.returnTo).toContain('projectId=project-1')
    expect(stored.returnTo).toContain('page=2')
    expect(stored.returnTo).toContain('pageSize=20')

    first.unmount()
    workspace.scrollTop = 0
    setRoute(stored.returnTo)
    render(MaterialContractListScreen, { global })

    const restoredLink = await screen.findByRole('link', { name: '瓷砖采购合同' })
    await waitFor(() => expect(document.activeElement).toBe(restoredLink))
    expect(workspace.scrollTop).toBe(684)
    expect(mocks.store.loadList).toHaveBeenLastCalledWith(expect.objectContaining({
      search: '瓷砖',
      projectId: 'project-1',
      origin: 'real',
      page: 2,
      pageSize: 20,
    }))
  })

  it('同代读取的实际末页回写地址并保留筛选；旧读取迟到不改新地址', async () => {
    setRoute('/contract/material?origin=real&search=原筛选&page=99&pageSize=20')
    let finish!: () => void
    mocks.store.loadList.mockImplementationOnce((query: any) => new Promise<void>((resolve) => {
      finish = () => {
        const data = page()
        data.pagination = { requestedPage: 99, page: 2, pageSize: 20, total: 21 }
        mocks.store.listQuery = { ...query }
        mocks.store.listState = { kind: 'ready', data }
        resolve()
      }
    }))
    const view = render(MaterialContractListScreen, { global })
    finish()
    await waitFor(() => expect(replace).toHaveBeenCalledWith({ query: { origin: 'real', search: '原筛选', page: '2', pageSize: '20' } }))
    view.unmount()

    replace.mockClear()
    setRoute('/contract/material?origin=real&page=99&pageSize=20')
    mocks.store.loadList.mockImplementationOnce((query: any) => new Promise<void>((resolve) => {
      finish = () => {
        const data = page()
        data.pagination = { requestedPage: 99, page: 2, pageSize: 20, total: 21 }
        mocks.store.listQuery = { ...query }
        mocks.store.listState = { kind: 'ready', data }
        resolve()
      }
    }))
    render(MaterialContractListScreen, { global })
    setRoute('/contract/material?origin=real&search=新的筛选&page=3&pageSize=20')
    await nextTick()
    finish()
    await nextTick()
    expect(replace).not.toHaveBeenCalled()
  })

  it('混合来源列表按所点击行记录真实来源，不从缺省查询猜测', async () => {
    const demoContract = {
      ...contract,
      rowKey: 'demo:contract-material-1',
      dataOrigin: 'demo',
      navigation: {
        ...contract.navigation,
        filters: { dataOrigin: 'demo', contractKind: '材采' },
      },
    } as const
    mocks.store.listState = { kind: 'ready', data: page([demoContract as any]) }
    setRoute('/contract/material?search=%E7%93%B7%E7%A0%96')

    render(MaterialContractListScreen, { global })
    const link = await screen.findByRole('link', { name: '瓷砖采购合同' })
    const returnTo = new URL(link.getAttribute('href')!, 'https://ruihang.invalid').searchParams.get('returnTo')

    expect(returnTo).toContain('search=%E7%93%B7%E7%A0%96')
    expect(returnTo).toContain('origin=demo')
    expect(returnTo).toContain('#material-contract-row-demo%3Acontract-material-1')
  })

  it('原合同行消失时恢复滚动位置并把焦点降级到列表标题', async () => {
    const contextId = 'origin_missing_contract'
    const returnTo = `/contract/material?origin=real&page=2&pageSize=20&nav=${contextId}#material-contract-row-real%3Amissing`
    sessionStorage.setItem(`ruihang:material-contract-return:${contextId}`, JSON.stringify({
      id: contextId,
      returnTo,
      anchorId: 'material-contract-row-real:missing',
      scrollTop: 320,
      expiresAt: Date.now() + 60_000,
    }))
    mocks.store.listState = { kind: 'empty', data: page([]), empty: page([]).empty }
    setRoute(returnTo)
    const workspace = document.createElement('div')
    workspace.dataset.shellWorkspace = ''
    document.body.append(workspace)

    render(MaterialContractListScreen, { global })

    const heading = screen.getByRole('heading', { name: '材料采购合同' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(workspace.scrollTop).toBe(320)
  })

  it.each([
    { label: '尚无快照', previous: null },
    { label: '旧快照仍有同一行', previous: page() },
  ])('返回期间先等待当前读取完成再恢复行焦点：$label', async ({ previous }) => {
    const contextId = 'origin_delayed_contract'
    const returnTo = `/contract/material?origin=real&nav=${contextId}#material-contract-row-real%3Acontract-material-1`
    sessionStorage.setItem(`ruihang:material-contract-return:${contextId}`, JSON.stringify({
      id: contextId,
      returnTo,
      anchorId: 'material-contract-row-real:contract-material-1',
      scrollTop: 210,
      expiresAt: Date.now() + 60_000,
    }))
    const delayed = reactive({ kind: 'loading', previous, data: page() })
    mocks.store.listState = delayed
    setRoute(returnTo)
    const inactiveAnchor = document.createElement('a')
    inactiveAnchor.id = 'material-contract-row-real:contract-material-1'
    inactiveAnchor.tabIndex = 0
    document.body.append(inactiveAnchor)
    const rendered = render(MaterialContractListScreen, { global })
    try {
      await nextTick()
      await nextTick()
      expect(document.activeElement).not.toBe(inactiveAnchor)
      expect(document.activeElement).not.toBe(screen.getByRole('heading', { name: '材料采购合同' }))
      delayed.kind = 'ready'
      const link = await screen.findByRole('link', { name: '瓷砖采购合同' })
      await waitFor(() => expect(document.activeElement).toBe(link))
    }
    finally {
      rendered.unmount()
      inactiveAnchor.remove()
    }
  })
})
