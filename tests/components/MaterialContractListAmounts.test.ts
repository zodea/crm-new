import type { MaterialContractListPageDTO } from '~/lib/material-contract/repository'
import type { ReadState } from '~/types/read-model'
import { render, screen, within } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, onActivated, onMounted, reactive, shallowRef, watch } from 'vue'
import MaterialContractListScreen from '~/components/contract/MaterialContractListScreen.vue'
import { materialOriginMeta } from '../helpers/material-read-meta'

const mocks = vi.hoisted(() => ({ store: {} as any }))
vi.mock('~/stores/material-contract-read', () => ({ useMaterialContractReadStore: () => mocks.store }))
vi.mock('~/stores/data-visibility', () => ({ useDataVisibilityStore: () => ({ includeDemo: true }) }))

const route = reactive({ path: '/contract/material', fullPath: '/contract/material', query: {} as Record<string, string> })
const replace = vi.fn()
const unavailable = { kind: 'unavailable', reason: 'unverified-target' } as const
const project = { state: 'resolved', entity: 'project', id: 'project-test', label: '合成项目', no: null } as const
const supplier = { state: 'resolved', entity: 'supplier', id: 'supplier-test', label: '合成分供方', no: null } as const
const originMeta = materialOriginMeta(['material-contract:read'], 'test-v1', '2026-09-08T00:00:00.000Z')
const data: MaterialContractListPageDTO = {
  meta: originMeta.real,
  originMeta,
  items: [{
    rowKey: 'real:contract-test',
    dataOrigin: 'real',
    id: 'contract-test',
    no: 'TEST-001',
    name: '合成材料合同',
    navigation: unavailable,
    project,
    supplier,
    projectNavigation: { kind: 'entity-detail', subject: project, variant: 'detail', view: null, filters: { dataOrigin: 'real' } },
    supplierNavigation: unavailable,
    amounts: { contract: '100.00', changed: '120.00', settled: '50.00', invoiced: '30.00', paid: '40.00', payable: '10.00' },
    signDate: null,
    status: '履约中',
    updatedAt: '2026-09-08T00:00:00.000Z',
  }],
  pagination: { page: 2, pageSize: 10, total: 23 },
  summary: {
    projects: [{ id: project.id, label: project.label }],
    suppliers: [{ id: supplier.id, label: supplier.label }],
    statuses: [],
    origins: {
      real: { contractCount: 21, changedAmount: '8888.00', invoicedAmount: '3333.00', paidAmount: '2222.00' },
      demo: { contractCount: 2, changedAmount: '999.00', invoicedAmount: '88.00', paidAmount: '77.00' },
    },
  },
  empty: null,
  asOf: '2026-09-08T00:00:00.000Z',
  sourceVersion: originMeta.real.sourceVersion,
  capabilities: ['material-contract:read'],
}

const TableStub = defineComponent({
  props: ['columns', 'data'],
  setup(props, { slots }) {
    return () => h('table', [
      h('thead', h('tr', props.columns.map((column: any) => h('th', column.title)))),
      h('tbody', props.data.map((row: any) => h('tr', props.columns.map((column: any) => h('td', column.slot ? slots[column.slot]?.({ row }) : String(row[column.field] ?? '')))))),
    ])
  },
})

function mountList() {
  return render(MaterialContractListScreen, {
    global: {
      stubs: { KitMultiSelectFilter: true, KitColumnHeader: true, TreeNav: true, SelectFilter: true, TargetCostSourceReturn: true },
      components: {
        KitTable: TableStub,
        NuxtLink: defineComponent({ props: ['to'], template: '<a :href="to"><slot/></a>' }),
        StatePanel: defineComponent({ props: ['title', 'description'], template: '<div role="alert">{{ title }} {{ description }}</div>' }),
      },
    },
  })
}

beforeEach(() => {
  for (const [key, value] of Object.entries({ computed, shallowRef, watch, onMounted, onActivated, nextTick }))
    vi.stubGlobal(key, value)
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useRouter', () => ({ replace }))
  vi.stubGlobal('useTabTitle', () => {})
  route.query = {}
  mocks.store = reactive({ listState: { kind: 'ready', data: structuredClone(data) } as ReadState<MaterialContractListPageDTO>, loadList: vi.fn() })
})

describe('材料合同列表真实金额与关系', () => {
  it('显示已返回的完整金额列、负收票余额和缺失日期', () => {
    mountList()
    expect(screen.getAllByRole('columnheader').map(cell => cell.textContent)).toEqual([
      '#',
      '合同名称',
      '合同编号',
      '项目名称',
      '乙方',
      '含税合同金额',
      '变更后合同金额',
      '累计结算金额',
      '累计收票金额',
      '累计支付金额',
      '按结算应付金额',
      '按收票应付金额',
      '签约日期',
      '合同状态',
      '来源',
    ])
    const table = within(screen.getByRole('table'))
    for (const amount of ['¥100.00', '¥120.00', '¥50.00', '¥10.00', '¥-10.00'])
      expect(table.getByText(amount)).toBeTruthy()
    expect(table.getByText('未记录')).toBeTruthy()
  })

  it('显示全量查询汇总并分开正式和演示，不汇总当前页', () => {
    mountList()
    const summary = within(screen.getByRole('status', { name: '列表汇总' }))
    expect(summary.getByText('正式 · 21 份')).toBeTruthy()
    expect(summary.getByText('演示 · 2 份')).toBeTruthy()
    for (const amount of ['¥8,888.00', '¥3,333.00', '¥2,222.00', '¥999.00', '¥88.00', '¥77.00'])
      expect(summary.getByText(amount)).toBeTruthy()
    expect(summary.queryByText('¥120.00')).toBeNull()
  })

  it('只把合法同来源关系呈现为链接', () => {
    mountList()
    expect(screen.getByRole('link', { name: '合成项目' }).getAttribute('href')).toContain('/project/project-test?origin=real')
    expect(screen.queryByRole('link', { name: '合成分供方' })).toBeNull()
    expect(screen.getByText('合成分供方（目标待核验）')).toBeTruthy()
    expect(screen.getByText('合成材料合同（目标待核验）')).toBeTruthy()
  })

  it('刷新保留同一快照汇总，失去权限后清除所有旧金额', async () => {
    mountList()
    mocks.store.listState = { kind: 'loading', previous: structuredClone(data) }
    await nextTick()
    expect(screen.getByRole('status', { name: '列表汇总' }).textContent).toContain('8,888.00')
    mocks.store.listState = { kind: 'forbidden', problem: { code: 'forbidden', message: '不可读取', retryable: false } }
    await nextTick()
    expect(screen.queryByRole('status', { name: '列表汇总' })).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
