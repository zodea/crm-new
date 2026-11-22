import type { TargetCostListRead, TargetCostPending } from '~/lib/target-cost/central-contract'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, reactive, shallowRef } from 'vue'
import CentralTargetCostListScreen from '~/pages/project/target-cost/_components/CentralTargetCostListScreen.vue'

const route = reactive({ path: '/project/target-cost', query: { origin: 'real' } as Record<string, unknown> })
const load = vi.fn()
const recover = vi.fn()
const pending = shallowRef<TargetCostPending[]>([])
const read: TargetCostListRead = { context: { workspaceId: 'w', actorId: 'a', origin: 'real', sourceVersion: 'v1', capabilities: ['target-cost:read'] }, rows: ['A', 'B'].map(name => ({ id: name, name, projectId: 'project', projectName: '项目', isBaseline: false, status: 'draft', deletedAt: null, updatedAt: '2026-09-13', contractRevenue: null, plannedProfit: 0, taxInclusiveTotal: null, taxExclusiveTotal: null, taxAmount: null, signedContractSum: null, profitRate: null })) }
const Filters = defineComponent({ name: 'TargetCostListFilters', props: ['search', 'project', 'baseline', 'status', 'canCreate'], emits: ['update:search'], setup: (props, { emit }) => () => h('input', { 'aria-label': '搜索版本', 'value': props.search, 'onInput': (e: Event) => emit('update:search', (e.target as HTMLInputElement).value) }) })
const Table = defineComponent({ name: 'TargetCostListTable', props: ['rows', 'page', 'pageSize', 'canReadProject', 'canWrite'], setup: props => () => h('div', { 'data-test': 'rows' }, JSON.stringify(props.rows)) })
describe('中央预算列表同路由状态', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    route.query = { origin: 'real' }
    pending.value = []
    load.mockResolvedValue(read)
    recover.mockResolvedValue({ id: 'A' })
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useRouter', () => ({ replace: vi.fn(async ({ query }) => {
      route.query = query
    }), push: vi.fn() }))
    vi.stubGlobal('useTargetCostListStore', () => ({ load }))
    vi.stubGlobal('useTargetCostStore', () => ({ revision: 0, getPending: () => null, getPendingForList: () => pending.value, recover }))
    vi.stubGlobal('useKitUI', () => ({ confirm: vi.fn(), success: vi.fn() }))
  })
  const render = () => mount(CentralTargetCostListScreen, { global: { stubs: { TargetCostListFilters: Filters, TargetCostListTable: Table, TargetCostCommandState: true, KitButton: { template: '<button><slot /></button>' } } } })
  it('已有列表从预算返回另一筛选及页码时以路由恢复，不被旧本地值覆写', async () => {
    const wrapper = render()
    await flushPromises()
    expect(wrapper.get('[data-list-shell]').classes()).toContain('list-shell--continuous')
    expect(wrapper.get('[aria-label="目标成本列表汇总"]').text()).toContain('含税合价 未知')
    expect(wrapper.get('[aria-label="目标成本列表汇总"]').text()).toContain('计划利润 ¥0.00')
    await wrapper.get('input').setValue('A')
    await flushPromises()
    expect(wrapper.get('[data-test="rows"]').text()).toContain('"name":"A"')
    route.query = { origin: 'real', search: 'B', status: ['draft'], baseline: ['history'], page: '2', pageSize: '20', sort: 'name-asc' }
    await flushPromises()
    expect(wrapper.get('input').element.value).toBe('B')
    expect(wrapper.get('[data-test="rows"]').text()).toContain('"name":"B"')
    expect(wrapper.get('[data-test="rows"]').text()).not.toContain('"name":"A"')
    expect(wrapper.findComponent(Table).props()).toMatchObject({ pageSize: 20, canReadProject: false, canWrite: false })
    expect(route.query).toMatchObject({ page: '2', search: 'B', status: ['draft'] })
    wrapper.unmount()
  })
  it('冷读已删除版本只持最小原编号，没有正文仍显示原目标并按原编号核对', async () => {
    load.mockResolvedValue({ ...read, rows: read.rows.map(row => row.id === 'A' ? { ...row, deletedAt: '2026-10-07T00:00:00.000Z' } : row) })
    const operation: TargetCostPending = { state: 'unknown', command: null, descriptor: { commandId: 'original-key', workspaceId: 'w', actorId: 'a', family: 'target-cost', targetId: 'A', action: 'delete' } }
    pending.value = [operation]
    const wrapper = render()
    await flushPromises()
    expect(wrapper.get('[aria-label="预算未决操作"]').text()).toContain('A')
    await wrapper.get('[aria-label="预算未决操作"] button').trigger('click')
    await flushPromises()
    expect(recover).toHaveBeenCalledWith(operation)
    expect(recover.mock.calls[0]![0].descriptor).toMatchObject({ commandId: 'original-key', targetId: 'A', action: 'delete' })
    expect(recover.mock.calls[0]![0].command).toBeNull()
    expect(load).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })
})
