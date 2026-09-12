import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import SupplierListScreen from '~/components/supplier/SupplierListScreen.vue'
import KitColumnHeader from '~/components/ui/KitColumnHeader.vue'

const readStore = vi.hoisted(() => ({ listState: { kind: 'ready', data: { items: [], summary: { categories: [], credentialStatuses: [], taxpayerTypes: [] }, pagination: { page: 1, pageSize: 20, total: 0 }, capabilities: [] } }, loadList: vi.fn().mockResolvedValue(undefined) }))
vi.mock('~/stores/supplier-read', () => ({ useSupplierReadStore: () => readStore }))
vi.mock('~/stores/supplier-command', () => ({ useSupplierCommandStore: () => ({ latestWrite: null }) }))

afterEach(() => {
  vi.unstubAllGlobals()
  readStore.loadList.mockClear()
})

describe('分供方营业执照真实状态筛选', () => {
  it('三态多选通过中央查询生效且不新增排序，清除后取消过滤', async () => {
    vi.stubGlobal('useRoute', () => ({ path: '/base/supplier', query: {}, hash: '' }))
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
})
