import type { CustomerListPageDTO, CustomerListQueryDTO } from '~/lib/customer/read-contract'
import type { ReadState } from '~/types/read-model'
import { render, screen, waitFor } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, onActivated, reactive } from 'vue'
import CustomerListScreen from '~/components/master-data/CustomerListScreen.vue'
import { useCustomerListReturnContext } from '~/composables/useCustomerListReturnContext'
import { buildCustomerListPage } from '~/lib/customer/read-page'
import { attachOriginReadMeta } from '~/lib/read-model/meta'
import { publicReadMeta } from '../helpers/public-read-meta'

const fixtures = vi.hoisted(() => ({ store: null as unknown }))
vi.mock('~/stores/customer-read', () => ({ useCustomerReadStore: () => fixtures.store }))
vi.mock('~/stores/customer-command', () => ({ useCustomerCommandStore: () => ({ latestWrite: null }) }))
const route = reactive({ path: '/base/customer', fullPath: '/base/customer', query: {} as Record<string, string> })
const replace = vi.fn()
let store: { listState: ReadState<CustomerListPageDTO>, loadList: ReturnType<typeof vi.fn> }

function page(query: CustomerListQueryDTO) {
  const asOf = '2026-10-04T08:00:00.000Z'
  const capabilities = ['customer:list:read', 'customer:write']
  const primary = publicReadMeta({ schemaVersion: 'customer-list-v2', dataOrigin: 'real', asOf, sourceVersion: 'empty-owner-revision-2', capabilities, scope: { search: query.search, status: query.status }, requested: true })
  const demo = publicReadMeta({ schemaVersion: 'customer-list-v2', dataOrigin: 'demo', asOf, sourceVersion: null, capabilities, scope: {}, requested: false })
  return attachOriginReadMeta(buildCustomerListPage({ rows: [], query, asOf, sourceVersion: primary.sourceVersion, capabilities }), { real: primary, demo })
}

const global = { components: {
  ListShell: defineComponent({ template: '<main><slot name="toolbar" /><slot name="table" /></main>' }),
  StatePanel: defineComponent({ props: ['title', 'description'], template: '<section role="alert"><h2>{{ title }}</h2><p>{{ description }}</p></section>' }),
}, stubs: { MasterDataListToolbar: true, KitTable: true, CustomerPendingRecovery: true, CustomerDeletedList: true, NuxtLink: true } }

describe('客户列表实际分页和撤权', () => {
  beforeEach(() => {
    route.path = '/base/customer'
    route.fullPath = '/base/customer'
    route.query = {}
    replace.mockReset()
    vi.stubGlobal('useCustomerListReturnContext', useCustomerListReturnContext)
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useRouter', () => ({ replace }))
    vi.stubGlobal('useDataVisibilityStore', () => ({ includeDemo: false }))
    vi.stubGlobal('useKitUI', () => ({ error: vi.fn() }))
    vi.stubGlobal('nextTick', nextTick)
    vi.stubGlobal('onActivated', onActivated)
    store = reactive({ listState: { kind: 'idle' } as ReadState<CustomerListPageDTO>, loadList: vi.fn(async (query: CustomerListQueryDTO) => {
      const data = page(query)
      store.listState = { kind: 'empty', data, empty: data.empty! }
    }) })
    fixtures.store = store
  })

  it('空结果越界归第1页，URL保留100条、筛选和稳定返回身份', async () => {
    route.fullPath = '/base/customer?page=9&pageSize=100&search=原筛选&nav=customer_context_001'
    route.query = { page: '9', pageSize: '100', search: '原筛选', nav: 'customer_context_001' }
    render(CustomerListScreen, { global })
    await waitFor(() => expect(replace).toHaveBeenCalledWith({ query: { ...route.query, page: '1' } }))
    expect(store.loadList).toHaveBeenCalledWith(expect.objectContaining({ page: 9, pageSize: 100, search: '原筛选' }))
  })

  it('离开后迟到的实际页不能改写新目标URL', async () => {
    route.fullPath = '/base/customer?page=9'
    route.query = { page: '9' }
    let release!: () => void
    store.loadList.mockImplementationOnce((query: CustomerListQueryDTO) => new Promise<void>((resolve) => {
      release = () => {
        const data = page(query)
        store.listState = { kind: 'empty', data, empty: data.empty! }
        resolve()
      }
    }))
    const view = render(CustomerListScreen, { global })
    route.path = '/project'
    route.fullPath = '/project?page=3'
    route.query = { page: '3' }
    release()
    await flushPromises()
    expect(replace).not.toHaveBeenCalled()
    view.unmount()
  })

  it('401显示登录失效，不能呈现客户空库或零汇总', async () => {
    store.loadList.mockImplementationOnce(async () => {
      store.listState = { kind: 'unauthenticated', problem: { code: 'unauthenticated', message: '请重新认证', retryable: false } }
    })
    render(CustomerListScreen, { global })
    expect((await screen.findByRole('alert')).textContent).toContain('登录已失效')
    expect(screen.queryByText('还没有客户档案')).toBeNull()
    expect(document.querySelector('kit-table-stub')).toBeNull()
  })
})
