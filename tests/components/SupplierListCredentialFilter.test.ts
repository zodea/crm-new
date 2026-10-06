import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import SupplierListScreen from '~/components/supplier/SupplierListScreen.vue'
import KitColumnHeader from '~/components/ui/KitColumnHeader.vue'

const readStore = vi.hoisted(() => ({ listState: { kind: 'ready', data: { items: [], summary: { categories: [], credentialStatuses: [], taxpayerTypes: [] }, pagination: { requestedPage: 1, page: 1, pageSize: 20, total: 0 }, capabilities: [] } } as any, listQuery: null as any, loadList: vi.fn().mockResolvedValue(undefined) }))
const reactiveReadStore = reactive(readStore)
vi.mock('~/stores/supplier-read', () => ({ useSupplierReadStore: () => reactiveReadStore }))
vi.mock('~/stores/supplier-command', () => ({ useSupplierCommandStore: () => ({ latestWrite: null }) }))

afterEach(() => {
  vi.unstubAllGlobals()
  readStore.loadList.mockReset().mockResolvedValue(undefined)
})

describe('分供方营业执照真实状态筛选', () => {
  it('三态多选通过中央查询生效且不新增排序，清除后取消过滤', async () => {
    vi.stubGlobal('useRoute', () => ({ path: '/base/supplier', query: {}, hash: '' }))
    vi.stubGlobal('useRouter', () => ({ replace: vi.fn() }))
    vi.stubGlobal('useDataVisibilityStore', () => ({ includeDemo: false }))
    vi.stubGlobal('useKitUI', () => ({ error: vi.fn(), typeSelect: vi.fn() }))
    render(SupplierListScreen, { global: {
      components: { KitColumnHeader },
      stubs: {
        ListShell: { template: '<main><slot name="toolbar"/><slot name="table"/></main>' },
        SupplierListControls: true,
        StatePanel: true,
        KitTable: defineComponent({ props: ['columns'], template: '<section><template v-for="column in columns" :key="column.field"><slot v-if="column.field === \'businessLicense\' && column.customHeader" name="columnHeader" :column="column" /></template></section>' }),
      },
    } })
    await fireEvent.click(screen.getByRole('button', { name: '筛选营业执照' }))
    const filter = screen.getByRole('dialog', { name: '筛选营业执照' })
    expect(within(filter).queryByText('升序')).toBeNull()
    expect(within(filter).getByRole('checkbox', { name: '有原件' })).toBeTruthy()
    expect(within(filter).getByRole('checkbox', { name: '缺少原件' })).toBeTruthy()
    expect(within(filter).getByRole('checkbox', { name: '不可用' })).toBeTruthy()
    await fireEvent.click(within(filter).getByRole('checkbox', { name: '有原件' }))
    await fireEvent.click(within(filter).getByRole('checkbox', { name: '不可用' }))
    await fireEvent.click(within(filter).getByRole('button', { name: '应用' }))
    await waitFor(() => expect(readStore.loadList).toHaveBeenLastCalledWith(expect.objectContaining({ columnFilters: { businessLicense: ['available', 'unavailable'] }, sort: 'updated-desc' })))
    await fireEvent.click(screen.getByRole('button', { name: '筛选营业执照' }))
    await fireEvent.click(screen.getByRole('button', { name: '清除' }))
    await waitFor(() => expect(readStore.loadList).toHaveBeenLastCalledWith(expect.objectContaining({ columnFilters: { businessLicense: [] } })))
  })

  it('只有当前查询的合法回读可以把越界页写回URL；搜索已变化的迟到旧响应不能覆盖', async () => {
    const route = reactive({ path: '/base/supplier', query: { page: '99', search: '原查询' }, hash: '#supplier-row-real%3Aold' })
    const replace = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useRouter', () => ({ replace }))
    vi.stubGlobal('useDataVisibilityStore', () => ({ includeDemo: false }))
    vi.stubGlobal('useKitUI', () => ({ error: vi.fn(), typeSelect: vi.fn() }))
    let finish!: () => void
    readStore.loadList.mockImplementationOnce(async (query) => {
      reactiveReadStore.listQuery = query
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      reactiveReadStore.listState = { kind: 'ready', data: { items: [], summary: { categories: [], credentialStatuses: [], taxpayerTypes: [] }, pagination: { requestedPage: 99, page: 1, pageSize: 20, total: 0 }, capabilities: [] } }
    })
    readStore.loadList.mockImplementation(async (query) => {
      reactiveReadStore.listQuery = query
      reactiveReadStore.listState = { kind: 'ready', data: { items: [], summary: { categories: [], credentialStatuses: [], taxpayerTypes: [] }, pagination: { requestedPage: query.page, page: 1, pageSize: 20, total: 0 }, capabilities: [] } }
    })
    const view = render(SupplierListScreen, { global: { stubs: {
      ListShell: { template: '<main><slot name="toolbar"/></main>' },
      SupplierListControls: { props: ['search'], emits: ['update:search', 'refresh'], template: '<div><input aria-label="搜索" :value="search" @input="$emit(\'update:search\', $event.target.value)"/><button @click="$emit(\'refresh\')">刷新</button></div>' },
      StatePanel: true,
    } } })
    await waitFor(() => expect(readStore.loadList).toHaveBeenCalled())
    await fireEvent.update(screen.getByRole('textbox', { name: '搜索' }), '新查询')
    finish()
    await waitFor(() => expect(readStore.loadList).toHaveBeenCalledWith(expect.objectContaining({ search: '新查询', page: 1 })))
    expect(replace).not.toHaveBeenCalled()
    view.unmount()

    readStore.loadList.mockClear()
    render(SupplierListScreen, { global: { stubs: { ListShell: true, StatePanel: true } } })
    await waitFor(() => expect(replace).toHaveBeenCalledWith({ path: '/base/supplier', query: { search: '原查询' }, hash: route.hash }))
  })
})
